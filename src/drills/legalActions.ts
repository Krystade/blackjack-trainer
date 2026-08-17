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

import type { Card } from '../engine/cards';
import type { Action } from '../engine/deviations';
import type { RuleSet } from '../engine/ruleset';
import { isPair } from '../engine/hand';

export function drillLegalActions(cards: Card[], rules: RuleSet): Action[] {
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
  // discouraged, it is unreachable in the graded answer set.
  if (rules.ls) actions.push('surrender');

  return actions;
}
