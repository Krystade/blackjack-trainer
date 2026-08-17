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
import type { RuleSet } from '../engine/ruleset';
import { drillLegalActions } from './legalActions';

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

  return {
    accepted: false,
    announcement: `${ACTION_SPOKEN[action]} isn't available on this hand.`,
  };
}
