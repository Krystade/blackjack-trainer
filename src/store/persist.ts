import { DEFAULT_SETTINGS, EMPTY_STATS, type AudioSettings, type Settings, type Stats } from './types';
import { backupDevice, deviceAudioNote, deviceClass, withDeviceAudio } from './deviceAudio';
import { capHistories } from './retention';
import { diag } from '../diag/diagnosticLog';
import { diffSettings, formatChanges } from '../diag/settingsDiff';
import { DIAGNOSTICS_KEY, reportStorageFailure, shrinkDiagnostics } from './storageHealth';
import { graveKeys, quarantineRaw, quarantinedKeys } from './quarantine';

// Storage injection for testing (guards missing localStorage in node)
let storage: Pick<Storage, 'getItem' | 'setItem'> | null = null;

export function _setStorage(s: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  storage = s;
}

// Single persistent in-memory fallback for environments without localStorage.
// Created once at module level so save→load round-trips work in node.
const fallbackMap = new Map<string, string>();
const fallbackStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => fallbackMap.get(key) ?? null,
  setItem: (key, value) => {
    fallbackMap.set(key, value);
  },
};

// Default storage resolver (lazy, never throws). Exported for the stores
// that sit beside this one (Wave N habits), so tests inject one storage.
export function getStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  if (storage !== null) {
    return storage;
  }

  // Use real localStorage if available, otherwise the persistent in-memory fallback
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }

  return fallbackStorage;
}

function isVersion1Object(parsed: unknown): parsed is Record<string, unknown> {
  return (
    typeof parsed === 'object' &&
    parsed !== null &&
    (parsed as { version?: unknown }).version === 1
  );
}

/**
 * Merge a parsed (possibly partial) settings blob over a deep copy of the
 * defaults: top-level fields plus the nested drill and audio objects.
 * Guarantees a complete Settings shape even if stored data is missing
 * fields (or predates cycle 3, i.e. has no audio object at all), and never
 * shares references with the DEFAULT_SETTINGS singleton.
 */
/**
 * SETTINGS THAT NO LONGER EXIST, dropped from a stored blob on load.
 *
 * `mergeSettings` spreads the stored blob OVER the defaults, so a retired key
 * would otherwise ride along in memory and be written straight back by the
 * next save -- harmless to read, but it keeps a dead setting alive in every
 * export, every settings diff in the diagnostic log, and every backup.
 *
 * Retired 2026-10-05 in the Settings cull, each because its default was the
 * only value worth having:
 *   - countPeek: the peek button is always shown; every peek is already
 *     recorded against the session ("assisted"), which polices it better
 *     than hiding it did.
 *   - pushToTalkMs: a tuning constant (PUSH_TO_TALK_MS), not a preference --
 *     a recognised word closes the window early anyway.
 *   - chimes: switching them off silenced the "microphone is live" cue that
 *     tells a driver when to speak; Mute covers wanting silence.
 *   - cardDetail: cards are spoken by rank. Suits are irrelevant to the count
 *     and doubled every line; collapsing tens to "ten" skipped the very
 *     rank-to-tag step the count drill exists to train.
 *   - handStyle: soft hands are spoken card by card. "Soft fourteen" is the
 *     phrase that gets misheard as a hard total.
 *   - outputRoute: 'playback' and 'switch' were both proven on the road not to
 *     move the sound off the earpiece ('switch' also looped a prompt), and
 *     were already migrated to 'auto' on every load. One value is no choice.
 */
/**
 * Fields that no longer exist, dropped on load so a stored blob stops carrying
 * them forward through every save.
 *
 * `micCueOn` and `voiceAlternatives` were the two arms of the 2026-10-04
 * microphone experiments; their winning values are now fixed behaviour in
 * ui/useVoiceControl.ts. `outputRoute` went when both of its non-default
 * values were proved not to move sound off the earpiece. The rest were cut in
 * the 2026-10-05 Settings cull.
 */
const RETIRED_DRILL_KEYS = ['pushToTalkMs'] as const;
const RETIRED_AUDIO_KEYS = [
  'micCueOn',
  'voiceAlternatives',
  'chimes',
  'cardDetail',
  'handStyle',
  'outputRoute',
] as const;
const RETIRED_TOP_KEYS = ['countPeek'] as const;

