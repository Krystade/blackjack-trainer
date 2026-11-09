import type { Stats } from '../store/types';
import { getStorage } from '../store/persist';
import type { SrDeck } from './spacedRepetition';
import { dueAfterDays } from './spacedRepetition';
import { COUNT_RUNS_JUDGED, COUNT_RUNS_NEEDED, isQualifyingRun } from './fluencyGate';
import { DRILL_WINDOW, DRILL_WINDOW_NEEDED, PLAY_MIN_GRADED, PLAY_TARGET, betSizingRows, parseTime, playDecisions } from '../ui/screens/ladderRules';
import { agoText, daysBetween, localDateKey } from '../ui/casinoFigures';

/**
 * Track 3 (3B): rust checks. A rung passed once is not passed for good: left
 * unpractised it comes due for a short re-test, and a missed re-test puts the
 * rung back to work.
 *
 * - First re-test RUST_INTERVALS_DAYS[0] days after the rung was proven or
 *   last practised, whichever is later (the practice clock: any practice of
 *   the rung's skill pushes it back -- D2: any count run, eyes-free included).
 * - Each re-test passed in a row moves to the next interval (14, 30, 60, 120).
 * - A missed re-test resets to the first interval and marks the rung needing
 *   work: it reads not passed until a fresh re-test passes.
 * - Only a rung the live ladder passes is tracked. A rung the welcome skipped
 *   is never passed, so it never goes rusty; 'repair' follows 'basic' and has
 *   no re-test of its own.
 *
 * Re-test evidence is only what was answered after the re-test opened: dated
 * rows from `retest.from`, or for the two lifetime counters (basic strategy's
 * categories, the deviations' perIndex) the growth over a baseline taken when
 * it opened. Pure but for loadRust / saveRust; Home is the one writer.
 */

export const RUST_KEY = 'bjtrainer.rust.v1';
export const RUST_INTERVALS_DAYS: readonly number[] = [14, 30, 60, 120];

export type RustRung = 'basic' | 'count' | 'tc' | 'deviations' | 'betramp' | 'play';
export const RUST_RUNGS: readonly RustRung[] = ['basic', 'count', 'tc', 'deviations', 'betramp', 'play'];

/** A right/wrong figure; `parts` splits it (basic: by category, deviations: by index). */
export interface Evidence {
  n: number;
  right: number;
  parts?: Record<string, { n: number; right: number }>;
}

export interface RungRust {
  /** Re-tests passed in a row since the rung was (re)proven; picks the interval. */
  step: number;
  /** Epoch ms the rung was last proven: first seen passed, or a re-test passed. */
  provenAt: number;
  /** An open re-test: evidence counts from `from`, counters over `baseline`. */
  retest?: { from: number; baseline: Evidence };
  /** The last re-test was missed: the rung reads not passed until one passes. */
  needsWork?: true;
  /** The last judged re-test, for the copy ("Missed its re-test: 2 of 5"). */
  last?: { at: number; passed: boolean; step: number; n: number; right: number };
}

export interface RustStore {
  version: 1;
  rungs: Partial<Record<RustRung, RungRust>>;
}

export const EMPTY_RUST: RustStore = { version: 1, rungs: {} };

/** What the rust rules read besides stats. */
export interface RustInputs {
  /** The active profile's index ids (deviations' re-test asks them all). */
  activeIds: readonly string[];
  /** The quiz deck: deviations' practice clock is its latest lastSeenAt. */
  quizSr?: SrDeck;
}

const isRustRung = (id: string): id is RustRung => (RUST_RUNGS as readonly string[]).includes(id);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The interval, in days, of a rung `step` re-tests in. */
export function rustIntervalDays(step: number): number {
  return RUST_INTERVALS_DAYS[Math.min(Math.max(0, step), RUST_INTERVALS_DAYS.length - 1)]!;
}

const lastRowAt = (rows: readonly { date?: unknown }[] | undefined): number =>
  Array.isArray(rows) ? Math.max(0, ...rows.map((r) => parseTime(r?.date))) : 0;

