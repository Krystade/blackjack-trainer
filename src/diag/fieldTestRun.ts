/**
 * A field-test run that navigation cannot throw away.
 *
 * THE BUG THIS FIXES, in the operator's words after the first real run
 * (2026-09-19): "Can't have to go back and forth and have it reset all
 * progress." The protocol lived entirely inside the Settings screen's React
 * state, so the ticks recording which steps were done existed only while that
 * screen was mounted -- and the steps themselves REQUIRE leaving it, because
 * you cannot hear a drill speak from the settings page. Every step therefore
 * destroyed the record of the step before it. Four steps in, the run was
 * abandoned, and the log from it has no stamps at all past the second.
 *
 * So the run lives here: module state, mirrored to localStorage on every
 * change, published to whoever is rendering it. Navigating is free, the app
 * can be reloaded mid-run by the update check, and the run is still there.
 *
 * PERSISTED, unlike the voice toggle next door, and the difference is worth
 * stating because the rule there is the opposite. A microphone that reopened
 * itself on launch because of yesterday would be a privacy failure; a
 * checklist that is still on step 5 tomorrow is just a checklist. Nothing
 * here opens a microphone -- the panel does that, per step, from a tap.
 */

import { subscribeToExternalWrites } from '../store/crossTab';
import { diag } from './diagnosticLog';
import {
  DEFAULT_FIELD_TEST_CONDITION,
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  routeBlockVerdict,
  routeCells,
  type RouteAnswer,
} from './fieldTest';

const STORAGE_KEY = 'bjtrainer.fieldTestRun.v1';

export interface FieldTestRun {
  /** Whether the floating panel should be up. */
  active: boolean;
  /** Which route this run is measuring. Rides on every stamp. */
  condition: string;
  /** Where in FIELD_TEST_STEPS the operator is. */
  stepIndex: number;
  /**
   * How many times each step has been stamped, keyed `<condition>:<stepId>`.
   *
   * BY CONDITION, not by step id alone, and the difference is a reporting bug
   * rather than a tidiness one. `setFieldTestCondition` keeps the position and
   * the ticks on purpose -- the operator parks, answers six steps, then drives
   * -- but with a bare step id those six ticks then counted as freeway steps,
   * because nothing in the key said otherwise. `run-end stamped=` is the one
   * number that says how much of the protocol a leg actually covered, and on
   * the commonest mid-run event it over-reported by exactly the part measured
   * somewhere else.
   */
  stamps: Record<string, number>;
  /**
   * A short id for THIS run, so entries can be joined to it.
   *
   * Two runs under the same condition in one export used to be separable only
   * by adjacency to `run-start` -- and `run-end` is missing whenever the app
   * was killed mid-run, so the boundary was often not there at all.
   */
  runId?: string;
  /**
   * The operator's own audio settings, from before the run touched them.
   *
   * PERSISTED WITH THE RUN, because the screen's in-memory snapshot cannot
   * survive the thing it most needs to survive. `restoreRef` captured
   * `settings` on the running screen's first render -- but the steps write
   * real, persisted settings, and the update check reloads the app mid-drive
   * by design. After a reload, Resume mounts a fresh screen and captures the
   * ALREADY-MANGLED settings as "what the operator had", so the restore hands
   * back `volume: 1.5`, `wheelMode: 'answer'` and whatever `useClips` the last
   * step imposed -- permanently, and the next drill runs at 150% with the
   * recorded voice off for reasons nothing to do with the drill.
   *
   * Written once at `startFieldTestRun` and never updated, so a run that is
   * paused, reloaded, resumed and finished still gives back what it took.
   */
  before?: FieldTestBefore;
  /**
   * Whether `before` has already been given back.
   *
   * MARKED RATHER THAN DELETED, because restoring is not a once-per-run event.
   * `finish()` restores and the screen-close cleanup restores again behind it,
   * and React re-runs a cleanup and then the effect body again whenever it
   * remounts a subtree — so a snapshot that was deleted on the first restore
   * left every later one with nothing to restore FROM, falling through to a
   * whole-settings blob frozen at the screen's first render. Under a mid-drive
   * reload that blob is the protocol's own state, so the "restore" made
   * `volume: 1.5` permanent: the bug the snapshot was added to fix, delivered
   * by the code that fixes it.
   *
   * What the deletion was actually for is the next START not preferring a
   * snapshot that has already been handed back, and this says exactly that
   * without losing the values.
   */
  beforeHandedBack?: boolean;
  /**
   * Whether the operator is answering out loud as well as by tapping.
   *
   * PERSISTED, and the privacy rule next door is the reason it can be. A
   * flag that opens a microphone has no business surviving a relaunch --
   * except that `coerce` never restores a run as `active`, so nothing here
   * reaches `useVoiceControl` until somebody taps Resume. What the
   * persistence actually buys is the case it exists for: the update check
   * reloads the app MID-DRIVE by design, and a voice channel that quietly
   * died there would leave the operator talking to a screen that had stopped
   * listening -- indistinguishable, from the driver's seat, from the
   * hands-free microphone failure the protocol is hunting.
   *
   * Set on the start gate, before the run begins -- see `startFieldTestRun`
   * for why it is carried into the run rather than cleared there.
   */
  answerByVoice?: boolean;
  /**
   * The lock probe is in progress, started under this diagnostic session.
   *
   * ON THE RUN RECORD RATHER THAN IN A REF because the case it exists for is
   * the page dying. The probe asks the operator to lock the phone; if iOS
   * kills the page under the lock there is nobody left to score it, and the
   * next boot finding this marker with a session id that is not its own IS
   * the result (`frozen-unloaded`). Cleared by the runner the moment a result
   * is stamped.
   */
  lockProbe?: { startedAt: string; session: string };
  /**
   * What each step was answered, keyed like `stamps`, in the order given.
   *
   * `stamps` is a count and was enough while the only reader was the screen.
   * The route-block detector needs the answers themselves, and the diagnostic
   * log is capped at a few thousand rows and is not this module's to read
   * back. Every stamp appends; the detector reads the last.
   */
  answers?: Record<string, RouteAnswer[]>;
  /** Cells whose dormant probes are on the path. See `FieldTestStep.probe`. */
  armedProbes?: string[];
  /** Blocks already scored on the way out, keyed `<condition>:<cell>`. */
  scoredBlocks?: string[];
  /**
   * Whether this run was ENDED on purpose, rather than merely stepped out of.
   *
   * `stopFieldTestRun` and `pauseFieldTestRun` wrote the identical object, so
   * nothing in the store knew the difference — and three separate readers
   * asked it anyway. After a deliberate Finish at the last step:
   * `fieldTestRunIsResumable` stayed true, so the app opened on the field-test
   * gate on EVERY launch for two hours; the gate's arrival cue then chimed and
   * said "The field test is paused. Resume is the first button on the screen",
   * a false statement about a run the operator had ended, on a screen designed
   * to be used without looking; and `fieldTestRunIsLive` blocked the update
   * check for ten minutes after the drive was over.
   *
   * The Resume BUTTON stays regardless — it exists for a mis-tapped Finish
   * and that is worth keeping. What changes is that the app no longer volunteers
   * a finished run to somebody who did not ask for it.
   *
   * Cleared by Resume and by Start, both of which mean "somebody is in this
   * again".
   */
  endedAt?: number;
  /**
   * When this run was last written to, as a wall clock.
   *
   * Two things need to know whether a run is being worked on RIGHT NOW rather
   * than merely stored: the update check, which reloads the app from a
   * visibility change and must not do that mid-protocol, and the app's opening
   * screen, which should come back to the field test after a reload and must
   * not hijack every launch for the rest of the month because a run was
   * abandoned once.
   *
   * Wall clock rather than monotonic, deliberately: the question is asked
   * across page loads, and `performance.now()` restarts at zero on each one.
   */
  touchedAt?: number;
}

