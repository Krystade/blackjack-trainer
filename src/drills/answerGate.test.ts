import type { DeviationId } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { drawQuizItem } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';
import { describe, it, expect } from 'vitest';
import type { Card } from '../engine/cards';
import { gateDrillAnswer, gateQuizAnswer } from './answerGate';

const c = (rank: Card['rank'], suit: Card['suit'] = 's'): Card => ({ rank, suit });

const NON_PAIR = [c('10', 's'), c('6', 'h')];
const PAIR = [c('8', 's'), c('8', 'h')];
const NO_SURRENDER = { ...DEFAULT_RULES, ls: false };

describe('gateDrillAnswer', () => {
  it('accepts an action the hand actually allows', () => {
    expect(gateDrillAnswer('hit', NON_PAIR, DEFAULT_RULES).accepted).toBe(true);
  });

  it('refuses a split on a non-pair', () => {
    expect(gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES).accepted).toBe(false);
  });

  it('accepts a split on a pair', () => {
    expect(gateDrillAnswer('split', PAIR, DEFAULT_RULES).accepted).toBe(true);
  });

  it('refuses surrender when the ruleset has none', () => {
    expect(gateDrillAnswer('surrender', NON_PAIR, NO_SURRENDER).accepted).toBe(false);
  });

  it('says WHY it refused, so an eyes-free tap is never silent', () => {
    // The whole point of A1: the zone pad has no disabled affordance, so a
    // refusal that produces no sound is indistinguishable from a dead app.
    const gate = gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES);
    expect(gate.announcement).toBe("Split isn't available on this hand.");
  });

  it('names the refused action, not a generic error', () => {
    expect(gateDrillAnswer('surrender', NON_PAIR, NO_SURRENDER).announcement).toBe(
      "Surrender isn't available on this hand.",
    );
  });

  it('announces nothing when the action is accepted', () => {
    expect(gateDrillAnswer('hit', NON_PAIR, DEFAULT_RULES).announcement).toBeNull();
  });

  it('uses only clip-friendly words — no symbols the voice cannot say', () => {
    // Corrections fall back to robot-voice live TTS whenever a string cannot
    // match the clip cascade (see narrateReason); a refusal spoken mid-drive
    // deserves the same care.
    const gate = gateDrillAnswer('split', NON_PAIR, DEFAULT_RULES);
    expect(gate.announcement).not.toMatch(/[^a-zA-Z'. ]/);
  });

  it('accepts insurance answers, which have no hand to gate against', () => {
    // The deviation quiz's insurance items pass no cards at all; gating them
    // as "illegal" would make the insurance prompt unanswerable.
    expect(gateDrillAnswer('take-insurance', null, DEFAULT_RULES).accepted).toBe(true);
    expect(gateDrillAnswer('decline-insurance', null, DEFAULT_RULES).accepted).toBe(true);
  });

  it('accepts any action when there is no hand to judge against', () => {
    expect(gateDrillAnswer('split', null, DEFAULT_RULES).accepted).toBe(true);
  });
});

/* ---------------------------------------------------------------------- */
/* F1: the gate a BLIND tap passes has to be the gate the buttons show     */
/* ---------------------------------------------------------------------- */

describe('the blind pad asks the same question the screen asks', () => {
  // Surrender offered at the table AND surrender indices on: the only
  // configuration where the two questions differ.
  const RULES: StrategyRules = { ...DEFAULT_RULES, ls: true, surrenderIndices: true };

  /** The first drawn item matching a predicate, or a failed test. */
  function drawWhere(filter: DeviationId, want: (item: QuizItem) => boolean): QuizItem {
    for (let seed = 1; seed <= 200; seed += 1) {
      const item = drawQuizItem(seed, filter, RULES);
      if (want(item)) return item;
    }
    throw new Error(`no ${filter} item matched in 200 draws`);
  }

  it('refuses a play the QUESTION excluded, though the table allows it', () => {
    // 16 v 9 is asked with surrender unavailable -- it has to be, or basic
    // surrender masks the stand index the question is about. The table
    // allows surrender, so `drillLegalActions` says yes and the pad graded
    // it. The ActionBar, on the same item, renders that button disabled.
    const item = drawWhere('16v9', (i) => i.cards !== null);
    const gate = gateQuizAnswer('surrender', item, RULES);
    expect(gate.accepted, 'the blind pad graded a play the screen disabled').toBe(false);
    expect(gate.announcement, 'refused in silence, which is a dead app eyes-free').toBeTruthy();
    // ...and it does NOT claim the hand cannot be surrendered, because it
    // can: the operator would hear a false statement about their own table.
    expect(gate.announcement).not.toContain("isn't available on this hand");
  });

  it('accepts a surrender that IS the answer, on a surrender index', () => {
    // The other half. A fix that refused surrender everywhere in the quiz
    // would pass the test above and make every Fab 4 item unanswerable.
    const item = drawWhere('sur15v10', (i) => i.correct === 'surrender');
    expect(gateQuizAnswer('surrender', item, RULES).accepted).toBe(true);
  });

  it('still refuses a play the HAND cannot make, in the hand\u2019s own words', () => {
    const item = drawWhere('16v9', (i) => i.cards !== null);
    const gate = gateQuizAnswer('split', item, RULES);
    expect(gate.accepted).toBe(false);
    expect(gate.announcement).toContain("isn't available on this hand");
  });

  it('accepts everything on an insurance item, which has no hand to judge', () => {
    const item = drawWhere('ins', (i) => i.cards === null);
    expect(gateQuizAnswer('take-insurance', item, RULES).accepted).toBe(true);
    expect(gateQuizAnswer('decline-insurance', item, RULES).accepted).toBe(true);
  });
});
