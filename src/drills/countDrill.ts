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
 * biased run ends up, down or level a third of the time each; the cards are
 * shuffled uniformly; then a randomised share of the front half's other cards
 * trade places with biased cards from the back half. A lean, never a block.
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
    allCards = biasRun(allCards, shoe, bias, mulberry32((seed ?? Date.now()) ^ 0x2c1b3c6d));
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

/** The sign a count ends on: -1, 0 or +1. */
function signOf(n: number): -1 | 0 | 1 {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Uniform Fisher-Yates, in place. */
function shuffleInPlace<T>(xs: T[], rng: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

/**
 * Wave X (item 6): a biased run, in three steps.
 *
 * 1. THE END COUNT'S SIGN IS DRAWN FIRST, a third each: up, down or level. A
 *    slice is then swapped card for card with later cards of the same shoe --
 *    the fewest swaps that reach that sign, each a random card of the tag
 *    that has to go for the next shoe card of a tag that moves the count the
 *    right way -- so the run is still cards a real shoe holds.
 * 2. SHUFFLED UNIFORMLY.
 * 3. LEANED: each front-half card that is not of the biased tag trades places,
 *    with a probability drawn per run between 0.2 and 0.5, with a biased card
 *    from the back half. A moderate, random shift toward the front, which a
 *    run of same-sign cards no longer gives away.
 *
 * Exported for its tests; `makeCountDrill` is the way in.
 */
export function biasRun(
  cards: readonly Card[],
  shoe: Shoe,
  bias: Exclude<CountDrillBias, 'none'>,
  rng: () => number,
): Card[] {
  const out = cards.slice();
  const target = (Math.floor(rng() * 3) - 1) as -1 | 0 | 1;
  let rc = out.reduce((s, c) => s + hiLoTag(c.rank), 0);

  // 1. Reach the drawn sign. Bounded: a shoe one deck larger than the run
  //    holds far more of every tag than any run can need.
  for (let guard = 0; signOf(rc) !== target && guard < 200; guard++) {
    const up = target > signOf(rc);
    // Raise the count: lose a -1 (or a 0) for a +1 (or a 0). Lower: the mirror.
    // Toward 0 from +-1, one step only, so it lands on 0 rather than past it.
    const oneStep = target === 0 && Math.abs(rc) === 1;
    const outTags = up ? [-1, 0] : [1, 0];
    const candidates = out
      .map((c, i) => ({ i, t: hiLoTag(c.rank) }))
      .filter(({ t }) => outTags.includes(t));
    if (candidates.length === 0 || shoe.cardsRemaining === 0) break;
    const pick = candidates[Math.floor(rng() * candidates.length)]!;
    // What the incoming card must be: strictly higher (up) / lower (down)
    // than the one leaving, and only one step when one step is all it takes.
    const wanted = (t: number): boolean => {
      const delta = t - pick.t;
      if (up ? delta <= 0 : delta >= 0) return false;
      return !oneStep || Math.abs(delta) === 1;
    };
    let incoming: Card | null = null;
    while (shoe.cardsRemaining > 0) {
      const c = shoe.draw();
      if (wanted(hiLoTag(c.rank))) {
        incoming = c;
        break;
      }
    }
    if (!incoming) break;
    rc += hiLoTag(incoming.rank) - pick.t;
    out[pick.i] = incoming;
  }

  // 2. Shuffle.
  shuffleInPlace(out, rng);

  // 3. Lean the biased tag toward the front half.
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