/**
 * When the rung's skill was last practised (epoch ms; 0 = no date on record).
 * Practice, not proof: D2 -- any count run counts, eyes-free and short ones
 * included, though only qualifying runs pass a re-test.
 */
export function practiceClock(rung: RustRung, stats: Stats, inputs: RustInputs): number {
  switch (rung) {
    case 'basic':
      return Math.max(0, ...Object.values(stats.cellStats ?? {}).map((t) => parseTime(t?.lastAt)));
    case 'count':
      return lastRowAt(stats.countDrill?.history);
    case 'tc':
      return Math.max(lastRowAt(stats.deckEstimation?.history), lastRowAt(stats.trueCount?.history));
    case 'deviations':
      return Math.max(0, ...inputs.activeIds.map((id) => num(inputs.quizSr?.[id]?.lastSeenAt)));
    case 'betramp':
      return lastRowAt(betSizingRows(stats));
    case 'play':
      return lastRowAt(stats.sessions);
  }
}

const BASIC_PARTS = ['hard', 'soft', 'pairs'] as const;

/**
 * The lifetime counters a re-test's baseline is taken from. Only basic and
 * deviations are judged on counters; the dated rungs filter rows by date and
 * keep an empty baseline.
 */
export function counterEvidence(rung: RustRung, stats: Stats): Evidence {
  const parts: Record<string, { n: number; right: number }> = {};
  if (rung === 'basic') {
    for (const p of BASIC_PARTS) {
      const t = stats.categories?.[p];
      parts[p] = { n: num(t?.right) + num(t?.wrong), right: num(t?.right) };
    }
  } else if (rung === 'deviations') {
    // Every index on record, not just the active set: one switched on later
    // must not count its whole history as fresh.
    for (const [id, t] of Object.entries(stats.perIndex ?? {})) {
      parts[id] = { n: num(t?.right) + num(t?.wrong), right: num(t?.right) };
    }
  } else {
    return { n: 0, right: 0 };
  }
  const vals = Object.values(parts);
  return { n: vals.reduce((s, v) => s + v.n, 0), right: vals.reduce((s, v) => s + v.right, 0), parts };
}

/** The growth of `part` over the baseline, clamped at 0 (a reset or restore never goes negative). */
function freshPart(now: Evidence, base: Evidence, key: string): { n: number; right: number } {
  const a = now.parts?.[key] ?? { n: 0, right: 0 };
  const b = base.parts?.[key] ?? { n: 0, right: 0 };
  const n = Math.max(0, a.n - b.n);
  return { n, right: Math.min(n, Math.max(0, a.right - b.right)) };
}

export type RetestStatus = 'pending' | 'pass' | 'fail';

export interface RetestJudgement {
  status: RetestStatus;
  /** The evidence so far, pooled. */
  n: number;
  right: number;
  /** Short, for the ladder row: what the re-test has and what it needs. */
  progress: string;
}

/** The first `k` rows dated at or after `from`, in order. */
function firstSince<T extends { date?: unknown }>(rows: readonly T[] | undefined, from: number, k: number, keep: (r: T) => boolean = () => true): T[] {
  return (Array.isArray(rows) ? rows : []).filter((r) => r && parseTime(r.date) >= from && keep(r)).slice(0, k);
}

/**
 * The open re-test's verdict on what has been answered since it opened.
 * Judged once there is enough (each rung's own "enough"), never before.
 */
