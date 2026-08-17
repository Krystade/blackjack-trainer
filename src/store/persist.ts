import { DEFAULT_SETTINGS, EMPTY_STATS, type Settings, type Stats } from './types';
import { capHistories } from './retention';

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

// Default storage resolver (lazy, never throws)
function getStorage(): Pick<Storage, 'getItem' | 'setItem'> {
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
function mergeSettings(parsed: Record<string, unknown>): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  const p = parsed as Partial<Settings>;
  const drill =
    typeof p.drill === 'object' && p.drill !== null
      ? { ...base.drill, ...p.drill }
      : base.drill;
  const audio =
    typeof p.audio === 'object' && p.audio !== null
      ? { ...base.audio, ...p.audio }
      : base.audio;
  return { ...base, ...p, version: 1, drill, audio };
}

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
  });
}

export function loadSettings(): Settings {
  const store = getStorage();
  const json = store.getItem('bjtrainer.settings.v1');

  if (!json) {
    return structuredClone(DEFAULT_SETTINGS);
  }

  try {
    const parsed = JSON.parse(json) as unknown;
    if (isVersion1Object(parsed)) {
      return mergeSettings(parsed);
    }
    return structuredClone(DEFAULT_SETTINGS);
  } catch {
    // JSON parse error
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
function writeKey(key: string, value: string): boolean {
  try {
    getStorage().setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function saveSettings(s: Settings): boolean {
  return writeKey('bjtrainer.settings.v1', JSON.stringify(s));
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
    return structuredClone(EMPTY_STATS);
  } catch {
    // JSON parse error
    return structuredClone(EMPTY_STATS);
  }
}

export function saveStats(s: Stats): boolean {
  // Capped on the way out rather than at each append site: there are eleven
  // history arrays written from a dozen places, and a policy applied at the
  // single choke point cannot be forgotten by the next one added.
  return writeKey('bjtrainer.stats.v1', JSON.stringify(capHistories(s)));
}

/** Keys the export carries beyond settings+stats, with the blob field each
 * maps to. Raw strings: this layer must not depend on profiles.ts or the
 * drills' SR modules just to copy their storage across. */
const EXTRA_KEYS: { key: string; field: string }[] = [
  { key: 'bjtrainer.profiles.v1', field: 'profiles' },
  { key: 'bjtrainer.activeProfile.v1', field: 'activeProfile' },
  { key: 'bjtrainer.flashsr.v1', field: 'flashSr' },
  { key: 'bjtrainer.quizsr.v1', field: 'quizSr' },
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

  for (const { key, field } of EXTRA_KEYS) {
    const raw = store.getItem(key);
    if (raw === null) continue;
    // activeProfile is a bare id string; the rest are JSON documents.
    if (field === 'activeProfile') {
      blob[field] = raw;
      continue;
    }
    try {
      blob[field] = JSON.parse(raw);
    } catch {
      // A corrupt key is omitted rather than aborting the whole backup.
    }
  }

  return JSON.stringify(blob);
}

export function importAll(json: string): { ok: boolean; error?: string } {
  try {
    const parsed = JSON.parse(json) as unknown;

    // Validate structure
    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'Invalid JSON structure' };
    }

    const obj = parsed as { settings?: unknown; stats?: unknown };
    if (!('settings' in obj) || !('stats' in obj)) {
      return { ok: false, error: 'Missing settings or stats' };
    }

    if (!isVersion1Object(obj.settings)) {
      return { ok: false, error: 'Invalid settings version' };
    }
    if (!isVersion1Object(obj.stats)) {
      return { ok: false, error: 'Invalid stats version' };
    }

    // All validations passed: merge over defaults so a partial blob never
    // persists an incomplete shape, then save.
    saveSettings(mergeSettings(obj.settings));
    saveStats(mergeStats(obj.stats));

    // Restore the rest of the user's state when the blob carries it. Each is
    // OPTIONAL: exports taken before these were included must keep importing
    // cleanly, or the backups people already hold become worthless.
    const extras = parsed as Record<string, unknown>;
    for (const { key, field } of EXTRA_KEYS) {
      const value = extras[field];
      if (value === undefined) continue;
      writeKey(key, typeof value === 'string' ? value : JSON.stringify(value));
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