/**
 * The audio-route settings' allowed values (Wave U). Anything else -- a value
 * from a later build after a rollback, or a hand edit -- is dropped on load,
 * so it reads as Auto rather than reaching the route planner, which would
 * otherwise treat an unknown route as a Bluetooth hold.
 */
const AUDIO_ROUTES: ReadonlyArray<NonNullable<AudioSettings['audioRoute']>> = ['auto', 'phone', 'bluetooth'];
const ROUTE_STRATEGIES: ReadonlyArray<NonNullable<AudioSettings['routeStrategy']>> = [
  'auto',
  'web-audio',
  'play-and-record',
  'speaker-sink',
];

function dropUnlisted(obj: Record<string, unknown>, key: string, allowed: ReadonlyArray<string>): void {
  if (key in obj && !allowed.includes(obj[key] as string)) delete obj[key];
}

function mergeSettings(parsed: Record<string, unknown>): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const p = { ...parsed } as Partial<Settings> & Record<string, unknown>;
  for (const k of RETIRED_TOP_KEYS) delete p[k];
  const drill =
    typeof p.drill === 'object' && p.drill !== null
      ? { ...base.drill, ...p.drill }
      : base.drill;
  const audio =
    typeof p.audio === 'object' && p.audio !== null
      ? { ...base.audio, ...p.audio }
      : base.audio;
  for (const k of RETIRED_DRILL_KEYS) delete (drill as unknown as Record<string, unknown>)[k];
  for (const k of RETIRED_AUDIO_KEYS) delete (audio as unknown as Record<string, unknown>)[k];
  dropUnlisted(audio as unknown as Record<string, unknown>, 'audioRoute', AUDIO_ROUTES);
  dropUnlisted(audio as unknown as Record<string, unknown>, 'routeStrategy', ROUTE_STRATEGIES);
  // The recorded voice is no longer a choice (see AudioSettings.useClips).
  // Forced rather than defaulted, because a `false` saved while the shipped
  // default was off would otherwise win over the default forever, with no
  // control left to undo it.
  audio.useClips = true;
  return { ...base, ...p, version: 1, drill, audio };
}

export { mergeSettings };

/**
 * Merge a parsed (possibly partial) stats blob over a deep copy of the empty
 * stats: top-level fields plus the fourteen nested sections (categories,
 * perIndex, mistakes, countDrill, trueCount, deckEstimation, timedCount,
 * sessions, distraction, pairCancel, retention, betSitLeave, downswing). The telemetry sections (trueCount/deckEstimation/
 * timedCount/distraction) postdate the original stats shape, so any blob
 * persisted before they existed lacks them entirely -- the same
 * `typeof ... === 'object'` guard used for countDrill backfills them to an
 * empty history rather than leaving them undefined.
 */
/**
 * Repair a merged stats blob in place: every `{ history: [...] }` payload must
 * be an array, and every category tally an object.
 *
 * The section guards below check the CONTAINER (`typeof x === 'object'`) and
 * then shallow-spread it, so a stored `{"history": null}` passed straight
 * through to `Stats.tsx`, where `.filter(...)` threw during render. With no
 * error boundary in the tree React unmounts the whole root — a blank page —
 * and the Reset Stats button that would clear the bad blob lives on exactly
 * the screen that crashes, so there is no way back from inside the app.
 * "Valid enough to merge" was being treated as "valid enough to render".
 */
function repairStats(stats: Stats): Stats {
  for (const value of Object.values(stats as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && 'history' in value) {
      const section = value as { history: unknown };
      if (!Array.isArray(section.history)) section.history = [];
    }
  }

  const cats = stats.categories as unknown as Record<string, unknown>;
  for (const key of Object.keys(cats)) {
    const tally = cats[key];
    if (!tally || typeof tally !== 'object') cats[key] = { right: 0, wrong: 0 };
  }

  return stats;
}

