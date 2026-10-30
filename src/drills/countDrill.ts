import type { Card } from '../engine/cards';
import { Shoe, mulberry32 } from '../engine/cards';
import { hiLoTag } from '../engine/count';

export interface CountDrillRound {
  groups: Card[][];
  finalRc: number;
}

/**
 * Count bias (R8, CM#1 -- CVBJ "Bias"). 'none' is the default (an unbiased
 * random slice). 'negative' leans the run's high (−1) cards toward the front,
 * so the count tends to run down early; 'positive' leans the low (+1) cards
 * forward, so it tends to run up early.
 *
 * Wave X (item 6): it used to SORT the run by tag -- "got 40+ negative cards
 * in a row then like 40 neutral, then like 30 positive. Don't have it hard set
 * the order." Now (see `biasRun`): the end count's sign is drawn first, so a
 * biased run ends up, down or level a third of the time each; whole slices are
 * drawn from the shoe until one ends on that sign, so how far up or down it
 * ends is what an unbiased run of that sign ends at; then a randomised share
 * of the front half's other cards trade places with biased cards from the
 * back half. A lean, never a block.
 */
export type CountDrillBias = 'none' | 'negative' | 'positive';

/**
 * Generate a count drill round with the specified number of cards, grouped by groupSize.
 * Uses a seeded Shoe to ensure deterministic generation.
 *
 * @param cards - Total number of cards to draw (from a shoe one deck larger than the run)
 * @param groupSize - Size of each group (1, 2, or 3)
 * @param seed - Optional seed for reproducibility
 * @param bias - Adversarial same-sign clustering (R8/CM#1); 'none' = unbiased
 * @returns CountDrillRound with grouped cards and final running count
 */
export function makeCountDrill(
  cards: number,
  groupSize: 1 | 2 | 3,
  seed?: number,
  bias: CountDrillBias = 'none',
): CountDrillRound {
  // #44: one deck MORE than the run needs. Drawn from exactly ceil(N/52)
  // decks, a whole-deck run used every card in the shoe and so always counted
  // to 0 -- an answer you could give without counting. From a larger shoe the
  // run is a random slice, and its end count is whatever that slice holds.
  const shoe = new Shoe({ decks: Math.ceil(cards / 52) + 1, seed });

  let allCards: Card[] = [];
  for (let i = 0; i < cards; i++) {
    allCards.push(shoe.draw());
  }

  if (bias !== 'none') {
    // Its own stream, so the unbiased run for a seed is unchanged.
    const rng = mulberry32((seed ?? Date.now()) ^ 0x2c1b3c6d);
    const decks = Math.ceil(cards / 52) + 1;
    allCards = biasRun(
      allCards,
      () => {
        const fresh = new Shoe({ decks, seed: Math.floor(rng() * 0x100000000) });
        return Array.from({ length: cards }, () => fresh.draw());
      },
      bias,
      rng,
    );
  }

  // Group the cards
  const groups: Card[][] = [];
  for (let i = 0; i < allCards.length; i += groupSize) {
    groups.push(allCards.slice(i, i + groupSize));
  }

  // Calculate final running count
  const finalRc = allCards.reduce((sum, card) => sum + hiLoTag(card.rank), 0);

  return { groups, finalRc };
}

/** Uniform Fisher-Yates, in place. */
function shuffleInPlace<T>(xs: T[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

const sumTags = (cards: readonly Card[]): number => cards.reduce((s, c) => s + hiLoTag(c.rank), 0);

/** Slices drawn before a level end gives up; a level end is the rarest, about one slice in 12 at 104 cards. */
export const BIAS_MAX_SLICES = 400;

/**
 * Wave X (item 6, fix round 1): a biased run, in two steps.
 *
 * 1. THE END COUNT'S SIGN IS DRAWN FIRST, a third each: up, down or level.
 *    Then whole slices -- `first`, then fresh ones from `slice()`, each the
 *    unbiased generator's run from a newly shuffled shoe -- until one ends on
 *    that sign. Rejection keeps the end count's size what an unbiased run of
 *    that sign has: a down-run ends at -1 no more often than unbiased
 *    down-runs do. (Swapping cards until the sign flipped stopped at the
 *    first count past the line, so two biased runs in three ended at 0 or +-1.)
 *    After BIAS_MAX_SLICES misses, the last slice is kept as it is.
 * 2. LEANED: each front-half card that is not of the biased tag trades places,
 *    with a probability drawn per run between 0.08 and 0.25, with a biased
 *    card from the back half. A swap moves cards, never changes them, so the
 *    end count is untouched; the count just tends to get there early.
 *
 * Exported for its tests; `makeCountDrill` is the way in.
 */
export function biasRun(
  first: readonly Card[],
  slice: () => Card[],
  bias: Exclude<CountDrillBias, 'none'>,
  rng: () => number,
): Card[] {
  const target = Math.floor(rng() * 3) - 1;
  let out = first.slice();
  for (let tries = 1; Math.sign(sumTags(out)) !== target && tries < BIAS_MAX_SLICES; tries++) out = slice();

  // 2. Lean the biased tag toward the front half.
  const tag = bias === 'negative' ? -1 : 1;
  const half = Math.floor(out.length / 2);
  const share = 0.08 + rng() * 0.17;
  const back: number[] = [];
  for (let i = half; i < out.length; i++) if (hiLoTag(out[i]!.rank) === tag) back.push(i);
  shuffleInPlace(back, rng);
  for (let i = 0; i < half && back.length > 0; i++) {
    if (hiLoTag(out[i]!.rank) === tag || rng() >= share) continue;
    const j = back.pop()!;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * D1 part 2 (docs/BACKLOG.md, distraction training): sum of hiLoTag over
 * every card in groups[0..uptoIndex] inclusive -- the running count "as of
 * now" mid-flash. Used by CountDrillView to privately seed a distraction
 * interruption's makeDistraction() call; the caller MUST NEVER display or
 * speak this value, only feed it in as the seed for the distraction's
 * arithmetic (see distraction.ts). Pure and independent of CountDrillRound
 * (takes a plain groups array) so it works against a run already in
 * progress rather than needing the whole round object.
 *
 * `uptoIndex` is clamped safely on both ends: negative (nothing shown yet)
 * sums to 0, and an index beyond the array simply sums whatever exists --
 * never throws.
 */
export function runningCountThrough(groups: Card[][], uptoIndex: number): number {
  let rc = 0;
  for (let i = 0; i <= uptoIndex && i < groups.length; i++) {
    for (const c of groups[i]!) rc += hiLoTag(c.rank);
  }
  return rc;
}

export interface CountdownRound {
  shown: Card[];
  hidden: Card;
}

/**
 * Generate a countdown round: a full 52-card deck with the last card hidden.
 * The sum of shown card tags equals the negative tag of the hidden card.
 *
 * @param seed - Optional seed for reproducibility
 * @returns CountdownRound with shown cards and hidden card
 */
export function makeCountdown(seed?: number): CountdownRound {
  const shoe = new Shoe({ decks: 1, seed });

  const allCards: Card[] = [];
  for (let i = 0; i < 52; i++) {
    allCards.push(shoe.draw());
  }

  const hidden = allCards.pop()!;
  const shown = allCards;

  return { shown, hidden };
}
