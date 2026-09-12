/**
 * What the dealer finishes with, given an up card.
 *
 * The first half of answering "how much did that mistake actually cost?" --
 * which is the question the app has never been able to answer. Grading is
 * binary today: standing on 12 v 3 scores exactly like hitting a hard 20, so
 * Stats can say what was missed but not what it was worth, and a learner
 * chasing a long tail of trivial errors looks identical to one making expensive
 * ones. (Red-team v3, V3-8 in docs/BACKLOG.md.)
 *
 * INFINITE DECK, and deliberately. Every card is drawn with replacement: 1/13
 * for each of A through 9, 4/13 for the ten-valued ranks. That is the same
 * assumption the published basic-strategy tables are derived under, so the
 * numbers here are comparable to the literature, and it makes the recursion
 * exact and instant rather than a shoe-composition search. The cost of a
 * mistake shifts by a fraction of a percent under real removal, which is far
 * below the resolution anyone is taught at.
 *
 * PEEK MATTERS, and it is the part that is easy to get wrong. Against a ten or
 * an ace the dealer has already looked, so by the time the player acts the
 * blackjack hands are GONE from the distribution -- conditioning on that raises
 * every remaining outcome. Forgetting it makes a ten-up dealer look far more
 * bustable than they are.
 *
 * Pure. No React, no store, no randomness -- `dealerOdds` is a total function
 * of (up card, rules), which is what lets it be checked against a Monte Carlo
 * simulation rather than against remembered constants.
 */

import type { Rank } from './cards';
import type { RuleSet } from './ruleset';

/** Probability of each way the dealer's hand can end. Always sums to 1. */
export interface DealerOdds {
  /** Final totals 17 through 21. */
  t17: number;
  t18: number;
  t19: number;
  t20: number;
  t21: number;
  bust: number;
  /**
   * A two-card 21. Counted inside `t21` as well -- this is a note about how
   * that 21 arrived, not a seventh outcome, because a natural pays 3:2 and a
   * drawn 21 does not. Zero whenever peek has already removed it.
   */
  blackjack: number;
}

const RANK_VALUE: Record<Rank, number> = {
  A: 11,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 10,
  Q: 10,
  K: 10,
};

/** Infinite-deck draw weights: four of the thirteen ranks are worth ten. */
const DRAW: { value: number; p: number }[] = [
  { value: 11, p: 1 / 13 },
  { value: 2, p: 1 / 13 },
  { value: 3, p: 1 / 13 },
  { value: 4, p: 1 / 13 },
  { value: 5, p: 1 / 13 },
  { value: 6, p: 1 / 13 },
  { value: 7, p: 1 / 13 },
  { value: 8, p: 1 / 13 },
  { value: 9, p: 1 / 13 },
  { value: 10, p: 4 / 13 },
];

/** The six terminal buckets, as a plain array so the recursion can add them. */
type Buckets = [number, number, number, number, number, number]; // 17,18,19,20,21,bust

const ZERO: Buckets = [0, 0, 0, 0, 0, 0];

function add(into: Buckets, from: Buckets, weight: number): void {
  for (let i = 0; i < 6; i++) into[i]! += from[i]! * weight;
}

/**
 * Where a hand of `total` (with `soft` true when an ace is still counted as 11)
 * ends up, playing the dealer's fixed rules.
 *
 * Memoised per ruleset-shape: the state space is tiny (totals 4..21 x soft) and
 * every EV question below asks for it thousands of times.
 */
function finalTotals(total: number, soft: boolean, h17: boolean, cache: Map<string, Buckets>): Buckets {
  if (total > 21) return [0, 0, 0, 0, 0, 1];
  const standing = total >= 17 && !(h17 && soft && total === 17);
  if (standing) {
    const out: Buckets = [...ZERO] as Buckets;
    out[total - 17] = 1;
    return out;
  }

  const key = `${total}:${soft ? 's' : 'h'}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const out: Buckets = [...ZERO] as Buckets;
  for (const card of DRAW) {
    let next = total + card.value;
    let nextSoft = soft || card.value === 11;
    if (next > 21 && nextSoft) {
      next -= 10;
      // Only one ace can be counted as eleven, so demoting the one that is
      // spends the softness -- unless the card just drawn was itself an ace and
      // the hand was already soft, in which case the original ace still holds.
      nextSoft = soft && card.value === 11;
    }
    add(out, finalTotals(next, nextSoft, h17, cache), card.p);
  }
  cache.set(key, out);
  return out;
}

function bucketsToOdds(b: Buckets, blackjack: number): DealerOdds {
  return { t17: b[0], t18: b[1], t19: b[2], t20: b[3], t21: b[4], bust: b[5], blackjack };
}

export interface DealerOddsOptions {
  /**
   * True once the dealer has peeked and does NOT have a natural -- the state
   * the player is in for every decision at a peeking table. Those hands are
   * removed and the rest renormalised.
   */
  excludeBlackjack?: boolean;
}

/**
 * The dealer's outcome distribution for an up card.
 *
 * `up` is a rank rather than a value so the ace is unambiguous: an ace up and a
 * ten up are the two cases where the hole card can complete a natural, and they
 * are the two that peek changes.
 */
export function dealerOdds(up: Rank, rules: RuleSet, opts: DealerOddsOptions = {}): DealerOdds {
  const upValue = RANK_VALUE[up];
  const cache = new Map<string, Buckets>();
  const out: Buckets = [...ZERO] as Buckets;

  let blackjack = 0;
  let live = 0;

  for (const hole of DRAW) {
    // A natural is exactly an ace beside a ten-value card.
    const isNatural = (upValue === 11 && hole.value === 10) || (upValue === 10 && hole.value === 11);
    if (isNatural) {
      blackjack += hole.p;
      if (opts.excludeBlackjack) continue;
      // Counted as a 21 that happens to pay more; the caller reads `blackjack`
      // to price it differently.
      out[4] += hole.p;
      live += hole.p;
      continue;
    }

    let total = upValue + hole.value;
    let soft = upValue === 11 || hole.value === 11;
    if (total > 21) {
      // Two aces: one of them becomes a one.
      total -= 10;
      soft = true;
    }
    add(out, finalTotals(total, soft, rules.s17 === false, cache), hole.p);
    live += hole.p;
  }

  if (opts.excludeBlackjack) {
    // Renormalise over the hands that survive the peek.
    for (let i = 0; i < 6; i++) out[i]! /= live;
    blackjack = 0;
  }

  return bucketsToOdds(out, blackjack);
}

/** P(the dealer busts), the single number most often quoted from the above. */
export function dealerBustChance(up: Rank, rules: RuleSet, opts: DealerOddsOptions = {}): number {
  return dealerOdds(up, rules, opts).bust;
}
