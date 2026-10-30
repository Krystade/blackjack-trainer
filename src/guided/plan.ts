/**
 * Wave L (lane v): the guided session's PLAN -- which segments, in what order,
 * for how long. Pure: everything it reads is passed in.
 *
 * The shape is the community template's (docs/research/2026-07-23-community-
 * methods.md 3a: accuracy, then speed, then the true count), whose minute
 * numbers are flagged there as templated, so only the order is taken from it.
 * Every segment is an existing drill, run unchanged.
 *
 * THE ADAPTATION RULE (docs: guided-design.md, tested in plan.test.ts):
 *   - A segment is WEAK when the Home ladder rung it serves is not passed
 *     (nextStep.ladder, the same judgement Home shows). The warm-up is weak
 *     when any chart cell is due for review or judged weak.
 *   - Base weights: warm-up 2, speed 2, count 3, true count 3, deviations 3,
 *     bets 2 (they sum to the 15-minute preset). A weak segment weighs double.
 *   - 5 minutes: the warm-up plus the two highest-priority other segments --
 *     weak before passed, ties in ladder order. 15 and 30: all six.
 *   - Minutes: the preset apportioned over the included weights by largest
 *     remainder, every segment at least one minute. Answer targets are the
 *     minutes times the segment's pace, rounded to five (at least five).
 */

export type SegmentId = 'warmup' | 'speed' | 'count' | 'truecount' | 'deviations' | 'bets';

/** The ladder rungs a segment can serve (nextStep.ts RungId, restated to keep this pure). */
export type GuidedRung = 'basic' | 'repair' | 'count' | 'tc' | 'deviations' | 'betramp';

export type GuidedPreset = 5 | 15 | 30;
export const PRESETS: readonly GuidedPreset[] = [5, 15, 30];

export interface SegmentDef {
  id: SegmentId;
  /** On screen. */
  label: string;
  /** On screen where six share a row (the transition's rail). */
  short: string;
  /** Spoken, after "Next: " / "First: ". */
  spoken: string;
  /** Weight in the 15-minute plan. */
  base: number;
  /** Answers per minute, for an answer target; absent = a time target. */
  perMinute?: number;
  rungs: readonly GuidedRung[];
}

/** In session order. */
export const SEGMENTS: readonly SegmentDef[] = [
  { id: 'warmup', label: 'Warm-up', short: 'Warm-up', spoken: 'warm-up', base: 2, perMinute: 8, rungs: ['basic', 'repair'] },
  { id: 'speed', label: 'Speed', short: 'Speed', spoken: 'speed', base: 2, perMinute: 10, rungs: ['basic'] },
  { id: 'count', label: 'Running count', short: 'Count', spoken: 'running count', base: 3, rungs: ['count'] },
  { id: 'truecount', label: 'True count', short: 'True count', spoken: 'true count', base: 3, rungs: ['tc'] },
  { id: 'deviations', label: 'Deviations', short: 'Deviations', spoken: 'deviations', base: 3, perMinute: 6, rungs: ['deviations'] },
  { id: 'bets', label: 'Bet sizing', short: 'Bets', spoken: 'bet sizing', base: 2, perMinute: 8, rungs: ['betramp'] },
];

export function segmentDef(id: SegmentId): SegmentDef {
  return SEGMENTS.find((s) => s.id === id)!;
}

export type SegmentTarget = { kind: 'answers'; n: number } | { kind: 'time'; ms: number };

export interface PlannedSegment {
  id: SegmentId;
  minutes: number;
  target: SegmentTarget;
  weak: boolean;
  /** Warm-up: the cells to review (due first, then weak); empty = the chart. */
  cells?: string[];
  /** Deviations: the due indexes; empty = the whole quiz. */
  indexes?: string[];
}

export interface PlanInput {
  /** Rung id -> passed, from the Home ladder. A rung missing reads as not passed. */
  rungsPassed: Partial<Record<GuidedRung, boolean>>;
  dueCells: readonly string[];
  weakCells: readonly string[];
  dueIndexes: readonly string[];
}

