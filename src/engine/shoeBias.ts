import type { Card } from './cards';
import { hiLoTag } from './count';

/**
 * B8 Hot shoe: how much more likely a low card (2-6) is to come out early, and
 * a high card (10-A) less. 1.06 roughly doubles the TC +2..+5 practice band
 * (15% -> 28% of points, 6 decks at 75%) while TC +6 or more stays near 6%.
 */
export const HOT_SHOE_WEIGHT = 1.06;

/**
 * A weighted random permutation (Efraimidis-Spirakis) of exactly the cards it
 * is given: each card's key is ln(u) / w with u in (0, 1], sorted descending.
 * Nothing is added, removed or duplicated, so the shoe stays a legal set and
 * Hi-Lo still balances to 0. A weight of 1 is an ordinary uniform shuffle.
 * The input array is left alone.
 */
export function hotShoeOrder(cards: readonly Card[], rng: () => number, weight = HOT_SHOE_WEIGHT): Card[] {
  const keyed = cards.map((card) => {
    const tag = hiLoTag(card.rank);
    const w = tag > 0 ? weight : tag < 0 ? 1 / weight : 1;
    return { card, key: Math.log(1 - rng()) / w };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((k) => k.card);
}

/** A rigged (scripted) shoe is never a hot shoe. */
export function hotShoeActive(cfg: { hotShoe?: boolean }, rigged: boolean): boolean {
  return cfg.hotShoe === true && !rigged;
}
