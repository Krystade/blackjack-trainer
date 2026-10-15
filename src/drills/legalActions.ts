/**
 * Which actions are actually available for a DRILL hand (operator item #3).
 *
 * The table already computes this: `Game.legalActionsForHand` gates the
 * ActionBar so Split is dark unless the hand is a pair. The drills did not --
 * `Drills.tsx` passed `legal: ALL_ACTIONS`, so every button was live on every
 * card, including Split on a 10,6. That is a false affordance: it offers a
 * play that cannot exist, and it costs the learner the single strongest
 * recognition cue the real table gives them for free ("this is a pair hand").
 *
 * This module is the drill-side counterpart. It is deliberately NOT the
 * engine's function: a drill hand has no game state (no split depth, no
 * post-split restrictions, no bankroll), it is always exactly the two dealt
 * cards, so the rules collapse to something small enough to state plainly.
 *
 * INVARIANT, and the reason this is tested rather than inlined: an action may
 * only be withheld when it could never be the graded-correct answer. Greying
 * out a button that `correctPlay()` might return would make the right play
 * physically unreachable and grade the learner wrong for the UI's mistake.
 */

import type { Card, Rank } from '../engine/cards';
import type { Action } from '../engine/deviations';
import type { RuleSet } from '../engine/ruleset';
import { handValue, isPair } from '../engine/hand';
import { chartLookup } from '../engine/basicStrategy';

/**
 * #11: may a DRILL offer surrender on this hand?
 *
 * Hard hands: whenever the table offers late surrender, as before.
 *
 * Soft hands and pairs: only where the active chart actually surrenders.
 * No chart surrenders a soft hand, and the pair cells that do are a handful
 * (7,7 v 10 single deck, 8,8 v A six-deck H17, ...), so on every other pair
 * and soft hand the button was a play that could never be right. Derived from
 * the chart, not listed: `chartLookup` routes a pair to its PAIRS row first,
 * and `getChart` has already resolved Rp by DAS and stripped every R cell
 * when surrender is off. No deviation index surrenders a pair or a soft hand
 * (the Fab 4 are hard 14-16); legalActions.test.ts checks that across every
 * ruleset and count rather than trusting this comment.
 *
 * Drills only. At the table surrender stays a legal choice on A,2, and taking
 * it is a graded mistake rather than a dark button.
 */
function drillOffersSurrender(cards: Card[], up: Rank, rules: RuleSet): boolean {
  if (!rules.ls) return false;
  const pair = isPair(cards);
  if (!pair && !handValue(cards).soft) return true;
  const cell = chartLookup(cards, up, rules);
  return cell === 'Rh' || cell === 'Rs' || cell === 'Rp';
}

export function drillLegalActions(cards: Card[], rules: RuleSet, up: Rank): Action[] {
  // Hit and stand are unconditional -- there is no two-card hand that forbids
  // either (a dealt blackjack is settled before the player ever acts, so it
  // never reaches a drill prompt).
  const actions: Action[] = ['hit', 'stand'];

  // Every drill hand is a fresh two-card hand, which is precisely the
  // condition for doubling. This ruleset has no "double on 9-11 only"
  // variant, so double is always live -- listed explicitly rather than
  // folded into the initial array so the reasoning survives a rules change.
  actions.push('double');

  // The operator's motivating case. `isPair` normalizes ten-value ranks, so
  // K,Q splits exactly as the PAIRS chart row expects.
  if (isPair(cards)) actions.push('split');

  // `getChart()` runs `stripLs`, resolving every Rh/Rs cell to its fallback
  // when late surrender is off -- so with ls:false, surrender is not merely
  // discouraged, it is unreachable in the graded answer set. With it on, soft
  // hands and most pairs still never surrender (#11, see above).
  if (drillOffersSurrender(cards, up, rules)) actions.push('surrender');

  return actions;
}

/**
 * #26: the rules chip shown on every drill and quiz prompt, BEFORE the
 * answer, so "is surrender even on the table here?" is never a guess.
 *
 * It states the CONTEXT the prompt is graded under, plus one fact about the
 * hand: on a hand where the drills do not offer surrender at all (#11 greys
 * the button -- soft hands, and pairs outside the chart's few surrender
 * cells) it says "No surrender", so the chip never reads "Surrender OK" beside
 * a dark Surrender button. That leaks nothing the button does not already
 * show. Where surrender IS offered, the chip keeps the grading context, so on
 * a hard hand it does not hint whether surrender is the answer.
 *
 * - `canSurrender`: the grader's ctx says surrender is available AND the
 *   rules offer it (with `ls` off the chart has no R cells at all).
 * - `canDouble`: false only for a hand that cannot double ("No double").
 * - `hand`: the prompt's two cards and the dealer's card. Omitted only where
 *   there is no hand to judge.
 */
export function rulesChipLabels(
  ctx: { canSurrender: boolean; canDouble: boolean },
  rules: RuleSet,
  hand?: { cards: Card[]; up: Rank },
): string[] {
  const offered = hand ? drillOffersSurrender(hand.cards, hand.up, rules) : rules.ls;
  const labels = [ctx.canSurrender && rules.ls && offered ? 'Surrender OK' : 'No surrender'];
  if (!ctx.canDouble) labels.push('No double');
  return labels;
}