/** The subset of settings the protocol actually writes. */
export interface FieldTestBefore {
  volume: number;
  useClips: boolean;
  muted: boolean;
  enabled: boolean;
  wheelMode: 'answer' | 'talk';
}

/**
 * How recently a run must have been touched to count as being worked on.
 *
 * Ten minutes is longer than any gap between steps in the protocol (the
 * longest gate waits ten seconds) and shorter than the gap between one drive
 * and the next.
 */
export const RUN_LIVE_MS = 10 * 60_000;

/** Two hours: long enough to survive a coffee stop, short enough to expire. */
export const RUN_RESUMABLE_MS = 2 * 60 * 60_000;

export const IDLE_RUN: FieldTestRun = {
  active: false,
  condition: DEFAULT_FIELD_TEST_CONDITION,
  stepIndex: 0,
  stamps: {},
};

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Coerce whatever is in storage into a usable run.
 *
 * Defensive because the step list changes between releases: a run saved when
 * there were ten steps must not leave a reloaded app pointing at step 10 of
 * 9 and rendering nothing at all, which from the car is the panel having
 * vanished.
 */
function coerceStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string');
  return out.length > 0 ? out : undefined;
}

function coerceAnswers(v: unknown): Record<string, RouteAnswer[]> | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const out: Record<string, RouteAnswer[]> = {};
  for (const [k, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const kept: RouteAnswer[] = [];
    for (const a of list) {
      if (typeof a !== 'object' || a === null) continue;
      const { id, via, marks, mic } = a as Record<string, unknown>;
      if (typeof id !== 'string' || (via !== 'tap' && via !== 'voice')) continue;
      kept.push({
        id,
        via,
        ...(typeof marks === 'string' ? { marks } : {}),
        ...(typeof mic === 'string' ? { mic } : {}),
      });
    }
    if (kept.length > 0) out[k] = kept;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Hold an index inside the step list.
 *
 * No longer per-condition: every condition runs every step now. The split was
 * mine and it is what left the operator on a freeway with no wheel steps to
 * run -- "I never said I wanted to completely drop using the buttons."
 */
function clampToRun(index: number): number {
  return Math.min(Math.max(index, 0), FIELD_TEST_STEPS.length - 1);
}

/**
 * Drop stamps for steps the protocol no longer has.
 *
 * `finish()` reports `Object.keys(stamps).length` as the number of steps
 * stamped, so ids left behind by a release that removed a step made the run
 * look more complete than it was.
 */
function prunedStamps(
  stamps: Record<string, number>,
  condition: string,
): Record<string, number> {
  const known = new Set(FIELD_TEST_STEPS.map((s) => s.id));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stamps)) {
    // A bare step id is a run stored by a build from before stamps carried the
    // condition. Adopted onto the run's current condition rather than dropped:
    // a resumed run losing its ticks is the failure this pruning exists to
    // avoid, and the run's own condition is the best available answer.
    const key = k.includes(':') ? k : `${condition}:${k}`;
    const stepId = key.slice(key.indexOf(':') + 1);
    if (known.has(stepId)) out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

/**
 * How many distinct steps have been stamped under one condition.
 *
 * The only reader of the stamp COUNT, and the reason the keys carry the
 * condition. See the `stamps` field above.
 */
export function countStampedSteps(stamps: Record<string, number>, condition: string): number {
  const prefix = `${condition}:`;
  return Object.keys(stamps).filter((k) => k.startsWith(prefix)).length;
}

/** Only a fully-formed snapshot is usable; a partial one would restore junk. */
function coerceBefore(raw: unknown): FieldTestBefore | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const b = raw as Partial<FieldTestBefore>;
  if (
    typeof b.volume !== 'number' ||
    !Number.isFinite(b.volume) ||
    typeof b.useClips !== 'boolean' ||
    typeof b.muted !== 'boolean' ||
    typeof b.enabled !== 'boolean' ||
    (b.wheelMode !== 'answer' && b.wheelMode !== 'talk')
  ) {
    return undefined;
  }
  return {
    volume: b.volume,
    useClips: b.useClips,
    muted: b.muted,
    enabled: b.enabled,
    // CHECKED BY VALUE, not merely by type. This was the one field validated
    // as `typeof === 'string'` and then cast into a two-value union at the
    // call site. `mergeSettings` spreads without validating, so an arbitrary
    // string out of an old or corrupt run blob went straight into settings and
    // survived every reload -- a wheel mode the app has no branch for.
    wheelMode: b.wheelMode,
  };
}

function coerce(raw: unknown): FieldTestRun {
  if (typeof raw !== 'object' || raw === null) return { ...IDLE_RUN };
  const r = raw as Partial<FieldTestRun>;
  const stamps: Record<string, number> = {};
  if (typeof r.stamps === 'object' && r.stamps !== null) {
    for (const [k, v] of Object.entries(r.stamps)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) stamps[k] = Math.floor(v);
    }
  }
  const index =
    typeof r.stepIndex === 'number' && Number.isFinite(r.stepIndex) ? Math.floor(r.stepIndex) : 0;
  // THE CONDITION HAS TO BE ONE THIS BUILD KNOWS, and unlike `before.wheelMode`
  // it was taken on trust. `motionForCondition` answers `parked` for anything
  // it does not recognise, so a run carrying an id a later release renamed came
  // back from storage with the driving warning quietly gone — and its stamps
  // under a prefix `countStampedSteps` can never match, so the same run also
  // read as having no steps done. Substituted rather than dropped, logged
  // rather than silent, and the ticks are carried across by the same adoption
  // rule that carries a pre-condition run's bare keys.
  const declared = typeof r.condition === 'string' ? r.condition : undefined;
  const known = declared !== undefined && FIELD_TEST_CONDITIONS.some((c) => c.id === declared);
  const condition = known ? (declared as string) : DEFAULT_FIELD_TEST_CONDITION;
  if (declared !== undefined && !known) {
    diag('test', 'run-condition-unknown', { was: declared, read_as: condition });
    const prefix = `${declared}:`;
    for (const k of Object.keys(stamps)) {
      if (!k.startsWith(prefix)) continue;
      stamps[k.slice(prefix.length)] = stamps[k]!;
      delete stamps[k];
    }
  }
  return {
    // NEVER RESTORED AS ACTIVE, and this is a privacy rule rather than a
    // tidiness one. `mic-route` declares `voice: true`, so a run restored
    // straight into `RunningTest` at that step opens the microphone from a
    // single navigation tap, with yesterday's abandoned run as the only
    // consent -- the orange iOS indicator appearing because the operator
    // opened a screen. voiceSession.ts promises "a reload or a relaunch
    // starts with voice off"; this is what keeps that true. The position and
    // the stamps survive, so Resume costs one deliberate tap.
    active: false,
    condition,
    stepIndex: clampToRun(index),
    stamps: prunedStamps(stamps, condition),
    // CARRIED THROUGH THE RELOAD. Dropping it here would make the field
    // pointless: the mid-drive reload is the case it exists for.
    before: coerceBefore(r.before),
    // Carried through the reload alongside the snapshot it qualifies: a run
    // reloaded after a clean pause has already been given its settings back,
    // and Resume re-takes the snapshot rather than trusting the spent one.
    beforeHandedBack: r.beforeHandedBack === true ? true : undefined,
    // Carried through the reload -- that is the whole point of persisting it.
    answerByVoice: r.answerByVoice === true ? true : undefined,
    // Carried through the reload: the reload is the result it records.
    answers: coerceAnswers(r.answers),
    armedProbes: coerceStrings(r.armedProbes),
    scoredBlocks: coerceStrings(r.scoredBlocks),
    lockProbe:
      typeof r.lockProbe === 'object' &&
      r.lockProbe !== null &&
      typeof (r.lockProbe as { startedAt?: unknown }).startedAt === 'string' &&
      typeof (r.lockProbe as { session?: unknown }).session === 'string'
        ? { startedAt: r.lockProbe.startedAt, session: r.lockProbe.session }
        : undefined,
    runId: typeof r.runId === 'string' ? r.runId : undefined,
    // Carried through the reload for the same reason as `touchedAt`: the
    // launch screen and the update check both read it, and both of them run
    // on the far side of exactly that reload.
    endedAt: typeof r.endedAt === 'number' && Number.isFinite(r.endedAt) ? r.endedAt : undefined,
    // Carried through the reload, because the reload is exactly what it is
    // there to be read across.
    touchedAt:
      typeof r.touchedAt === 'number' && Number.isFinite(r.touchedAt) ? r.touchedAt : undefined,
  };
}

