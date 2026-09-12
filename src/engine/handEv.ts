/**
 * What each action is worth, in units of the original bet.
 *
 * The second half of "how much did that mistake actually cost?" (V3-8,
 * docs/BACKLOG.md). `dealerOdds.ts` says how the dealer finishes; this says what
 * the player's choices are worth against that, so the difference between two
 * choices is a number instead of a verdict. Standing on 16 against a ten is a
 * mistake worth about a thousandth of a bet; hitting a hard 20 is worth about
 * half of one. Binary grading calls those the same thing, and a learner who
 * cannot tell them apart will spend real effort on the wrong one.
 *
 * SAME INFINITE-DECK ASSUMPTION as dealerOdds -- see that module's header for
 * why. One consequence is worth stating outright: the dealer's final total is
 * independent of what the player draws, which is what makes an exact recursion
 * possible at all rather than a simulation.
 *
 * THE SPLIT IS AN APPROXIMATION, and the only one here. Each half is played as a
 * fresh two-card hand with no resplitting, so the value of catching a third pair
 * card is missed. That understates splits slightly -- always in the same
 * direction, never by more than a few thousandths at the pairs anyone splits --
 * and the alternative is a recursion over hand counts that would take longer to
 * write than the entire rest of this file and move no advice. It is marked in the
 * returned value (`splitApproximate`) rather than hidden.
 *
 * Pure, and total: every export is a function of (cards, up, rules) alone.
 */

import { handValue } from './hand';
import { rankValue } from './cards';
import type { Card, Rank } from './cards';
import type { RuleSet } from './ruleset';
import { dealerOdds } from './dealerOdds';
import type { DealerOdds } from './dealerOdds';

/** Infinite-deck draw weights, as in dealerOdds. 11 is an ace. */
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

/**
 * EV of standing on `total`, in units.
 *
 * The dealer's naturals are assumed already gone (peek), which is the state
 * every player decision is actually made in -- a hand that lost to a natural
 * never reached a decision at all. `odds` must therefore come from
 * `dealerOdds(up, rules, { excludeBlackjack: true })`.
 */
export function standEv(total: number, odds: DealerOdds): number {
  if (total > 21) return -1;
  let ev = odds.bust;
  const dealerTotals: [number, number][] = [
    [17, odds.t17],
    [18, odds.t18],
    [19, odds.t19],
    [20, odds.t20],
    [21, odds.t21],
  ];
  for (const [dealerTotal, p] of dealerTotals) {
    if (total > dealerTotal) ev += p;
    else if (total < dealerTotal) ev -= p;
    // equal: a push, worth nothing either way
  }
  return ev;
}

/** Add a card to a running (total, soft) pair, demoting an ace if it busts. */
function afterDraw(total: number, soft: boolean, card: number): { total: number; soft: boolean } {
  let next = total + card;
  let nextSoft = soft || card === 11;
  if (next > 21 && nextSoft) {
    next -= 10;
    // Only one ace can be worth eleven; demoting it spends the softness, unless
    // the card just drawn was the ace and an earlier one is still up.
    nextSoft = soft && card === 11;
  }
  return { total: next, soft: nextSoft };
}

/**
 * EV of hitting, then playing on optimally -- hitting again whenever that is
 * worth more than standing. This is what makes the numbers comparable to
 * published EV tables: they assume correct play from here on, not that the
 * player stands immediately after.
 */
function hitEvFrom(
  total: number,
  soft: boolean,
  odds: DealerOdds,
  cache: Map<string, number>,
): number {
  if (total > 21) return -1;
  const key = `${total}:${soft ? 's' : 'h'}`;
  const seen = cache.get(key);
  if (seen !== undefined) return seen;

  let ev = 0;
  for (const card of DRAW) {
    const next = afterDraw(total, soft, card.value);
    if (next.total > 21) {
      ev += card.p * -1;
      continue;
    }
    // Optimal continuation: stand or hit again, whichever is better.
    const stand = standEv(next.total, odds);
    const hit = hitEvFrom(next.total, next.soft, odds, cache);
    ev += card.p * Math.max(stand, hit);
  }
  cache.set(key, ev);
  return ev;
}

/**
 * EV of doubling: exactly one card, then forced to stand, for twice the stake.
 * A bust costs two units, which is why doubling a stiff hand is expensive.
 */
function doubleEvFrom(total: number, soft: boolean, odds: DealerOdds): number {
  let ev = 0;
  for (const card of DRAW) {
    const next = afterDraw(total, soft, card.value);
    ev += card.p * 2 * (next.total > 21 ? -1 : standEv(next.total, odds));
  }
  return ev;
}

/**
 * EV of one half of a split pair: the pair card plus one fresh card, played out.
 *
 * Aces get one card only and cannot be hit further, which is the rule at every
 * table this app models. Doubling the new two-card hand is allowed only when DAS
 * is on -- and that is exactly why DAS changes so much of the pair chart.
 */