function mergeStats(parsed: Record<string, unknown>): Stats {
  const base = structuredClone(EMPTY_STATS);
  const p = parsed as Partial<Stats>;
  return repairStats({
    ...base,
    ...p,
    version: 1,
    categories:
      typeof p.categories === 'object' && p.categories !== null
        ? { ...base.categories, ...p.categories }
        : base.categories,
    perIndex:
      typeof p.perIndex === 'object' && p.perIndex !== null
        ? { ...base.perIndex, ...p.perIndex }
        : base.perIndex,
    mistakes:
      typeof p.mistakes === 'object' && p.mistakes !== null
        ? { ...base.mistakes, ...p.mistakes }
        : base.mistakes,
    countDrill:
      typeof p.countDrill === 'object' && p.countDrill !== null
        ? { ...base.countDrill, ...p.countDrill }
        : base.countDrill,
    trueCount:
      typeof p.trueCount === 'object' && p.trueCount !== null
        ? { ...base.trueCount, ...p.trueCount }
        : base.trueCount,
    deckEstimation:
      typeof p.deckEstimation === 'object' && p.deckEstimation !== null
        ? { ...base.deckEstimation, ...p.deckEstimation }
        : base.deckEstimation,
    timedCount:
      typeof p.timedCount === 'object' && p.timedCount !== null
        ? { ...base.timedCount, ...p.timedCount }
        : base.timedCount,
    sessions: Array.isArray(p.sessions) ? p.sessions : base.sessions,
    // R1 (docs/BACKLOG.md): a blob persisted before decision-latency
    // telemetry shipped lacks this array entirely -- same Array.isArray
    // backfill-to-empty idiom as `sessions` above.
    latencyHistory: Array.isArray(p.latencyHistory) ? p.latencyHistory : base.latencyHistory,
    // D1 part 1 (docs/BACKLOG.md): a blob persisted before distraction
    // telemetry shipped lacks this section entirely -- same
    // `typeof ... === 'object'` backfill idiom as trueCount/deckEstimation/
    // timedCount above.
    distraction:
      typeof p.distraction === 'object' && p.distraction !== null
        ? { ...base.distraction, ...p.distraction }
        : base.distraction,
    // R8/TS#6 (docs/BACKLOG.md, pair-cancellation): a blob persisted before
    // this section shipped lacks it entirely -- same backfill idiom.
    pairCancel:
      typeof p.pairCancel === 'object' && p.pairCancel !== null
        ? { ...base.pairCancel, ...p.pairCancel }
        : base.pairCancel,
    // RV4 (docs/BACKLOG.md, spaced-repetition retention): same backfill idiom.
    retention:
      typeof p.retention === 'object' && p.retention !== null
        ? { ...base.retention, ...p.retention }
        : base.retention,
    // ET3 (docs/BACKLOG.md, bet/sit/leave): same backfill idiom.
    betSitLeave:
      typeof p.betSitLeave === 'object' && p.betSitLeave !== null
        ? { ...base.betSitLeave, ...p.betSitLeave }
        : base.betSitLeave,
    // ET1 (docs/BACKLOG.md, downswing): same backfill idiom.
    downswing:
      typeof p.downswing === 'object' && p.downswing !== null
        ? { ...base.downswing, ...p.downswing }
        : base.downswing,
    // V3-2 (docs/BACKLOG.md, produce-a-TC): same backfill idiom.
    produceTc:
      typeof p.produceTc === 'object' && p.produceTc !== null
        ? { ...base.produceTc, ...p.produceTc }
        : base.produceTc,
    // V3-8 (docs/BACKLOG.md, what the mistake cost): same backfill idiom.
    evCost:
      typeof p.evCost === 'object' && p.evCost !== null
        ? { ...base.evCost, ...p.evCost }
        : base.evCost,
  });
}

/**
 * Keep the bytes we could not read before anything overwrites them: see
 * store/quarantine.ts (two slots, logged). Every reader here is
 * read-modify-write, so "unreadable" answered as "empty" would otherwise be
 * committed over the only copy by the next save.
 */
function quarantine(key: string, raw: string): void {
  quarantineRaw(getStorage(), key, raw, 'unreadable');
}

/**
 * The one place the settings key is spelled.
 *
 * It was a bare literal in eight places, and a test written against
 * "bjtrainer.settings.v2" passed by reading nothing at all -- the exact shape
 * of check that cannot fail. Anything reading settings off disk imports this.
 */