export function judgeRetest(rung: RustRung, retest: NonNullable<RungRust['retest']>, stats: Stats, inputs: RustInputs): RetestJudgement {
  const { from, baseline } = retest;
  switch (rung) {
    case 'basic': {
      // Per category, never pooled: one category gone rusty is the rust.
      const now = counterEvidence('basic', stats);
      const parts = BASIC_PARTS.map((p) => ({ p, ...freshPart(now, baseline, p) }));
      const n = parts.reduce((s, x) => s + x.n, 0);
      const right = parts.reduce((s, x) => s + x.right, 0);
      const enough = parts.every((x) => x.n >= RETEST_BASIC_PER_PART);
      const pass = parts.every((x) => x.n > 0 && x.right / x.n >= RETEST_TARGET);
      return {
        status: !enough ? 'pending' : pass ? 'pass' : 'fail',
        n,
        right,
        progress: `Re-test: ${parts.map((x) => `${x.p} ${Math.min(x.n, RETEST_BASIC_PER_PART)}/${RETEST_BASIC_PER_PART}`).join(' · ')}`,
      };
    }
    case 'count': {
      const rows = firstSince(stats.countDrill?.history, from, COUNT_RUNS_JUDGED, (r) => isQualifyingRun(r));
      const right = rows.filter((r) => r.correct === true).length;
      return {
        status: rows.length < COUNT_RUNS_JUDGED ? 'pending' : right >= COUNT_RUNS_NEEDED ? 'pass' : 'fail',
        n: rows.length,
        right,
        progress: `Re-test: ${rows.length}/${COUNT_RUNS_JUDGED} table-pace runs`,
      };
    }
    case 'tc': {
      const deck = firstSince(stats.deckEstimation?.history, from, DRILL_WINDOW);
      // C12: as the rung, self-reported true counts are not evidence.
      const tc = firstSince(stats.trueCount?.history, from, DRILL_WINDOW, (r) => r.selfReport !== true);
      const dr = deck.filter((r) => r.correct === true).length;
      const tr = tc.filter((r) => r.correct === true).length;
      const enough = deck.length >= DRILL_WINDOW && tc.length >= DRILL_WINDOW;
      return {
        status: !enough ? 'pending' : dr >= DRILL_WINDOW_NEEDED && tr >= DRILL_WINDOW_NEEDED ? 'pass' : 'fail',
        n: deck.length + tc.length,
        right: dr + tr,
        progress: `Re-test: decks ${deck.length}/${DRILL_WINDOW} · TC ${tc.length}/${DRILL_WINDOW}`,
      };
    }
    case 'deviations': {
      const now = counterEvidence('deviations', stats);
      const parts = inputs.activeIds.map((id) => freshPart(now, baseline, id));
      const n = parts.reduce((s, x) => s + x.n, 0);
      const right = parts.reduce((s, x) => s + x.right, 0);
      const covered = parts.filter((x) => x.n > 0).length;
      const enough = covered === parts.length && n >= retestDeviationsTotal(parts.length);
      const pass = parts.every((x) => x.n > 0 && x.right / x.n >= RETEST_TARGET) && n > 0 && right / n >= RETEST_TARGET;
      return {
        status: !enough ? 'pending' : pass ? 'pass' : 'fail',
        n,
        right,
        progress: `Re-test: ${covered}/${parts.length} indices`,
      };
    }
    case 'betramp': {
      const rows = firstSince(betSizingRows(stats), from, DRILL_WINDOW);
      const right = rows.filter((r) => r.ok === true).length;
      return {
        status: rows.length < DRILL_WINDOW ? 'pending' : right >= DRILL_WINDOW_NEEDED ? 'pass' : 'fail',
        n: rows.length,
        right,
        progress: `Re-test: ${rows.length}/${DRILL_WINDOW} bet sizing answers`,
      };
    }
    case 'play': {
      // The rung's own rule (D7): a shoe played with the count and deviations
      // checked, PLAY_MIN_GRADED+ play decisions. The first such shoe decides.
      const shoe = firstSince(stats.sessions, from, 1, (s) => {
        if (s.checks && !(s.checks.count && s.checks.deviations)) return false;
        return playDecisions(s).plays >= PLAY_MIN_GRADED;
      })[0];
      if (!shoe) return { status: 'pending', n: 0, right: 0, progress: 'Re-test: no shoe yet' };
      const { plays, correct } = playDecisions(shoe);
      return {
        status: correct / plays >= PLAY_TARGET ? 'pass' : 'fail',
        n: plays,
        right: correct,
        progress: `Re-test: ${correct}/${plays} play decisions`,
      };
    }
  }
}

/** Basic strategy's re-test: this many fresh answers in each of hard, soft and pairs. */
export const RETEST_BASIC_PER_PART = 10;
/** The accuracy basic, deviations (and play, PLAY_TARGET) re-tests ask for. */
export const RETEST_TARGET = 0.9;
/** Deviations' re-test: every active index answered, and at least this many answers in all. */
export function retestDeviationsTotal(active: number): number {
  return Math.max(10, active);
}

