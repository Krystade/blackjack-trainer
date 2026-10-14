import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../engine/ruleset';
import { rulesChipLabels } from './legalActions';
import { drawQuizItem, quizRulesChip } from './deviationQuiz';

describe('#26 rules chip', () => {
  it('says what the prompt is graded under', () => {
    expect(rulesChipLabels({ canSurrender: true, canDouble: true }, { ls: true })).toEqual(['Surrender OK']);
    expect(rulesChipLabels({ canSurrender: true, canDouble: true }, { ls: false })).toEqual(['No surrender']);
    expect(rulesChipLabels({ canSurrender: false, canDouble: true }, { ls: true })).toEqual(['No surrender']);
    expect(rulesChipLabels({ canSurrender: true, canDouble: false }, { ls: true })).toEqual([
      'Surrender OK',
      'No double',
    ]);
  });

  it('a quiz stand index is asked with surrender off, a Fab 4 item with it on', () => {
    const rules = { ...DEFAULT_RULES, ls: true, surrenderIndices: true };
    const stand = drawQuizItem(1, '16v10', rules);
    expect(stand.deviationId).toBe('16v10');
    expect(quizRulesChip(stand, rules)).toEqual(['No surrender']);

    const fab4 = drawQuizItem(1, 'sur15v10', rules);
    expect(fab4.deviationId).toBe('sur15v10');
    expect(quizRulesChip(fab4, rules)).toEqual(['Surrender OK']);
  });

  it('an insurance item has no chip', () => {
    const rules = { ...DEFAULT_RULES };
    const ins = drawQuizItem(1, 'ins', rules);
    expect(ins.cards).toBeNull();
    expect(quizRulesChip(ins, rules)).toEqual([]);
  });
});