/**
 * How long ago this run was last written to, or `undefined` if never.
 *
 * Exported rather than inlined at the two call sites because both of them are
 * making the same judgement -- is somebody in the middle of this -- and they
 * must not drift apart.
 */
export function fieldTestRunAgeMs(now = Date.now()): number | undefined {
  const at = readFieldTestRun().touchedAt;
  return typeof at === 'number' ? Math.max(0, now - at) : undefined;
}

/**
 * Is a run being worked on right now?
 *
 * Used by the update check, which reloads the app on a visibility change and
 * must not do that in the middle of a measured protocol.
 */
export function fieldTestRunIsLive(now = Date.now()): boolean {
  const age = fieldTestRunAgeMs(now);
  // NOT A RUN THAT WAS FINISHED. `finish()` writes and therefore touches, so
  // without this the update check stayed blocked for ten minutes after the
  // drive ended -- on a phone that has just been put down, which is the one
  // moment reloading for an update costs nothing at all.
  if (readFieldTestRun().endedAt !== undefined) return false;
  return age !== undefined && age < RUN_LIVE_MS && readFieldTestRun().stepIndex > 0;
}

/**
 * Is there a run recent enough that the app should open on it?
 *
 * A reload mid-drive used to land on Home, because nothing persists which
 * screen was open — and the way back is the start gate, which is the screen
 * a driver is least able to use. Bounded in time so one abandoned run does not
 * own the app's opening screen for the rest of the month.
 */