/**
 * The store after `now`: every rung the live ladder passes is tracked, its
 * re-test opened when due and judged once it has enough. Returns `store`
 * itself when nothing changed, so a caller can compare by identity.
 *
 * `live` is the ladder judged WITHOUT rust (each rung's own rule). A rung
 * failing it is never tracked or brought due, but a re-test already open is
 * still judged: the runs that missed it are usually what un-passed the rung.
 */
export function advanceRust(
  store: RustStore,
  live: readonly { id: string; passed: boolean }[],
  stats: Stats,
  inputs: RustInputs,
  now: number,
): RustStore {
  let rungs: RustStore['rungs'] | null = null;
  const put = (id: RustRung, r: RungRust) => {
    rungs ??= { ...store.rungs };
    rungs[id] = r;
  };
  for (const { id, passed } of live) {
    if (!isRustRung(id)) continue;
    // Each stage falls through to the next, so one call settles the rung and
    // a second call with the same inputs changes nothing.
    let cur = store.rungs[id];
    // Only a passing rung is tracked or comes due; an open re-test is judged
    // either way (its runs are what un-passed the rung).
    if (!passed && !cur?.retest) continue;
    const clock = practiceClock(id, stats, inputs);
    if (!cur) {
      // Revision 2: proven when last practised (the passing runs are practice),
      // so a rung passed months ago is not treated as passed today.
      cur = { step: 0, provenAt: clock > 0 && clock <= now ? clock : now };
      put(id, cur);
    }
    if (!cur.retest) {
      const dueAt = dueAfterDays(Math.max(cur.provenAt, clock), rustIntervalDays(cur.step));
      if (now < dueAt) continue;
      cur = { ...cur, retest: { from: dueAt, baseline: counterEvidence(id, stats) } };
      put(id, cur);
    }
    if (!cur.retest) continue;
    const j = judgeRetest(id, cur.retest, stats, inputs);
    if (j.status === 'pending') continue;
    const last = { at: now, passed: j.status === 'pass', step: cur.step, n: j.n, right: j.right };
    if (j.status === 'pass') {
      put(id, { step: cur.needsWork ? 0 : cur.step + 1, provenAt: now, last });
    } else {
      // Missed: back to the first interval, and a fresh re-test opens at once.
      put(id, { step: 0, provenAt: cur.provenAt, needsWork: true, retest: { from: now, baseline: counterEvidence(id, stats) }, last });
    }
  }
  return rungs ? { version: 1, rungs } : store;
}

/** What the ladder shows for a rung with rust on it. */
export interface RustMark {
  state: 'rusty' | 'needsWork';
  why: string;
  /** The row's line: "Re-test due", or the re-test's progress once it needs work. */
  progress: string;
}

/** What each rung's re-test asks for, in words. */
export function retestNeed(rung: RustRung, activeCount: number): string {
  switch (rung) {
    case 'basic':
      return `${RETEST_BASIC_PER_PART} answers each of hard, soft and pairs at ${Math.round(RETEST_TARGET * 100)}%`;
    case 'count':
      return `${COUNT_RUNS_JUDGED} table-pace runs, ${COUNT_RUNS_NEEDED} right,`;
    case 'tc':
      return `${DRILL_WINDOW} deck estimations and ${DRILL_WINDOW} true counts, ${DRILL_WINDOW_NEEDED} right in each,`;
    case 'deviations':
      return `All ${activeCount} indices again at ${Math.round(RETEST_TARGET * 100)}%`;
    case 'betramp':
      return `${DRILL_WINDOW} bet sizing answers, ${DRILL_WINDOW_NEEDED} right,`;
    case 'play':
      return `A shoe of ${PLAY_MIN_GRADED}+ play decisions at ${Math.round(PLAY_TARGET * 100)}%`;
  }
}

const ago = (at: number, now: number) => agoText(daysBetween(localDateKey(at), localDateKey(now)));