function splitHalfEv(pair: Rank, odds: DealerOdds, rules: RuleSet, cache: Map<string, number>): number {
  const base = pair === 'A' ? 11 : rankValue(pair);
  const baseSoft = pair === 'A';

  let ev = 0;
  for (const card of DRAW) {
    const next = afterDraw(base, baseSoft, card.value);
    if (pair === 'A') {
      // One card and done: no hitting, no doubling, however it landed.
      ev += card.p * (next.total > 21 ? -1 : standEv(next.total, odds));
      continue;
    }
    const options = [standEv(next.total, odds), hitEvFrom(next.total, next.soft, odds, cache)];
    if (rules.das) options.push(doubleEvFrom(next.total, next.soft, odds));
    ev += card.p * Math.max(...options);
  }
  return ev;
}

export interface ActionEvs {
  hit: number;
  stand: number;
  /** Absent when the hand may not be doubled (more than two cards, or no DAS). */
  double?: number;
  /** Absent unless the hand is a pair and splitting is available. */
  split?: number;
  /** Absent unless late surrender is offered on this hand. */
  surrender?: number;
  /** True when `split` came from the documented no-resplit approximation. */
  splitApproximate?: boolean;
}

export interface EvContext {
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
}

/**
 * Every legal action's EV for a specific hand against a specific up card.
 *
 * Deliberately takes the same `(cards, up, ctx, rules)` shape as
 * `correctPlay` in strategy.ts, so the two can be compared directly and a
 * disagreement between the chart and the arithmetic is a single line to check.
 */
export function actionEvs(
  cards: Card[],
  up: Rank,
  ctx: EvContext,
  rules: RuleSet,
): ActionEvs {
  const odds = dealerOdds(up, rules, { excludeBlackjack: true });
  const { total, soft } = handValue(cards);
  const cache = new Map<string, number>();

  const evs: ActionEvs = {
    stand: standEv(total, odds),
    hit: hitEvFrom(total, soft, odds, cache),
  };

  if (ctx.canDouble) evs.double = doubleEvFrom(total, soft, odds);

  if (ctx.canSplit && cards.length === 2 && cards[0] && cards[1]) {
    const a = cards[0].rank;
    const b = cards[1].rank;
    const sameValue = rankValue(a) === rankValue(b);
    if (sameValue) {
      // Ten-valued pairs of different ranks (K,Q) still split at a real table.
      const pairAs = a === 'A' ? 'A' : a;
      evs.split = 2 * splitHalfEv(pairAs, odds, rules, cache);
      evs.splitApproximate = true;
    }
  }

  if (ctx.canSurrender) evs.surrender = -0.5;

  return evs;
}

export type EvAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

/** The action with the highest EV, and what it is worth. */
export function bestEv(evs: ActionEvs): { action: EvAction; ev: number } {
  const candidates: [EvAction, number | undefined][] = [
    ['stand', evs.stand],
    ['hit', evs.hit],
    ['double', evs.double],
    ['split', evs.split],
    ['surrender', evs.surrender],
  ];
  let best: { action: EvAction; ev: number } = { action: 'stand', ev: evs.stand };
  for (const [action, ev] of candidates) {
    if (ev === undefined) continue;
    if (ev > best.ev) best = { action, ev };
  }
  return best;
}

/**
 * What choosing `taken` instead of the best available action costs, in units.
 *
 * Always >= 0, and zero for the best action. An action that is not legal here
 * returns `null` rather than a number, because "you cannot do that" is not a
 * quantity -- and a caller that silently turned it into a cost would be
 * reporting a fabricated loss.
 */
/**
 * What `taken` cost compared with `expected`, in units.
 *
 * Distinct from `evCostOf`, and the distinction is the whole reason this exists:
 * `evCostOf` measures against the highest-EV action, while a grader has to
 * measure against the action it actually MARKED CORRECT. Those differ on the two
 * or three borderline soft-double cells where the hand-entered chart and the
 * arithmetic disagree by a rounding error (see handEv.test.ts), and a learner
 * told "that cost you 0.0074" for playing the chart correctly would be right to
 * lose faith in the number.
 *
 * `null` when either action is unavailable here -- never a fabricated zero.
 */
export function evCostBetween(
  evs: ActionEvs,
  expected: EvAction,
  taken: EvAction,
): number | null {
  const pick = (a: EvAction): number | undefined =>
    a === 'stand' ? evs.stand : a === 'hit' ? evs.hit : evs[a];
  const want = pick(expected);
  const got = pick(taken);
  if (want === undefined || got === undefined) return null;
  return Math.max(0, want - got);
}

export function evCostOf(evs: ActionEvs, taken: EvAction): number | null {
  const takenEv = taken === 'stand' ? evs.stand : taken === 'hit' ? evs.hit : evs[taken];
  if (takenEv === undefined) return null;
  const best = bestEv(evs);
  // Clamp at zero: floating point can leave the best action a few 1e-17 short
  // of itself, and a cost of -0.00000000000000002 is not a thing to report.
  return Math.max(0, best.ev - takenEv);
}