export function fieldTestRunIsResumable(now = Date.now()): boolean {
  const age = fieldTestRunAgeMs(now);
  // A run the operator ENDED is not something to come back to. `finish()`
  // keeps `stepIndex` on purpose (a mis-tapped Finish must be recoverable),
  // and that made every completed run hijack the app's opening screen for two
  // hours and speak "The field test is paused" at somebody who had finished it.
  if (readFieldTestRun().endedAt !== undefined) return false;
  return age !== undefined && age < RUN_RESUMABLE_MS && readFieldTestRun().stepIndex > 0;
}

let run: FieldTestRun | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a subscriber must never take the run down with it */
    }
  }
}

function write(next: FieldTestRun): void {
  // STAMPED HERE, so no caller can forget. Every mutation of the run is a
  // sign of life, and the two readers of this field are asking exactly that.
  next = { ...next, touchedAt: Date.now() };
  run = next;
  const s = storage();
  if (s) {
    try {
      s.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Out of quota, or private mode. The run continues in memory; losing it
      // on reload is far better than losing it on the next navigation, which
      // is the failure actually being fixed here.
    }
  }
  notify();
}

/**
 * Listen for the OTHER tab writing this run, once.
 *
 * Being in `OWNED_KEYS` is not enough on its own: App's handler re-reads
 * settings and the active profile and nothing else, so a run written by
 * another tab would sit on disk under a `run` cache that never expires. This
 * drops the cache and republishes, which is the whole contract -- a tab must
 * never hold a snapshot long enough to save it back over newer work.
 *
 * Installed LAZILY rather than at module load because there is no `window`
 * when this module is first imported under the node test environment, so a
 * top-level call would bind to nothing and be impossible to exercise.
 */