/** The ladder's marks for the rungs with an open re-test. */
export function rustMarks(store: RustStore | undefined, stats: Stats, inputs: RustInputs, now: number): Partial<Record<RustRung, RustMark>> {
  const out: Partial<Record<RustRung, RustMark>> = {};
  if (!store) return out;
  for (const id of RUST_RUNGS) {
    const r = store.rungs[id];
    if (!r?.retest) continue;
    const j = judgeRetest(id, r.retest, stats, inputs);
    const need = retestNeed(id, inputs.activeIds.length);
    const sofar = j.n > 0 ? ` So far ${j.right} of ${j.n}.` : '';
    if (r.needsWork) {
      const missed = r.last ? `Missed its re-test: ${r.last.right} of ${r.last.n}.` : 'Missed its re-test.';
      out[id] = { state: 'needsWork', why: `${missed} ${need.replace(/,$/, '')} to pass it again.${sofar}`, progress: j.progress };
      continue;
    }
    const clock = practiceClock(id, stats, inputs);
    const passed = r.step === 0 ? 'Passed' : `Passed its ${rustIntervalDays(r.step - 1)}-day re-test`;
    const lead =
      clock > r.provenAt && localDateKey(clock) !== localDateKey(r.provenAt)
        ? `${passed} ${ago(r.provenAt, now)}, last practised ${ago(clock, now)}.`
        : `${passed} ${ago(r.provenAt, now)} and not practised since.`;
    out[id] = { state: 'rusty', why: `${lead} ${need} to keep it.${sofar}`, progress: 'Re-test due' };
  }
  return out;
}

function normalizeEvidence(raw: unknown): Evidence {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Partial<Evidence>;
  const out: Evidence = { n: num(e.n), right: num(e.right) };
  if (e.parts && typeof e.parts === 'object') {
    out.parts = {};
    for (const [k, v] of Object.entries(e.parts)) out.parts[k] = { n: num(v?.n), right: num(v?.right) };
  }
  return out;
}

/** Whatever is readable; anything malformed is dropped, never trusted. */
export function normalizeRust(raw: unknown): RustStore {
  if (!raw || typeof raw !== 'object') return EMPTY_RUST;
  const src = (raw as { rungs?: unknown }).rungs;
  if (!src || typeof src !== 'object') return EMPTY_RUST;
  const rungs: RustStore['rungs'] = {};
  for (const id of RUST_RUNGS) {
    const r = (src as Record<string, unknown>)[id] as Partial<RungRust> | undefined;
    if (!r || typeof r !== 'object' || !Number.isFinite(r.provenAt) || !Number.isFinite(r.step)) continue;
    const out: RungRust = { step: Math.max(0, Math.floor(r.step!)), provenAt: r.provenAt! };
    const t = r.retest;
    if (t && typeof t === 'object' && Number.isFinite(t.from)) {
      out.retest = { from: t.from!, baseline: normalizeEvidence(t.baseline) };
    }
    if (r.needsWork === true && out.retest) out.needsWork = true;
    const l = r.last;
    if (l && typeof l === 'object' && Number.isFinite(l.at) && typeof l.passed === 'boolean') {
      out.last = { at: l.at, passed: l.passed, step: num(l.step), n: num(l.n), right: num(l.right) };
    }
    rungs[id] = out;
  }
  return { version: 1, rungs };
}

export function loadRust(): RustStore {
  try {
    const raw = getStorage().getItem(RUST_KEY);
    return raw ? normalizeRust(JSON.parse(raw)) : EMPTY_RUST;
  } catch {
    return EMPTY_RUST;
  }
}

/** Writes only a change: Home calls it after every advance. */
export function saveRust(store: RustStore): void {
  try {
    const json = JSON.stringify(store);
    const s = getStorage();
    const had = s.getItem(RUST_KEY);
    // Nothing tracked and nothing stored: a new user's Home writes no key.
    if (had === null && Object.keys(store.rungs).length === 0) return;
    if (had !== json) s.setItem(RUST_KEY, json);
  } catch {
    /* full storage: the re-test is worked out again from the same stats next time */
  }
}
