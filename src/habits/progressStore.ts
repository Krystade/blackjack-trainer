import { quarantineRaw } from '../store/quarantine';
import type { Stats } from '../store/types';
import { getStorage, loadSettings, loadStats, setStatsSaveObserver } from '../store/persist';
import { loadCasinoLog } from '../store/casinoLog';
import { localDayKey } from '../store/practiceDays';
import { diag } from '../diag/diagnosticLog';
import { habitClock as clock, _setHabitClockForTest } from './clock';
import {
  backfillDays,
  computeStreak,
  emptyProgress,
  goalFor,
  normalizeProgress,
  recordActivity,
  signatureDelta,
  signatureTotal,
  statsSignature,
  type DailyGoal,
  type ProgressState,
  type StreakInfo,
} from './progress';
import { backfillDate, newlyEarned, type AchievementContext } from './achievements';
import { momentLine, queueMoment } from './moment';
import { guidedCompletedCount } from '../guided/store';

/**
 * Wave N: the habit tracker's persistence, under its own key. Fed by every
 * stats save (persist.ts setStatsSaveObserver): the rise in the stats'
 * answer signature is the answers that save recorded. Read-modify-write on
 * each save, straight from storage, so two tabs add to the same record.
 */

export const PROGRESS_KEY = 'bjtrainer.progress.v1';

export type HabitEvent =
  | { kind: 'goal'; streak: number }
  | { kind: 'unlock'; ids: string[] }
  | { kind: 'backfill'; count: number };

const listeners = new Set<(e: HabitEvent) => void>();
/** Events emitted before anything listened (the first-run backfill, before the toast host mounts). */
let undelivered: HabitEvent[] = [];
export function onHabitEvent(fn: (e: HabitEvent) => void): () => void {
  listeners.add(fn);
  const held = undelivered;
  undelivered = [];
  for (const e of held) fn(e);
  return () => listeners.delete(fn);
}
function emit(e: HabitEvent): void {
  if (listeners.size === 0) {
    undelivered = [...undelivered, e].slice(-3);
    return;
  }
  for (const fn of [...listeners]) {
    try {
      fn(e);
    } catch {
      /* a listener must not break saving */
    }
  }
}

export { _setHabitClockForTest };

/**
 * Whether eyes-free (Drive) is on, supplied by the shell (installHabits) so
 * this layer imports nothing from the UI.
 */
let isDrive: () => boolean = () => false;

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

export function loadProgress(): ProgressState {
  const raw = storage()?.getItem(PROGRESS_KEY);
  if (!raw) return emptyProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    keepAside(raw, 'unparseable');
    return emptyProgress();
  }
  // B5: a version this build does not know (a newer build, then a rollback)
  // or the wrong shape is kept aside before the next answer overwrites it.
  if (!parsed || typeof parsed !== 'object' || (parsed as { version?: unknown }).version !== 1) {
    keepAside(raw, 'unknown-version');
  }
  return normalizeProgress(parsed);
}

function keepAside(raw: string, reason: string): void {
  const s = storage();
  if (s) quarantineRaw(s, PROGRESS_KEY, raw, reason);
}

function saveProgress(p: ProgressState): void {
  try {
    storage()?.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* full storage: the habit record is the least of it */
  }
}

export function currentGoal(): DailyGoal {
  return goalFor(loadSettings().habits?.goal);
}

function casinoSessions(): number {
  try {
    return loadCasinoLog().sessions.filter((s) => s.end !== null).length;
  } catch {
    return 0;
  }
}

function guidedSessions(): number {
  try {
    return guidedCompletedCount();
  } catch {
    return 0;
  }
}

/**
 * Wave L (lane v): others told of every stats save, after the habit record has
 * taken it -- the guided session counts its segments' answers from these, so
 * no drill has to report to it. `replaced` as for the observer below.
 */
export type StatsSaveListener = (written: Stats, replaced: boolean, untrimmed: Stats) => void;
const saveListeners = new Set<StatsSaveListener>();
export function onStatsSaved(fn: StatsSaveListener): () => void {
  saveListeners.add(fn);
  return () => saveListeners.delete(fn);
}
function tellSaveListeners(written: Stats, replaced: boolean, untrimmed: Stats): void {
  for (const fn of [...saveListeners]) {
    try {
      fn(written, replaced, untrimmed);
    } catch {
      /* a listener must not break saving */
    }
  }
}

export function contextFor(stats: Stats, progress: ProgressState, nowMs = clock()): AchievementContext {
  return {
    stats,
    progress,
    streak: computeStreak(progress.days, localDayKey(new Date(nowMs))),
    casinoSessions: casinoSessions(),
    nowMs,
    guidedSessions: guidedSessions(),
  };
}

/**
 * First run: rebuild the days from history and award what history earned,
 * quietly, with one summary event. Idempotent: a backfilled store is left alone.
 */
