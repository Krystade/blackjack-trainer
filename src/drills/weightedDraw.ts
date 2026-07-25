/**
 * R3 (docs/BACKLOG.md, spaced-repetition / miss-weighted scheduling):
 * shared Leitner-lite weighting primitives used by BOTH the flashcards drill
 * (per-cell, keyed by cellId) and the deviation quiz (per-index, keyed by
 * DeviationId), so the two drills weight identically instead of drifting.
 *
 * `drawFlashcard` (flashcards.ts) originally inlined this exact formula and
 * selection loop; it's extracted here unchanged (see weightedIndex's
 * "all-equal weights matches Math.floor(rng()*n)" test in weightedDraw.test.ts)
 * so both drills can share it and existing behavior is preserved byte-for-byte.
 */

/**
 * Leitner-lite weight formula: baseline 1, +2 per outstanding miss.
 * `missCount` is clamped to >= 0 defensively (callers -- bumpMiss/decayMiss
 * below -- already keep it non-negative, but this keeps the formula itself
 * safe against any other caller passing a raw stored value).
 */
export function missWeight(missCount: number): number {
  return 1 + 2 * Math.max(0, missCount);
}

/**
 * Weighted random index selection, given a seeded rng() in [0, 1) and a
 * parallel array of positive weights. Consumes exactly one rng() draw --
 * same contract as the original inline loop in drawFlashcard and the
 * original `Math.floor(rng() * n)` entry pick in drawQuizItem, so passing an
 * all-equal weights array reproduces the exact same index as before either
 * of those existed (see weightedDraw.test.ts).
 */
export function weightedIndex(rng: () => number, weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = rng() * totalWeight;
  let selectedIndex = 0;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      selectedIndex = i;
      break;
    }
  }

  return selectedIndex;
}

/** On a miss: grow the weight map's entry for `key` by 1 (unbounded growth,
 * unchanged from the pre-R3 behavior) -- always paired with decayMiss below
 * so a subsequently-mastered item can fade back down. */
export function bumpMiss(weights: Record<string, number>, key: string): Record<string, number> {
  return { ...weights, [key]: (weights[key] ?? 0) + 1 };
}

/** On a correct answer: shrink the weight map's entry for `key` by 1, floored
 * at 0 -- the R3 decay half of the Leitner-lite scheduler. An absent key is
 * treated as already at baseline (0) and stays there. */
export function decayMiss(weights: Record<string, number>, key: string): Record<string, number> {
  const current = weights[key] ?? 0;
  return { ...weights, [key]: Math.max(0, current - 1) };
}