let crossTabInstalled = false;

function ensureCrossTab(): void {
  if (crossTabInstalled) return;
  // NOT LATCHED WHEN THERE IS NOTHING TO LATCH ONTO. `subscribeToExternalWrites`
  // hands back a no-op when there is no window, and the first read can easily
  // happen before one exists — a module-scope import, a test, a render on a
  // server. Latching on that read left this page with the flag set and no
  // listener installed, so every later cross-tab write went unseen for the
  // life of the page.
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  crossTabInstalled = true;
  subscribeToExternalWrites([STORAGE_KEY], () => {
    const before = run;
    run = null;
    let next = readFieldTestRun();
    // WHETHER SOMEBODY IS STANDING IN THIS RUN IS THIS TAB'S FACT, and it is
    // the one field a write from another tab can never legitimately carry.
    // `coerce` forces `active: false` on everything read from storage — a
    // deliberate privacy rule, so a reload never reopens the microphone by
    // itself — and re-reading on somebody else's write applied that rule to
    // a tab that is mid-drive. Opening the picker in a second tab therefore
    // dropped the driving tab back to the start gate and handed its settings
    // back underneath the operator. The position and the stamps come from the
    // store; being in the run does not.
    const heldActive = before?.active === true && !next.active;
    if (heldActive) {
      next = { ...next, active: true };
      run = next;
    }
    // Logged because from inside the car this looks like the app moving on
    // its own: the panel jumps to another step, or the ticks change, with
    // nobody touching it. A line saying another tab did it is the difference
    // between a diagnosis and a ghost.
    diag('test', 'run-external-write', {
      from: before ? before.stepIndex : null,
      to: next.stepIndex,
      condition: next.condition,
      active: next.active,
      // Says so explicitly: the tab is still running because it refused the
      // write's answer to that question, not because the write agreed.
      heldActive: heldActive || undefined,
    });
    notify();
  });
}

export function readFieldTestRun(): FieldTestRun {
  ensureCrossTab();
  if (run) return run;
  const s = storage();
  if (!s) {
    run = { ...IDLE_RUN };
    return run;
  }
  try {
    const raw = s.getItem(STORAGE_KEY);
    run = raw ? coerce(JSON.parse(raw)) : { ...IDLE_RUN };
  } catch {
    run = { ...IDLE_RUN };
  }
  return run;
}