export const SETTINGS_KEY = 'bjtrainer.settings.v1';

export function loadSettings(): Settings {
  const store = getStorage();
  const json = store.getItem(SETTINGS_KEY);

  if (!json) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (isVersion1Object(parsed)) {
      return mergeSettings(parsed);
    }
    quarantine(SETTINGS_KEY, json);
    return structuredClone(DEFAULT_SETTINGS);
  } catch {
    // JSON parse error
    quarantine(SETTINGS_KEY, json);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * Write a key, reporting failure instead of throwing.
 *
 * A bare `setItem` throws on a full quota (or in private-mode Safari), and
 * every caller here sits inside a click handler that does real work AFTER the
 * save: `useGame.endSession` builds the session report, `persistGrade` renders
 * the answer feedback, `Settings.commit` applies the new settings. An escaping
 * throw skipped all of it — the report never appeared, the drill looked
 * frozen, a toggle snapped back — with no message, because there is no error
 * boundary. Losing the write is bad; losing the write AND the interaction is
 * what made it look like the app was broken.
 *
 * `saveSrDeck` in drills/gradeAnswer.ts already guarded its write this way;
 * the store layer simply never did.
 */
function writeKey(key: string, value: string, opts: { makeRoom?: boolean } = {}): boolean {
  const store = getStorage();
  try {
    store.setItem(key, value);
    return true;
  } catch {
    // B29: a bulk restore is not an interactive save -- there is no frozen
    // answer to rescue, and shrinking the diagnostic log for an import that
    // then rolls back cost the drive log for nothing. It says so instead.
    if (opts.makeRoom === false) return false;
    // F24: MAKE ROOM, THEN SAY SO. The diagnostic log is the one large blob
    // that is not the operator's progress, so it gives way first; if the write
    // still fails, storageHealth tells the shell, which shows a toast instead
    // of letting every later answer vanish without a sign.
    if (key !== DIAGNOSTICS_KEY && shrinkDiagnostics(store as Parameters<typeof shrinkDiagnostics>[0])) {
      try {
        store.setItem(key, value);
        diag('err', 'storage-full-recovered', { key });
        return true;
      } catch {
        /* still full: reported below */
      }
    }
    reportStorageFailure(key);
    return false;
  }
}

/** Delete a key, reporting failure instead of throwing. See `writeKey`. */
function removeKey(key: string): boolean {
  try {
    const store = getStorage() as { removeItem?: (k: string) => void; setItem: (k: string, v: string) => void };
    if (typeof store.removeItem === 'function') store.removeItem(key);
    else store.setItem(key, '');
    return true;
  } catch {
    return false;
  }
}

/**
 * Storage keys whose only reader has been deleted, removed once per load.
 *
 * Each belonged to a Settings panel culled on 2026-10-05. Left alone they are
 * inert, but two of them hold what the microphone heard (the old voice probe's
 * transcripts) or what the car sent, and with their panels gone there would be
 * no way left in the app to clear them.
 *
 *   mediaSessionLog -- the "Car controls" readout; every line it held is also
 *                      written to the diagnostic log under `wheel`/`focus`.
 *   voiceProbe      -- the standalone "Voice control" recognition probe.
 *   voiceLocal(Probe) -- the on-device model opt-in and its crash guard, a
 *                      Chrome-only API the operator's iPhone does not have.
 */
const RETIRED_KEYS = [
  'bjtrainer.mediaSessionLog.v1',
  'bjtrainer.voiceProbe.v1',
  'bjtrainer.voiceLocal.v1',
  'bjtrainer.voiceLocalProbe.v1',
];

export function dropRetiredKeys(): void {
  for (const key of RETIRED_KEYS) removeKey(key);
}

export function saveSettings(s: Settings): boolean {
  // Record what changed, not that something did.
  //
  // "It worked yesterday" is usually a setting, and several of these change
  // the microphone's behaviour from screens nowhere near the drill --
  // eyes-free, on-device speech, verbosity, volume boost. Reading the old
  // value back before the write is the only place the BEFORE side is still
  // available, so the diff has to happen here rather than at any call site.
  try {
    const previous = loadSettings();
    const changes = diffSettings(previous, s);
    if (changes.length > 0) diag('set', 'settings', { changed: formatChanges(changes) });
  } catch {
    /* a log must never cost a settings write */
  }
  return writeKey(SETTINGS_KEY, JSON.stringify(s));
}

export function loadStats(): Stats {
  const store = getStorage();
  const json = store.getItem('bjtrainer.stats.v1');

  if (!json) {
    return structuredClone(EMPTY_STATS);
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (isVersion1Object(parsed)) {
      return mergeStats(parsed);
    }
    quarantine('bjtrainer.stats.v1', json);
    return structuredClone(EMPTY_STATS);
  } catch {
    // JSON parse error
    quarantine('bjtrainer.stats.v1', json);
    return structuredClone(EMPTY_STATS);
  }
}

/**
 * Wave N: one observer of every stats save (the habit tracker, which counts
 * the answers each save adds). Registered rather than imported so this layer
 * depends on nothing above it. `replaced` is true when the stats were
 * replaced wholesale (a backup restore), which is a new baseline, not answers.
 */
export type StatsSaveObserver = (written: Stats, replaced: boolean, untrimmed?: Stats) => void;
let statsSaveObserver: StatsSaveObserver | null = null;
export function setStatsSaveObserver(fn: StatsSaveObserver | null): void {
  statsSaveObserver = fn;
}
function notifyStatsSaved(written: Stats, replaced: boolean, untrimmed?: Stats): void {
  try {
    statsSaveObserver?.(written, replaced, untrimmed);
  } catch {
    /* a habit tracker must never break saving an answer */
  }
}

export function saveStats(s: Stats): boolean {
  // Capped on the way out rather than at each append site: there are eleven
  // history arrays written from a dozen places, and a policy applied at the
  // single choke point cannot be forgotten by the next one added.
  const capped = capHistories(s);
  const ok = writeKey('bjtrainer.stats.v1', JSON.stringify(capped));
  // Both: the trimmed blob is the next baseline, the untrimmed one says what
  // this save added (a full history is flat once trimmed).
  if (ok) notifyStatsSaved(capped, false, s);
  return ok;
}

/** Keys the export carries beyond settings+stats, with the blob field each
 * maps to. Raw strings: this layer must not depend on profiles.ts or the
 * drills' SR modules just to copy their storage across. */
const EXTRA_KEYS: { key: string; field: string; label: string; raw?: true }[] = [
  { key: 'bjtrainer.profiles.v1', field: 'profiles', label: 'profiles' },
  { key: 'bjtrainer.activeProfile.v1', field: 'activeProfile', label: 'profiles', raw: true },
  { key: 'bjtrainer.flashsr.v1', field: 'flashSr', label: 'both review schedules' },
  { key: 'bjtrainer.quizsr.v1', field: 'quizSr', label: 'both review schedules' },
  { key: 'bjtrainer.masteryrun.v1', field: 'masteryRun', label: 'the Mastery run in progress' },
  // A reading preference rather than part of the game definition, which is
  // why it has its own key (see Charts.tsx) -- and why it was missed. It is
  // still something the operator chose and would have to choose again.
  // B21: stored as a bare string ('ascending'), not JSON -- so `raw`, or the
  // JSON.parse below threw and the key never reached a backup.
  { key: 'bjtrainer.chartOrder.v1', field: 'chartOrder', label: 'the chart row order', raw: true },
  // Wave N: streaks, daily-goal days and earned achievements (habits/progressStore.ts).
  { key: 'bjtrainer.progress.v1', field: 'progress', label: 'streaks and achievements' },
  // Wave L: the Variant hands drill's right/wrong tally -- practice history,
  // backed up like the SR decks. The variant being studied
  // (bjtrainer.variant.v1) is a device preference and stays out.
  { key: 'bjtrainer.variantTally.v1', field: 'variantTally', label: 'the Variant hands tally' },
  // Wave W: the Custom deck's saved lists (drills/customLists.ts) -- painted
  // by hand, so as unrecoverable as a profile.
  { key: 'bjtrainer.customLists.v1', field: 'customLists', label: 'saved Custom lists' },
  // Wave L (lane v): finished guided sessions (what improved, two achievements)
  // and today's unfinished one (guided/store.ts).
  { key: 'bjtrainer.guided.v1', field: 'guided', label: 'guided sessions' },
];

/**
 * Every key a backup carries, for the test that no OTHER key escapes.
 *
 * This file's own comment records what happens without that check: `exportAll`
 * shipped carrying settings and stats alone, profiles and both
 * spaced-repetition decks were added to the app later and never added here,
 * and a restore onto a wiped browser returned stats and settings while
 * silently losing every profile and the entire review schedule. Fixing those
 * three does not stop the fourth; a list that something asserts against does.
 *
 * `persistHardening.test.ts` scans `src/` for every `bjtrainer.*` literal and
 * requires each one to appear here or in its own list of deliberate
 * exclusions, with the reason written next to it.
 */
export const BACKED_UP_KEYS: readonly string[] = [
  SETTINGS_KEY,
  'bjtrainer.stats.v1',
  ...EXTRA_KEYS.map((e) => e.key),
];

/**
 * The whole of the user's state, not just settings+stats.
 *
 * This is offered in the UI as a downloadable backup, but it originally
 * carried only the two keys that existed when it was written. Profiles (rules,
 * bet ramp, bankroll, CVCX sim figures) and both spaced-repetition decks were
 * added later and never included — so restoring onto a wiped browser returned
 * stats and settings and silently lost every profile plus the entire review
 * schedule. The SR loss is the unrecoverable one: those boxes encode elapsed
 * real time, which no amount of re-drilling reconstructs.
 */
export function exportAll(): string {
  const store = getStorage();
  const blob: Record<string, unknown> = { settings: loadSettings(), stats: loadStats() };

  // THE BYTES, when they could not be read.
  //
  // Both fields above go through readers that answer "empty" for a blob they
  // cannot parse, and this function is offered on the crash screen as
  // "Download backup" -- reached precisely when something is corrupt. The
  // user got a file that looked complete, believed they were safe, and
  // reset. Whatever could not be read rides along verbatim so a human (or a
  // later build) can still get at it.
  // B5/B13: every backed-up store keeps its unreadable bytes now, in two slots.
  for (const grave of allGraveKeys()) {
    const raw = store.getItem(grave);
    if (raw !== null) blob[grave] = raw;
  }

  for (const { key, field, raw: bare } of EXTRA_KEYS) {
    const raw = store.getItem(key);
    if (raw === null) continue;
    // Bare strings (the active profile's id, the chart order) travel as they
    // are; the rest are JSON documents.
    if (bare) {
      blob[field] = raw;
      continue;
    }
    try {
      blob[field] = JSON.parse(raw);
    } catch {
      // A corrupt key is omitted rather than aborting the whole backup.
    }
  }

  // B4: WHEN, AND HOW MUCH. Several backups in Files were indistinguishable
  // inside; the import confirm reads this to show the file beside the phone.
  // importAll ignores it (it reads only the fields it knows).
  // B16: the kind of device, so a restore elsewhere keeps that device's sound settings.
  blob.meta = { app: 'bjtrainer', exportedAt: new Date().toISOString(), summary: summarizeBackupBlob(blob), device: deviceClass() };

  return JSON.stringify(blob);
}

/** What a backup holds, in the terms the import confirm shows it. */
export interface BackupSummary {
  /** Graded answers in the category tallies (drills and table play). */
  answers: number;
  /** Table sessions recorded. */
  sessions: number;
  profiles: number;
  /** Cards in both spaced-repetition decks. */
  reviewCards: number;
  /** The newest dated history row, ISO; null when nothing is dated. */
  newest: string | null;
}

function countObjectKeys(v: unknown): number {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.keys(v).length : 0;
}

/** Summarise a parsed backup blob (or this phone's, via `exportAll`). Never throws. */
export function summarizeBackupBlob(blob: Record<string, unknown>): BackupSummary {
  let answers = 0;
  let sessions = 0;
  let newest: string | null = null;
  const stats = blob.stats as Record<string, unknown> | undefined;
  if (stats && typeof stats === 'object') {
    const cats = stats.categories;
    if (cats && typeof cats === 'object') {
      for (const t of Object.values(cats as Record<string, unknown>)) {
        const r = (t as { right?: unknown })?.right;
        const w = (t as { wrong?: unknown })?.wrong;
        if (typeof r === 'number') answers += r;
        if (typeof w === 'number') answers += w;
      }
    }
    if (Array.isArray(stats.sessions)) sessions = stats.sessions.length;
    for (const v of Object.values(stats)) {
      const rows = Array.isArray(v) ? v : (v as { history?: unknown })?.history;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const d = (row as { date?: unknown })?.date;
        if (typeof d === 'string' && Number.isFinite(Date.parse(d)) && (newest === null || d > newest)) newest = d;
      }
    }
  }
  const profiles = Array.isArray(blob.profiles) ? blob.profiles.length : 0;
  const reviewCards = countObjectKeys(blob.flashSr) + countObjectKeys(blob.quizSr);
  return { answers, sessions, profiles, reviewCards, newest };
}

