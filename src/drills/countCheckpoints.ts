import { mulberry32 } from '../engine/cards';

/**
 * MID-RUN COUNT CHECKPOINTS (RT#12 / RV9, docs/BACKLOG.md).
 *
 * The count drill graded one number at the end, so a +1 slip and a -1 slip in
 * the same run scored as a perfect count. That is not a scoring quibble: it is
 * the app reporting a clean run to someone who made two errors, and it is the
 * "missed cards you don't know you missed" failure mode the red-team filed
 * twice. A wrong run was barely better -- "off by 3" says nothing about WHERE
 * the count was lost, which is the only part a learner can act on.
 *
 * A checkpoint pauses the flash at a chosen group, asks for the running count
 * SO FAR, records it, and resumes. Nothing is said about the answer until the
 * run is over: telling you mid-run would hand you a corrected count for free
 * and destroy the rest of the measurement. What you get at the end is the
 * segment the drift entered in.
 */

export type CheckpointFreq = 'off' | 'one' | 'few';

/**
 * How many checkpoints each setting asks for. 'few' is two, not a per-card
 * rate: three interruptions in a 52-card run is a different drill, and the
 * point is to localize an error, not to turn the count into a quiz.
 */
const FREQ_COUNT: Record<Exclude<CheckpointFreq, 'off'>, number> = {
  one: 1,
  few: 2,
};

/**
 * The groups a run should stop at, ascending.
 *
 * Each checkpoint gets its own even slice of the run and lands on a seeded
 * pseudo-random group INSIDE that slice, so the stops are unpredictable from
 * run to run while still being spread out -- two checkpoints that both land in
 * the first third localize nothing. Deterministic in `seed`, so a replayed run
 * stops in the same places.
 *
 * Never the first group (there is nothing to have lost yet) and never the last
 * (that is the final answer, which is already graded). A run too short to hold
 * its checkpoints away from both ends yields fewer, or none -- the caller must
 * not assume it got what it asked for.
 */
export function checkpointIndices(
  totalGroups: number,
  freq: CheckpointFreq,
  seed: number,
): number[] {
  if (freq === 'off') return [];
  const wanted = FREQ_COUNT[freq];
  // Valid stops are [1, totalGroups - 2]: index 0 is too early to have drifted,
  // and the last group is the final count.
  const first = 1;
  const last = totalGroups - 2;
  if (last < first) return [];

  const span = last - first + 1;
  const rng = mulberry32(seed >>> 0);
  const picked: number[] = [];
  for (let i = 0; i < wanted; i++) {
    // Slice i of `wanted`, over the valid span.
    const sliceStart = first + Math.floor((span * i) / wanted);
    const sliceEnd = first + Math.floor((span * (i + 1)) / wanted) - 1;
    if (sliceEnd < sliceStart) continue;
    const at = sliceStart + Math.floor(rng() * (sliceEnd - sliceStart + 1));
    // Slices are disjoint by construction, but a degenerate span can still
    // collapse two of them onto the same group; a repeat is dropped rather
    // than nudged, because nudging would bunch checkpoints at a slice edge.
    if (picked.includes(at)) continue;
    picked.push(at);
  }
  return picked;
}

/** One answered checkpoint: what was asked for, and what came back. */
export interface CheckpointResult {
  /** Group index the run paused at. */
  atGroup: number;
  /** Cards shown through that group inclusive -- what the report speaks in. */
  cardsShown: number;
  /** The true running count through that group. */
  actual: number;
  /** What the user said it was. */
  answer: number;
}

export interface CheckpointReport {
  results: readonly CheckpointResult[];
  correct: number;
  total: number;
  /**
   * The run ended on the right number but did not stay on it. This is RT#12
   * itself: two errors that cancelled, which the old grading called perfect.
   */
  cancelled: boolean;
  /**
   * Cards shown at the START of the segment the first drift appeared in, and
   * at its end -- i.e. the stretch of the run to go back and look at. Null
   * when every checkpoint was right.
   */
  firstDriftSegment: { fromCard: number; toCard: number } | null;
}

/**
 * Read the checkpoints back against the final grade.
 *
 * `finalCorrect` is the ordinary end-of-run verdict, passed in rather than
 * recomputed: this module never sees the cards, and the two numbers must agree
 * about the same run.
 */
export function summarizeCheckpoints(
  results: readonly CheckpointResult[],
  finalCorrect: boolean,
): CheckpointReport {
  const correct = results.filter((r) => r.answer === r.actual).length;
  const firstWrong = results.find((r) => r.answer !== r.actual);
  const firstWrongIndex = firstWrong ? results.indexOf(firstWrong) : -1;
  // The drift entered somewhere between the last clean checkpoint and the
  // first wrong one. With no clean checkpoint before it, the segment opens at
  // the first card of the run.
  const priorClean = firstWrongIndex > 0 ? results[firstWrongIndex - 1] : undefined;
  return {
    results,
    correct,
    total: results.length,
    cancelled: finalCorrect && correct < results.length,
    firstDriftSegment: firstWrong
      ? { fromCard: (priorClean?.cardsShown ?? 0) + 1, toCard: firstWrong.cardsShown }
      : null,
  };
}
