import { mulberry32 } from '../engine/cards';
import { trueCount } from '../engine/count';

export interface TrueCountQuestion {
  runningCount: number; // -6 .. +20
  decksRemaining: number; // half-deck granularity, >= 0.5
  correctTc: number; // computed by the engine's trueCount() -- never reimplemented here
}

const RC_MIN = -6;
const RC_MAX = 20;
const DEFAULT_MAX_DECKS = 6;

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
 * @param seed - Optional seed for reproducibility
 * @param opts.maxDecks - Upper bound (inclusive) for decksRemaining, default 6
 */
export function makeTrueCountQuestion(seed?: number, opts?: { maxDecks?: number }): TrueCountQuestion {
  const rng = mulberry32(seed ?? Date.now());
  const maxDecks = opts?.maxDecks ?? DEFAULT_MAX_DECKS;

  // Running count: integer uniform in [RC_MIN, RC_MAX]
  const runningCount = RC_MIN + Math.floor(rng() * (RC_MAX - RC_MIN + 1));

  // Decks remaining: half-deck steps from 0.5 up to maxDecks inclusive.
  const halfDeckSteps = Math.round(maxDecks * 2);
  const stepIndex = Math.floor(rng() * halfDeckSteps);
  const decksRemaining = (stepIndex + 1) * 0.5;

  const correctTc = trueCount(runningCount, decksRemaining);

  return { runningCount, decksRemaining, correctTc };
}