/** A backup file read and checked, before anything is written. */
export type ParsedBackup =
  | { ok: true; exportedAt: string | null; summary: BackupSummary; replaces: string[]; deviceNote?: string }
  | { ok: false; error: string };

/**
 * B4: read a backup file WITHOUT importing it, so the confirm can show what
 * it is (when it was made, what it holds) next to what the phone holds, and
 * a file that is not a backup is refused before the question is asked.
 */
export function inspectBackup(json: string): ParsedBackup {
  const v = validateBackup(json);
  if (!v.ok) return v;
  const obj = v.obj;
  const meta = obj.meta as { exportedAt?: unknown } | undefined;
  const exportedAt =
    meta && typeof meta.exportedAt === 'string' && Number.isFinite(Date.parse(meta.exportedAt)) ? meta.exportedAt : null;
  const deviceNote = deviceAudioNote(backupDevice(obj), deviceClass());
  return { ok: true, exportedAt, summary: summarizeBackupBlob(obj), replaces: replacedLabels(obj), ...(deviceNote ? { deviceNote } : {}) };
}

/**
 * B22: what an import of this blob overwrites, in words, built from the keys
 * the file actually carries -- a fixed sentence drifted every time a key was
 * added (streaks, achievements and guided sessions went unmentioned).
 */
