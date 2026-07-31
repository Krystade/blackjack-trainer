/**
 * Weighted random index selection shared by the flashcards and deviation-quiz
 * draws. Originally paired with an R3 miss-count weight formula; RV4 replaced
 * that scheduling with the spaced-repetition scheduler in spacedRepetition.ts
 * (`srWeight`), but this selection primitive stayed — the draws still build a
 * parallel weights array (now from SR due-ness) and pick one index from it.
 */

/**
 * Weighted random index selection, given a seeded rng() in [0, 1) and a
 * parallel array of positive weights. Consumes exactly one rng() draw, so an
 * all-equal weights array reproduces the exact same index as a plain
 * `Math.floor(rng() * n)` uniform pick (see weightedDraw.test.ts).
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
