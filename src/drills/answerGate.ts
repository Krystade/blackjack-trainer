/**
 * One decision point for "may this drill answer be submitted at all?", shared
 * by every input path (A1).
 *
 * Item #3 disabled the unavailable ActionBar buttons and gated the keyboard,
 * but `handleZoneAnswer` -- the eyes-free ZonePad path -- never received the
 * gate. That left the three inputs behaving three different ways for the same
 * illegal Split: the button was impossible, the key was silently ignored, and
 * the zone tap still GRADED the impossible play, writing it into Stats and the
 * spaced-repetition deck. The path with no disabled affordance was the only
 * one that still penalised the learner, and it is the path used while driving.
 *
 * Hence a gate that returns a decision rather than a boolean: refusing is only
 * half the fix. The ZonePad cannot go grey, so a refusal there MUST be
 * audible, or it is indistinguishable from a dead app. `announcement` is the
 * sentence to speak, and it is deliberately plain enough to match the clip
 * cascade (see clips.ts / narrateReason) instead of dropping to robot voice.
 */

import type { Card } from '../engine/cards';
import type { Action } from '../engine/deviations';
import type { RuleSet, StrategyRules } from '../engine/ruleset';
import { drillLegalActions } from './legalActions';
import { quizLegalActions } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';

export interface AnswerGate {
  accepted: boolean;
  /** Spoken when refused; `null` when the answer is accepted. */
  announcement: string | null;
}

const ACTION_SPOKEN: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

const ACCEPTED: AnswerGate = { accepted: true, announcement: null };

/**
 * `cards` is `null` for prompts with no hand to judge -- the deviation quiz's
 * insurance items -- which are always accepted; gating them would make the
 * insurance prompt unanswerable.
 */
export function gateDrillAnswer(
  taken: string,
  cards: Card[] | null,
  rules: RuleSet,
): AnswerGate {
  if (cards === null) return ACCEPTED;
  if (!(taken in ACTION_SPOKEN)) return ACCEPTED;

  const action = taken as Action;
  if (drillLegalActions(cards, rules).includes(action)) return ACCEPTED;

  return { accepted: false, announcement: actionUnavailable(action) };
}

/**
 * The same decision for a DEVIATION QUIZ item.
 *
 * `gateDrillAnswer` answers "can this hand play that at this table", which is
 * the whole question for a flashcard. A quiz item carries a second one: it
 * was ASKED under a ctx (surrender off for a stand index, on for a Fab 4),
 * and an action that ctx excludes can never be the graded-correct answer.
 *
 * The ActionBar has shown that since RV3, by disabling the button. The
 * ZonePad cannot disable anything, and it was still gating on the table
 * alone -- so eyes-free, on a 16 v 9 at a table that offers surrender, a
 * blind tap on Surrender was graded against an expectation computed WITHOUT
 * surrender, called wrong, and demoted in the review deck. The eyes-on
 * learner could not make that mistake; the driver could not avoid it.
 *
 * The refusal says which of the two reasons it is, because they are
 * different facts about the world and one of them would otherwise be a lie
 * about the operator's own table.
 */
export function gateQuizAnswer(taken: string, item: QuizItem, rules: StrategyRules): AnswerGate {
  if (item.cards === null) return ACCEPTED;
  if (!(taken in ACTION_SPOKEN)) return ACCEPTED;

  const action = taken as Action;
  if (quizLegalActions(item, rules).includes(action)) return ACCEPTED;

  // Playable at the table, just not part of this question.
  if (drillLegalActions(item.cards, rules).includes(action)) {
    return { accepted: false, announcement: actionNotAsked(action) };
  }
  return { accepted: false, announcement: actionUnavailable(action) };
}

/**
 * The sentence spoken when an action is legal at the table but outside the
 * question. Deliberately not `actionUnavailable`: telling a driver that
 * Surrender "isn't available on this hand" when their own table offers it is
 * teaching them something false about the game.
 */
export function actionNotAsked(action: Action): string {
  return `${ACTION_SPOKEN[action]} isn't part of this question.`;
}

/**
 * The sentence spoken when an action cannot be played.
 *
 * Exported so LIVE TABLE play refuses in the same words the drills use. The
 * table cannot share `gateDrillAnswer` itself -- legality there comes from the
 * engine, which knows about split depth, doubling after split, and how many
 * cards the hand already holds, none of which a bare card list can answer --
 * but the refusal a driver hears must not depend on which screen they are on.
 */
export function actionUnavailable(action: Action): string {
  return `${ACTION_SPOKEN[action]} isn't available on this hand.`;
}