function replacedLabels(obj: Record<string, unknown>): string[] {
  const out = ['stats', 'settings'];
  for (const { field, label } of EXTRA_KEYS) {
    if (obj[field] !== undefined && !out.includes(label)) out.push(label);
  }
  return out;
}

function validateBackup(json: string): { ok: true; obj: Record<string, unknown> } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json) as unknown;
  } catch {
    return { ok: false, error: 'not a backup file (it is not JSON)' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Invalid JSON structure' };
  }
  const obj = parsed as Record<string, unknown>;
  if (!('settings' in obj) || !('stats' in obj)) return { ok: false, error: 'Missing settings or stats' };
  if (!isVersion1Object(obj.settings)) return { ok: false, error: 'Invalid settings version' };
  if (!isVersion1Object(obj.stats)) return { ok: false, error: 'Invalid stats version' };
  return { ok: true, obj };
}

/**
 * B4: AN UNDO. The exact stored text of every key an import can touch (null
 * for an absent one), taken just before the import, so putting it back is a
 * byte-for-byte restore -- including removing a key the import added.
 */
export type BackupSnapshot = Record<string, string | null>;

function importTouchedKeys(): string[] {
  return [...BACKED_UP_KEYS, ...allGraveKeys()];
}

/** Both quarantine slots of every key a backup carries. */
function allGraveKeys(): string[] {
  return BACKED_UP_KEYS.flatMap((key) => graveKeys(key));
}