export function subscribeFieldTestRun(fn: () => void): () => void {
  ensureCrossTab();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Begin a run under `condition`, from step one, with no stamps.
 *
 * Starting clears the previous run's ticks rather than resuming it: the same
 * step under a different route is a different measurement, and a tick carried
 * across reads as already done when it is not.
 */
function newRunId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export function startFieldTestRun(condition: string, before?: FieldTestBefore): void {
  write({
    active: true,
    condition,
    stepIndex: 0,
    stamps: {},
    answers: undefined,
    armedProbes: undefined,
    scoredBlocks: undefined,
    before,
    /*
     * CARRIED, and the first version of this cleared it -- which broke the
     * feature outright. The switch lives on the START GATE, because that is
     * the screen the operator reads while parked and the decision belongs
     * before the drive. So the value being cleared here is the one they set
     * seconds ago on the screen they are looking at, and Start silently
     * undid it every time.
     *
     * Nothing is lost by carrying it: `coerce` never restores a run as
     * active, so a flag read back from storage cannot open a microphone
     * until somebody taps Start or Resume -- which is exactly the deliberate
     * act this is recording.
     */
    answerByVoice: readFieldTestRun().answerByVoice,
    // A fresh run owes this snapshot back, whether it was just taken from the
    // live settings or carried over from a run interrupted mid-drive.
    beforeHandedBack: undefined,
    runId: newRunId(),
  });
}

/** Set or clear the lock probe's marker. See `FieldTestRun.lockProbe`. */
export function setFieldTestLockProbe(
  marker: { startedAt: string; session: string } | undefined,
): void {
  const current = readFieldTestRun();
  write({ ...current, lockProbe: marker });
}

/**
 * Turn the spoken answer channel on or off for this run.
 *
 * Logged rather than silently written, because it changes what the run
 * MEASURES: on a step that does not itself ask for the microphone, answering
 * out loud opens one, and an open microphone is what flips the phone to the
 * car's hands-free profile. Anyone reading the export has to be able to see
 * where in the run that started.
 */
export function setFieldTestAnswerByVoice(on: boolean): void {
  const current = readFieldTestRun();
  if ((current.answerByVoice === true) === on) return;
  diag('test', 'answer-by-voice', { on, atStep: current.stepIndex });
  write({ ...current, answerByVoice: on ? true : undefined });
}

/**
 * What the operator had before this run started, if it was recorded.
 *
 * `undefined` for a run begun by an older build, in which case the caller
 * falls back to its own snapshot -- worse, but not worse than nothing.
 */
export function fieldTestBefore(): FieldTestBefore | undefined {
  return readFieldTestRun().before;
}

/**
 * The snapshot has been handed back, so it is no longer owed.
 *
 * WHY THIS HAS TO EXIST. `startFieldTestRun` prefers a stored snapshot over the
 * live settings, because after a mid-drive reload the persisted settings ARE
 * the protocol's and capturing them would make the protocol's state the
 * operator's, permanently. That is right. What was missing is the other half:
 * once `restoreSettings` has actually handed the snapshot back, it describes a
 * moment that has passed, and preferring it on the NEXT start reverts anything
 * the operator changed in between.
 *
 * Reproduced: the operator is told step one needs audio, turns "Audio enabled"
 * on between the car-park leg and the freeway leg, finishes the freeway leg,
 * and the app is silent again with nothing saying why. Same class of bug as the
 * one the preference was added to fix, pointing the other way.
 *
 * MARKED, NOT DELETED. This used to delete the snapshot, which broke restoring
 * itself: `finish()` restores and the screen-close cleanup restores again after
 * it, React re-runs both halves of an effect whenever it remounts a subtree,
 * and the second restore found nothing and wrote a stale whole-settings blob
 * instead. The flag draws the distinction the deletion was reaching for —
 * spent for the purpose of the NEXT start, still readable for the purpose of
 * giving the same settings back again.
 *
 * So the rule is: the snapshot lives from the start of a run until it is handed
 * back, and a reload does not hand anything back. Marked here; re-taken on the
 * next start or resume.
 */
export function markFieldTestBeforeHandedBack(): void {
  const current = readFieldTestRun();
  if (current.before === undefined || current.beforeHandedBack === true) return;
  write({ ...current, beforeHandedBack: true });
}

/**
 * The protocol has taken the operator's settings again, so it owes them again.
 *
 * WHY A HAND-BACK CAN BE TAKEN BACK. The screen-close cleanup restores the
 * settings, because leaving by the tab bar is the ordinary way out of a run and
 * it has to cost the operator nothing. That cleanup cannot tell a real exit
 * from React tearing the subtree down and immediately putting it back — which
 * it does on a remount, and does deliberately on every mount in development.
 * Marking the snapshot spent from there therefore fired when nothing had been
 * handed back at all, and the next "Start over" captured the PROTOCOL's volume
 * as the operator's.
 *
 * The distinction a cleanup cannot make, the next commit can: a remount
 * re-applies the current step's setup, so the protocol is holding the
 * operator's settings again; a real exit never does. Called from the step
 * effect, immediately after it seizes them.
 */
export function markFieldTestBeforeOwed(): void {
  const current = readFieldTestRun();
  if (current.before === undefined || current.beforeHandedBack !== true) return;
  write({ ...current, beforeHandedBack: undefined });
}

/**
 * The snapshot only if it is still owed, for deciding what a new run seizes.
 *
 * `fieldTestBefore()` answers "what were the operator's settings", which stays
 * true after they have been given back. This answers "is this run still
 * holding them", which does not.
 */
export function unspentFieldTestBefore(now = Date.now()): FieldTestBefore | undefined {
  const current = readFieldTestRun();
  if (current.beforeHandedBack === true) return undefined;
  /**
   * AND ONLY WHILE THE INTERRUPTION IT EXISTS FOR IS STILL PLAUSIBLE.
   *
   * The preference for a stored snapshot is there to survive one thing: a run
   * that was killed before it could hand the settings back. Force-quitting
   * from the running screen does exactly that — no React cleanup runs —
   * and the gate's own session warning tells the operator to force-quit
   * between legs, so it is a state the protocol asks for.
   *
   * Unbounded, it then outlived its purpose: the operator relaunches, turns
   * the volume down or switches the recorded voice off ON PURPOSE, starts the
   * next leg, and the new run adopts the pre-crash snapshot as `before` —
   * so its restore writes the deliberate change away, permanently. That is
   * the same bug `beforeHandedBack` was added to fix, reached through the one
   * door that fix left open.
   *
   * The same two hours Resume uses, and for the same reason: past it, the
   * likeliest explanation of a stale snapshot is no longer "the app was
   * killed mid-run" but "these are last week's settings".
   */
  const age = fieldTestRunAgeMs(now);
  if (age !== undefined && age >= RUN_RESUMABLE_MS) return undefined;
  // A run that was ENDED handed its settings back through `finish()`. If the
  // flag says otherwise the restore genuinely did not happen, so the snapshot
  // is still owed -- but an ended run older than the window above is not.
  return current.before;
}

/**
 * Re-take the snapshot for a run being resumed.
 *
 * Resume comes after a pause, and pausing hands the settings back -- so by the
 * time Resume is tapped the settings on disk are the operator's again, and they
 * may not be the ones the run started with. The run is about to seize them a
 * second time, so it has to record what it is seizing.
 */
export function setFieldTestBefore(before: FieldTestBefore): void {
  // Unspent again by definition: this is the run taking the settings a second
  // time, so it owes them back a second time.
  write({ ...readFieldTestRun(), before, beforeHandedBack: undefined });
}

/**
 * Pick a stored run back up where it was left.
 *
 * Separate from `startFieldTestRun` on purpose: starting is "this is a new
 * measurement, throw the old ticks away", resuming is "I was on step 14 and
 * tapped Finish by mistake". Conflating them is what made a single stray tap
 * cost the whole run.
 */
export function resumeFieldTestRun(): void {
  // Un-ends it: whatever this run was before, somebody is in it now.
  write({ ...readFieldTestRun(), active: true, endedAt: undefined });
}

/** End a run deliberately. See `endedAt` for what that buys over pausing. */
export function stopFieldTestRun(): void {
  write({ ...readFieldTestRun(), active: false, endedAt: Date.now() });
}

/**
 * Step out of a run without ending it.
 *
 * Identical in effect to `stopFieldTestRun` today, and named separately
 * because the two mean opposite things to the operator and will not stay
 * identical: stopping is "this run is over", pausing is "I am going to look
 * at something else for a minute".
 *
 * WHY IT HAD TO EXIST. Pause used to log a line and navigate, leaving
 * `active: true` in module state. `readFieldTestRun` returns that object
 * directly without going through `coerce`, so `coerce`'s "never restore as
 * active" privacy rule -- which only applies to a read from storage after a
 * reload -- did not cover re-entry within the same page load. Tapping the
 * Field test tab again therefore skipped the start gate entirely and mounted
 * the running screen, which re-applies the step's setup: on `mic-route` that
 * opens the microphone from a single navigation tap, with an abandoned run as
 * the only consent. The comment on the Pause button promised "re-entering
 * offers Resume"; this is what makes that true.
 */
export function pauseFieldTestRun(): void {
  // NO `endedAt`, and that is now the entire difference between the two. A
  // pause is the case the launch screen and the spoken "Resume is the first
  // button" cue exist for; a Finish is not.
  write({ ...readFieldTestRun(), active: false });
}

/**
 * Switch route. KEEPS the position and the ticks when there is a run to keep.
 *
 * This was the real one-tap destroyer, and it had no guard while Finish -- a
 * button that actually preserves everything -- had a two-tap one. The picker
 * sits directly above Resume on the start gate, which is precisely the screen
 * an interrupted run comes back to: one mis-tap zeroed `stepIndex`, emptied
 * `stamps`, and made the Resume button vanish (its `stepIndex > 0` guard no
 * longer held). Reproduced from a run at step 7 with three stamps: gone,
 * unrecoverably, with nothing asked and nothing said.
 *
 * Changing condition mid-run is a real thing to want -- the operator parks,
 * then drives -- and the honest record of it is the condition stamped on each
 * answer, which every entry already carries. So the run continues where it
 * was, under the new condition, and the log shows exactly where the change
 * happened. Starting over remains available and explicit: that is what Start
 * is for.
 */
export function setFieldTestCondition(condition: string): void {
  const current = readFieldTestRun();
  if (current.condition === condition) return;
  diag('test', 'condition-changed', {
    from: current.condition,
    to: condition,
    atStep: current.stepIndex,
    // Under the condition being LEFT, which is the only one those stamps
    // describe -- see `countStampedSteps`.
    stamped: countStampedSteps(current.stamps, current.condition),
  });
  write({ ...current, condition });
}

export function goToFieldTestStep(index: number): void {
  const current = readFieldTestRun();
  write({ ...current, stepIndex: clampToRun(index) });
}

/**
 * Record that a step was stamped, and how many times.
 *
 * The count is not the record -- the diagnostic log is -- it is there so a
 * step done at a red light is visibly done when you next look at the screen,
 * and so a double-tap is visibly two rather than silently one.
 */
export function markFieldTestStamped(stepId: string, answer?: RouteAnswer): void {
  const current = readFieldTestRun();
  // Keyed with the condition the stamp was made under. The condition is read
  // here rather than passed in so no caller can key one incorrectly.
  const key = `${current.condition}:${stepId}`;
  write({
    ...current,
    stamps: { ...current.stamps, [key]: (current.stamps[key] ?? 0) + 1 },
    ...(answer
      ? { answers: { ...current.answers, [key]: [...(current.answers?.[key] ?? []), answer] } }
      : {}),
  });
}

/** What decides which steps are on a run's path. */
export type FieldTestPath = Pick<FieldTestRun, 'condition' | 'armedProbes'>;

/**
 * Whether the step at `index` is on the path for this run.
 *
 * Two rules, both on the RUN rather than the list -- `FIELD_TEST_STEPS` is
 * one list for every condition and `resolveFieldTestSetup` is a function of
 * the index, and both stay so:
 *
 *  - a dormant probe is on the path once its cell is armed;
 *  - a wheel step is off the path when the condition has no Bluetooth.
 *    There is no car to press into, and the first answer to that ("No
 *    Bluetooth" first on every wheel step) was still seven steps of nothing
 *    on the 2026-09-27 drive: "the bluetooth off tests need to skip the
 *    bluetooth required ones, don't just put a button there."
 */
function onPath(index: number, run: FieldTestPath): boolean {
  const step = FIELD_TEST_STEPS[index];
  if (!step) return false;
  if (step.probe && !run.armedProbes?.includes(step.probe)) return false;
  if (step.wheel && conditionOf(run.condition)?.bluetooth === false) return false;
  return true;
}

function conditionOf(id: string) {
  return FIELD_TEST_CONDITIONS.find((c) => c.id === id);
}

/**
 * The next index on the path in direction `dir`, or `from` if there is none.
 *
 * `stepIndex` stays a plain index into `FIELD_TEST_STEPS` -- the setup fold
 * depends on that -- so a step off the path is skipped by the pointer's
 * movement rather than by its absence from the list.
 */
export function nextActiveIndex(from: number, dir: 1 | -1, run: FieldTestPath): number {
  for (let i = from + dir; i >= 0 && i < FIELD_TEST_STEPS.length; i += dir) {
    if (onPath(i, run)) return i;
  }
  return from;
}

/** How many steps are on this run's path. */
export function fieldTestStepCount(run: FieldTestPath): number {
  let n = 0;
  for (let i = 0; i < FIELD_TEST_STEPS.length; i += 1) if (onPath(i, run)) n += 1;
  return n;
}

/** The 1-based position of the current step on this run's path. */
export function fieldTestStepOrdinal(run: FieldTestRun): number {
  let n = 0;
  for (let i = 0; i <= run.stepIndex && i < FIELD_TEST_STEPS.length; i += 1) {
    if (onPath(i, run)) n += 1;
  }
  return n;
}

/**
 * Leave the current step forwards, scoring a route block on the way out.
 *
 * ON THE WAY OUT OF THE BLOCK, not at the second answer: acting at stamp two
 * would put a step between `route-2` and `route-3` and break the A, B, A
 * every cell is built on. Every block writes a `route-block` row -- agreeing
 * ones included, so one grep returns all six cells -- and a block that
 * disagrees with itself, moved mid-line, or said too little arms the four
 * dormant probes behind it, if it has any. Scored once per condition and
 * cell: Back and forward again does not write a second row.
 */
export function advanceFieldTestStep(): void {
  let current = readFieldTestRun();
  const step = FIELD_TEST_STEPS[current.stepIndex];
  const cell = step ? [...routeCells()].find(([, ids]) => ids.at(-1) === step.id) : undefined;
  if (cell) {
    const [key, ids] = cell;
    const scoredKey = `${current.condition}:${key}`;
    if (!current.scoredBlocks?.includes(scoredKey)) {
      const v = routeBlockVerdict(ids, current.answers ?? {}, current.condition);
      const site = FIELD_TEST_STEPS.find((s) => s.probe === key);
      const arm = v.verdict !== 'uniform' && site !== undefined && !current.armedProbes?.includes(key);
      diag('test', 'route-block', {
        cell: key,
        steps: ids.join(', '),
        condition: current.condition,
        verdict: v.verdict,
        classes: v.classes.join(', '),
        answers: v.answers.join(', '),
        armed: arm,
        ...(site ? { probe: site.id } : {}),
      });
      current = {
        ...current,
        scoredBlocks: [...(current.scoredBlocks ?? []), scoredKey],
        ...(arm ? { armedProbes: [...(current.armedProbes ?? []), key] } : {}),
      };
    }
  }
  write({ ...current, stepIndex: nextActiveIndex(current.stepIndex, 1, current) });
}

/** Leave the current step backwards. Nothing is scored on the way back. */
export function retreatFieldTestStep(): void {
  const current = readFieldTestRun();
  write({ ...current, stepIndex: nextActiveIndex(current.stepIndex, -1, current) });
}

/** Test-only: forget the run and every subscriber. */
export function _resetFieldTestRunForTest(): void {
  run = null;
  listeners.clear();
  crossTabInstalled = false;
  const s = storage();
  try {
    s?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up */
  }
}
