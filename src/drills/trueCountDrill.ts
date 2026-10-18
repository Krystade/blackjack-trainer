import { mulberry32 } from '../engine/cards';
import { trueCount } from '../engine/count';
import type { TcRounding } from '../engine/count';
import type { CutSpec } from '../engine/cut';
import { trayFloorDecks } from './betSizing';

export interface TrueCountQuestion {
  runningCount: number; // -15 .. +15
  decksRemaining: number; // half-deck granularity, >= 0.5
  correctTc: number; // computed by the engine's trueCount() -- never reimplemented here
}

/** The part of a TC-drill history row the depth weighting reads. */
export interface TcDepthRow {
  decksRemaining: number;
  correct: boolean;
}

// #54: symmetric. -6..+20 left negative counts -- where floor and truncate
// disagree -- under-trained.
const RC_MIN = -15;
const RC_MAX = 15;
const DEFAULT_MAX_DECKS = 6;
const DEFAULT_MIN_DECKS = 0.5;

/**
 * Wave E E3 (W2-12): how far back the miss weighting looks, in history rows.
 * A window rather than all time, so a depth that has since been learned stops
 * being pushed.
 */
export const TC_MISS_WINDOW = 50;
/** Extra draw weight per miss at a depth, on top of each depth's own 1. */
const MISS_WEIGHT = 2;
/**
 * Misses counted per depth, at most. One bad depth weighs at most 1 + 2 * 3 = 7
 * against 1 for each of the others -- under half the questions on a 6-deck
 * shoe -- so the drill still visits every depth it can reach.
 */
const MISS_CAP = 3;

/**
 * Generate a true-count conversion question: a running count plus a decks-
 * remaining figure, paired with the correct true count. Uses the seeded
 * mulberry32 idiom (see engine/cards.ts, countDrill.ts) so the same seed
 * always reproduces the same question.
 *
 * correctTc is ALWAYS computed by calling the engine's trueCount() -- this
 * function never reimplements the rounding/flooring rule, so the drill can
 * never drift from the actual game's grading.
 *
 * Wave E E3 (W2-12): depth is drawn in half decks from `minDecks` (the
 * profile's tray floor, see `trueCountDrillDepths`) up to `maxDecks`, and
 * weighted toward the depths missed in the last TC_MISS_WINDOW `history` rows.
 * With no misses in range and the floor at 0.5, the draw is the old one, rng
 * for rng, so a seed asks the same question it always did.
 *
 * @param seed - Optional seed for reproducibility
 * @param opts.maxDecks - Upper bound (inclusive) for decksRemaining, default 6
 * @param opts.minDecks - Lower bound (inclusive), default 0.5
 * @param opts.history - The drill's own history rows, oldest first
 */
export function makeTrueCountQuestion(
  seed?: number,
  opts?: {
    maxDecks?: number;
    minDecks?: number;
    rounding?: TcRounding;
    history?: readonly TcDepthRow[];
  },
): TrueCountQuestion {
  const rng = mulberry32(seed ?? Date.now());
  const maxDecks = opts?.maxDecks ?? DEFAULT_MAX_DECKS;
  const minDecks = Math.min(maxDecks, Math.max(DEFAULT_MIN_DECKS, opts?.minDecks ?? DEFAULT_MIN_DECKS));

  // Running count: integer uniform in [RC_MIN, RC_MAX]
  const runningCount = RC_MIN + Math.floor(rng() * (RC_MAX - RC_MIN + 1));

  // Decks remaining: half-deck steps from minDecks up to maxDecks inclusive.
  const steps = Math.round((maxDecks - minDecks) * 2) + 1;
  const weights = missWeights(opts?.history ?? [], minDecks, steps);
  const stepIndex = weights ? weightedIndex(rng(), weights) : Math.floor(rng() * steps);
  const decksRemaining = minDecks + stepIndex * 0.5;

  // V5-4 / #54: the answer follows the PLAYER'S convention, and so does the
  // grade (drills/tcFeedback.ts gradeTcConversion).
  const correctTc = trueCount(runningCount, decksRemaining, opts?.rounding);

  return { runningCount, decksRemaining, correctTc };
}

/**
 * One weight per half-deck step from `minDecks`, or null when no recent miss
 * falls in range (the caller then takes the plain uniform draw, unchanged).
 */
function missWeights(history: readonly TcDepthRow[], minDecks: number, steps: number): number[] | null {
  const misses = new Array<number>(steps).fill(0);
  let any = false;
  for (const row of history.slice(-TC_MISS_WINDOW)) {
    if (row.correct) continue;
    const step = (row.decksRemaining - minDecks) * 2;
    if (!Number.isInteger(step) || step < 0 || step >= steps) continue;
    misses[step] = Math.min(MISS_CAP, misses[step]! + 1);
    any = true;
  }
  return any ? misses.map((m) => 1 + MISS_WEIGHT * m) : null;
}

/** The step a uniform `u` in [0, 1) lands on, by weight. */
function weightedIndex(u: number, weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = u * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]!;
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Wave E E3: the depth range the True count drill draws from for a profile.
 *
 * The floor is the profile's tray floor (betSizing.trayFloorDecks): Play
 * reshuffles at the cut, so a TC question deeper than that is a division Jack
 * never meets at his table. `maxDecks` is the setup screen's Max decks
 * stepper, which opens on the profile's shoe (V4-3) and stays a deliberate
 * override. Set at or below the floor it asks for shallower trays than the
 * shoe can reach, and that request is honoured: the floor drops to half a deck.
 */
export function trueCountDrillDepths(profile: CutSpec, maxDecks: number): { minDecks: number; maxDecks: number } {
  const floor = trayFloorDecks(profile);
  return { minDecks: floor < maxDecks ? floor : DEFAULT_MIN_DECKS, maxDecks };
}