/** At most this many cells in the warm-up's review deck. */
export const WARMUP_CELLS_MAX = 12;

export function isWeak(def: SegmentDef, input: PlanInput): boolean {
  if (def.id === 'warmup') return input.dueCells.length > 0 || input.weakCells.length > 0;
  return def.rungs.some((r) => input.rungsPassed[r] !== true);
}

/**
 * Largest-remainder apportionment of `total` over `weights`, each at least
 * `min`. Ties go to the earlier entry, so the result is deterministic.
 */
export function apportion(total: number, weights: readonly number[], min = 1): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const spare = total - min * n;
  if (spare <= 0) return weights.map(() => min);
  const sum = weights.reduce((a, b) => a + b, 0);
  const exact = weights.map((w) => (sum > 0 ? (w * spare) / sum : spare / n));
  const out = exact.map((x) => Math.floor(x));
  let left = spare - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out.map((x) => x + min);
}

/** The most answers one segment asks for (lines.ts speaks up to it). */
export const ANSWER_TARGET_MAX = 100;

/** Minutes times pace, to the nearest five, never under five nor over ANSWER_TARGET_MAX. */
export function answerTarget(minutes: number, perMinute: number): number {
  return Math.min(ANSWER_TARGET_MAX, Math.max(5, Math.round((minutes * perMinute) / 5) * 5));
}

/**
 * Segments a Drive session leaves out. Bet sizing is answered on the screen
 * or the wheel only (no microphone), and a commands-only microphone over it
 * would take the wheel from it (an open mic puts Bluetooth on the call route);
 * until it answers its yes/no propositions by voice (docs/BACKLOG.md) it has
 * no place in a session run by voice.
 */
export const DRIVE_EXCLUDED: readonly SegmentId[] = ['bets'];

/**
 * C7 (audit 2026-10-29): the warm-up deck. Due cells arrive most-needed first
 * (planInputFor orders them), and a third of the deck is kept for weak cells
 * that are not due, so neither crowds the other out; any room left is topped
 * up from whichever list has more.
 */
export function warmupCells(dueCells: readonly string[], weakCells: readonly string[]): string[] {
  const dueSet = new Set(dueCells);
  const weakOnly = weakCells.filter((id) => !dueSet.has(id));
  const weakTake = weakOnly.slice(0, Math.ceil(WARMUP_CELLS_MAX / 3));
  const dueTake = dueCells.slice(0, WARMUP_CELLS_MAX - weakTake.length);
  return [...new Set([...dueTake, ...weakTake, ...dueCells, ...weakOnly])].slice(0, WARMUP_CELLS_MAX);
}

export function planSession(preset: GuidedPreset, input: PlanInput, opts: { drive?: boolean } = {}): PlannedSegment[] {
  const flagged = SEGMENTS.filter((def) => !(opts.drive && DRIVE_EXCLUDED.includes(def.id))).map((def) => ({
    def,
    weak: isWeak(def, input),
  }));
  let included = flagged;
  if (preset === 5) {
    const others = flagged
      .slice(1)
      .map((f, i) => ({ ...f, i }))
      .sort((a, b) => Number(b.weak) - Number(a.weak) || a.i - b.i)
      .slice(0, 2)
      .map((f) => f.def.id);
    included = flagged.filter((f) => f.def.id === 'warmup' || others.includes(f.def.id));
  }
  const minutes = apportion(
    preset,
    included.map((f) => f.def.base * (f.weak ? 2 : 1)),
  );
  const cells = warmupCells(input.dueCells, input.weakCells);
  return included.map((f, i) => {
    const m = minutes[i]!;
    const target: SegmentTarget = f.def.perMinute
      ? { kind: 'answers', n: answerTarget(m, f.def.perMinute) }
      : { kind: 'time', ms: m * 60_000 };
    return {
      id: f.def.id,
      minutes: m,
      target,
      weak: f.weak,
      ...(f.def.id === 'warmup' ? { cells } : {}),
      ...(f.def.id === 'deviations' ? { indexes: [...input.dueIndexes] } : {}),
    };
  });
}
