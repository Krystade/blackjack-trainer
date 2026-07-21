import { mulberry32 } from '../engine/cards';

export interface DeckEstimationQuestion {
  totalDecks: number; // shoe size, e.g. 6
  cardsDealt: number; // how many cards are in the discard tray
  decksRemaining: number; // exact, = (totalDecks*52 - cardsDealt)/52
}

const DEFAULT_TOTAL_DECKS = 6;

// Bounds on how much of the shoe can be dealt, expressed as a fraction of
// the full shoe. Keeps cardsDealt away from the degenerate extremes (~0
// cards dealt, or the entire shoe dealt) so the tray always shows a
// realistic mid-shoe depth to estimate.
const MIN_DEALT_FRACTION = 0.1;
const MAX_DEALT_FRACTION = 0.85;

/**
 * Generate a deck/discard-tray depth-estimation question: a shoe size plus
 * a (visually rendered, not numerically shown) count of cards dealt into
 * the discard tray. decksRemaining is the EXACT fractional value -- the
 * player's job is to eyeball the tray and estimate it to the nearest half
 * deck, which is why cardsDealt is not itself rounded to a half-deck
 * multiple. Uses the seeded mulberry32 idiom (see engine/cards.ts,
 * trueCountDrill.ts) so the same seed always reproduces the same question.
 *
 * @param seed - Optional seed for reproducibility
 * @param opts.totalDecks - Shoe size, default 6
 */
export function makeDeckEstimationQuestion(
  seed?: number,
  opts?: { totalDecks?: number },
): DeckEstimationQuestion {
  const rng = mulberry32(seed ?? Date.now());
  const totalDecks = opts?.totalDecks ?? DEFAULT_TOTAL_DECKS;
  const totalCards = totalDecks * 52;

  const minDealt = Math.round(totalCards * MIN_DEALT_FRACTION);
  const maxDealt = Math.round(totalCards * MAX_DEALT_FRACTION);
  const cardsDealt = minDealt + Math.floor(rng() * (maxDealt - minDealt + 1));

  const decksRemaining = (totalCards - cardsDealt) / 52;

  return { totalDecks, cardsDealt, decksRemaining };
}

/**
 * Grade a decks-remaining estimate against the exact actual value.
 *
 * errorDecks is the ABSOLUTE difference |guess - actual| (not signed) --
 * this drill only cares about how far off the estimate was, not which
 * direction, so callers get a plain magnitude to display.
 *
 * toleranceDecks defaults to 0.5: that is the granularity a real counter
 * actually needs (true-count conversion works in half-deck steps), so
 * landing within half a deck is the real competence bar, not exact-card
 * precision. The boundary is inclusive -- an error of exactly the
 * tolerance still counts as correct.
 */
export function gradeDeckEstimate(
  guess: number,
  actual: number,
  toleranceDecks = 0.5,
): { correct: boolean; errorDecks: number } {
  const errorDecks = Math.abs(guess - actual);
  const correct = errorDecks <= toleranceDecks;
  return { correct, errorDecks };
}