export function ensureBackfilled(stats: Stats = loadStats()): ProgressState {
  const prev = loadProgress();
  if (prev.backfilled) return prev;
  const goal = currentGoal();
  const days = backfillDays(stats, goal);
  // Days already recorded live (a store from before backfill shipped) win.
  for (const [k, d] of Object.entries(prev.days)) days[k] = d;
  const sig = statsSignature(stats);
  const state: ProgressState = {
    ...prev,
    days,
    sig: prev.sig ?? sig,
    answersTotal: Math.max(prev.answersTotal, signatureTotal(sig)),
    backfilled: true,
  };
  const ctx = contextFor(stats, state);
  const ids = newlyEarned(ctx);
  const earned = { ...state.earned };
  for (const id of ids) earned[id] = backfillDate(id, ctx.streak);
  state.earned = earned;
  saveProgress(state);
  diag('nav', 'habits-backfill', { days: Object.keys(days).length, earned: ids.length });
  if (ids.length > 0) emit({ kind: 'backfill', count: ids.length });
  return state;
}

/**
 * The observer persist.ts calls after every stats write.
 *
 * `written` is what reached storage (histories trimmed to HISTORY_CAP);
 * `untrimmed` is what the caller saved. The answers a save added are the rise
 * from the stored baseline to the UNTRIMMED signature -- a full history goes
 * 2000 -> 2001 there, where the trimmed one stays flat at 2000 -- and the
 * trimmed signature becomes the next baseline, since that is what the next
 * load will hold.
 */
export function noteStatsSaved(written: Stats, replaced: boolean, untrimmed: Stats = written): void {
  const prev = ensureBackfilledQuiet(written);
  const sig = statsSignature(written);
  if (replaced) {
    saveProgress({ ...prev, sig });
    tellSaveListeners(written, true, untrimmed);
    return;
  }
  const delta = signatureDelta(prev.sig, statsSignature(untrimmed), untrimmed);
  let state: ProgressState = { ...prev, sig };
  const goal = currentGoal();
  let goalMet = false;
  const now = clock();
  if (delta.added > 0) {
    const r = recordActivity(state, now, { answers: delta.added, drive: isDrive(), durationHintMs: delta.durationHintMs }, goal);
    state = r.state;
    goalMet = r.goalMet;
  } else if (delta.undone > 0) {
    state = recordActivity(state, now, { answers: -delta.undone, drive: false }, goal).state;
  }
  const ctx = contextFor(written, state, now);
  const ids = delta.added > 0 || goalMet ? newlyEarned(ctx) : [];
  if (ids.length > 0) {
    const at = new Date(now).toISOString();
    state = { ...state, earned: { ...state.earned } };
    for (const id of ids) state.earned[id] = at;
  }
  saveProgress(state);
  if (goalMet) {
    const streak = ctx.streak.current;
    diag('nav', 'habits-goal-met', { streak, drive: isDrive() });
    if (isDrive()) queueMoment(momentLine(streak));
    emit({ kind: 'goal', streak });
  }
  if (ids.length > 0) {
    diag('nav', 'habits-unlock', { ids: ids.join(',') });
    emit({ kind: 'unlock', ids });
  }
  tellSaveListeners(written, false, untrimmed);
}

/** Backfill inside a save must not emit a second summary later; it emits once here too. */
function ensureBackfilledQuiet(stats: Stats): ProgressState {
  const p = loadProgress();
  if (p.backfilled) return p;
  // The save that triggered this already holds the new answer; backfill the
  // stats as they were is impossible here, so take these as the baseline.
  return ensureBackfilled(stats);
}

export function streakNow(progress: ProgressState = loadProgress(), nowMs = clock()): StreakInfo {
  return computeStreak(progress.days, localDayKey(new Date(nowMs)));
}

export function habitNow(): number {
  return clock();
}

/**
 * Achievements that move without a stats save (a casino session logged, a
 * goal setting changed): checked when Home shows, and toasted there.
 */
export function checkAchievementsNow(): void {
  const prev = loadProgress();
  if (!prev.backfilled) return;
  const now = clock();
  const ids = newlyEarned(contextFor(loadStats(), prev, now));
  if (ids.length === 0) return;
  const at = new Date(now).toISOString();
  const earned = { ...prev.earned };
  for (const id of ids) earned[id] = at;
  saveProgress({ ...prev, earned });
  diag('nav', 'habits-unlock', { ids: ids.join(','), from: 'home' });
  emit({ kind: 'unlock', ids });
}

let installed = false;
/** Wire the tracker to every stats save. Called once by the app shell. */
export function installHabits(opts: { isDrive?: () => boolean } = {}): void {
  if (opts.isDrive) isDrive = opts.isDrive;
  if (installed) return;
  installed = true;
  setStatsSaveObserver(noteStatsSaved);
}
export function _resetHabitsForTest(): void {
  installed = false;
  isDrive = () => false;
  listeners.clear();
  saveListeners.clear();
  undelivered = [];
  setStatsSaveObserver(null);
}