/**
 * B13: the backed-up keys that have unreadable bytes set aside, for the notice
 * on Stats -- a quarantine used to happen with nothing on screen, so Jack saw
 * empty Stats and might reset or keep drilling over it.
 */
export function quarantinedBackupKeys(): string[] {
  return quarantinedKeys(getStorage(), BACKED_UP_KEYS);
}

/** The same, in words ("stats", "both review schedules"), deduplicated. */
export function quarantinedBackupLabels(): string[] {
  const label = (key: string): string =>
    key === SETTINGS_KEY ? 'settings' : key === 'bjtrainer.stats.v1' ? 'stats' : (EXTRA_KEYS.find((e) => e.key === key)?.label ?? key);
  return [...new Set(quarantinedBackupKeys().map(label))];
}

export function snapshotBackedUp(): BackupSnapshot {
  const store = getStorage();
  const out: BackupSnapshot = {};
  for (const key of importTouchedKeys()) out[key] = store.getItem(key);
  return out;
}

/** Put a snapshot back. False when a write failed (the caller says so). */
export function restoreSnapshot(snap: BackupSnapshot): boolean {
  let ok = true;
  for (const key of importTouchedKeys()) {
    if (!(key in snap)) continue;
    const value = snap[key];
    const done = value === null || value === undefined ? removeKey(key) : writeKey(key, value);
    if (!done) ok = false;
  }
  notifyStatsSaved(loadStats(), true);
  return ok;
}

