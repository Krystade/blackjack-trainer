import type { Card } from '../engine/cards';
import { Shoe } from '../engine/cards';
import { hiLoTag } from '../engine/count';

export interface CountDrillRound {
  groups: Card[][];
  finalRc: number;
}

/**
 * Adversarial shoe-composition bias (R8, CM#1 — CVBJ "Bias", VERIFIED direct
 * PDF read). Clusters same-sign Hi-Lo cards toward the front so the counter
 * runs deep into ONE sign and then back across zero as the opposite-sign cards
 * arrive — the count-through-zero / sign-reversal reps a flat-random shoe
 * under-samples (and exactly the negative-count arithmetic the red-team flagged
 * as systematically undertrained). 'none' is the default (unbiased random).
 * 'negative' front-loads the negative-tag (high) cards → the count dives
 * negative, then climbs back; 'positive' front-loads the positive-tag (low)
 * cards → the count spikes positive, then falls back.
 */
export type CountDrillBias = 'none' | 'negative' | 'positive';

/**
 * Generate a count drill round with the specified number of cards, grouped by groupSize.
 * Uses a seeded Shoe to ensure deterministic generation.
 *
 * @param cards - Total number of cards to generate (up to 312 for 6-deck shoe)
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
  const shoe = new Shoe({ decks: Math.ceil(cards / 52), seed });

  const allCards: Card[] = [];
  for (let i = 0; i < cards; i++) {
    allCards.push(shoe.draw());
  }

  if (bias !== 'none') {
    // Stable sort by Hi-Lo tag so same-sign cards cluster in the first half.
    // V8's Array.sort is stable, so cards WITHIN a tag group keep their seeded
    // shuffle order — the counting stays non-trivial; only the sign path is
    // biased. 'negative' => ascending tag (−1s first); 'positive' => descending
    // (+1s first). The final count is unchanged (a sum is order-independent):
    // same destination, harder journey, which is the whole point.
    const dir = bias === 'negative' ? 1 : -1;
    allCards.sort((a, b) => (hiLoTag(a.rank) - hiLoTag(b.rank)) * dir);
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