export function importAll(json: string): { ok: boolean; error?: string } {
  try {
    const v = validateBackup(json);
    if (!v.ok) return v;
    const parsed = v.obj;
    const obj = parsed as { settings: Record<string, unknown>; stats: Record<string, unknown> };

    /*
     * STAGED, THEN COMMITTED, AND THE RESULT REPORTED.
     *
     * This used to write each key as it went and `return { ok: true }`
     * whatever happened: the three booleans were discarded, so a storage
     * that refused every write reported a successful import having written
     * nothing. Worse, the order put the destructive write first and the SR
     * decks -- the part this file's own comment calls "the unrecoverable
     * one" -- last, so a quota failure part way through left stats
     * replaced, profiles unchanged and a deck missing, under "Import
     * successful." on screen.
     *
     * Every value is prepared first, the previous contents are snapshotted,
     * and a failure rolls back to them. Rollback is best-effort by nature --
     * it is writing to the storage that just refused a write -- so it is
     * reported rather than assumed.
     */
    const extras = parsed as Record<string, unknown>;
    const pending: { key: string; value: string }[] = [
      {
        key: SETTINGS_KEY,
        // B16: a file from another kind of device leaves this one's sound route, voice and chime.
        value: JSON.stringify(withDeviceAudio(mergeSettings(obj.settings), loadSettings(), backupDevice(parsed), deviceClass())),
      },
      { key: 'bjtrainer.stats.v1', value: JSON.stringify(capHistories(mergeStats(obj.stats))) },
    ];
    for (const { key, field } of EXTRA_KEYS) {
      const value = extras[field];
      if (value === undefined) continue;
      pending.push({ key, value: typeof value === 'string' ? value : JSON.stringify(value) });
    }

    // Quarantined bytes ride back in too. `exportAll` carries them so a
    // backup taken while something was unreadable still holds the only copy
    // of it; dropping them here would mean the round trip -- the exact
    // sequence the crash screen tells people to perform -- destroyed it.
    for (const grave of allGraveKeys()) {
      const value = extras[grave];
      if (typeof value === 'string') pending.push({ key: grave, value });
    }

    const store = getStorage();
    const before = new Map<string, string | null>();
    for (const { key } of pending) before.set(key, store.getItem(key));

    const written: string[] = [];
    for (const { key, value } of pending) {
      if (writeKey(key, value, { makeRoom: false })) {
        written.push(key);
        continue;
      }
      // Put back what we replaced, then say what happened.
      let restored = true;
      for (const key2 of written) {
        const prior = before.get(key2);
        const ok = prior === null ? removeKey(key2) : writeKey(key2, prior ?? '');
        if (!ok) restored = false;
      }
      // The rollback above MAY make room: putting the previous data back
      // matters more than the diagnostic log.
      return {
        ok: false,
        error: restored
          ? `not enough space to import (${key}); nothing was changed. Clearing the diagnostic log (Settings) frees space.`
          : `Could not write ${key}, and the previous data could not be put back`,
      };
    }

    // Wave N: the restored stats are a new baseline for the habit tracker.
    notifyStatsSaved(loadStats(), true);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
