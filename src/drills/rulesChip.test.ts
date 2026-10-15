import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import type { Card, Rank } from '../engine/cards';
import { drillLegalActions, rulesChipLabels } from './legalActions';
import { drawQuizItem, quizLegalActions, quizRulesChip } from './deviationQuiz';
import { generateAllCells } from './flashcards';

const NO_LS: RuleSet = { ...DEFAULT_RULES, ls: false };
const c = (rank: Rank, suit: Card['suit'] = 's'): Card => ({ rank, suit });
const OPEN = { canSurrender: true, canDouble: true };

describe('#26 rules chip', () => {
  it('says what the prompt is graded under', () => {
    expect(rulesChipLabels(OPEN, DEFAULT_RULES)).toEqual(['Surrender OK']);
    expect(rulesChipLabels(OPEN, NO_LS)).toEqual(['No surrender']);
    expect(rulesChipLabels({ canSurrender: false, canDouble: true }, DEFAULT_RULES)).toEqual(['No surrender']);
    expect(rulesChipLabels({ canSurrender: true, canDouble: false }, DEFAULT_RULES)).toEqual([
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

/**
 * Review fix (d): the chip said "Surrender OK" beside a greyed Surrender
 * button on soft hands and most pairs. On a hand the drills do not offer
 * surrender on (#11) it now says "No surrender"; where they do, it keeps the
 * grading-context wording, so it never says more than the button does.
 */
describe('the chip agrees with the Surrender button', () => {
  it('A,2 v 2 and 8,8 v 10 say No surrender at a table that offers it', () => {
    expect(rulesChipLabels(OPEN, DEFAULT_RULES, { cards: [c('A'), c('2')], up: '2' })).toEqual(['No surrender']);
    expect(rulesChipLabels(OPEN, DEFAULT_RULES, { cards: [c('8'), c('8', 'h')], up: '10' })).toEqual([
      'No surrender',
    ]);
  });

  it('a hard hand keeps the grading context whether or not surrender is right', () => {
    // 16 v 10 surrenders; 9,7 v 2 does not. The chip must not tell them apart.
    expect(rulesChipLabels(OPEN, DEFAULT_RULES, { cards: [c('10'), c('6')], up: '10' })).toEqual(['Surrender OK']);
    expect(rulesChipLabels(OPEN, DEFAULT_RULES, { cards: [c('9'), c('7')], up: '2' })).toEqual(['Surrender OK']);
  });

  it('a pair surrender cell says Surrender OK (8,8 v A, six decks H17)', () => {
    expect(rulesChipLabels(OPEN, DEFAULT_RULES, { cards: [c('8'), c('8', 'h')], up: 'A' })).toEqual([
      'Surrender OK',
    ]);
  });

  it('on every flashcard cell and ruleset, Surrender OK exactly when the button is live', () => {
    let checked = 0;
    for (const decks of [1, 2, 6, 8] as const)
      for (const s17 of [false, true])
        for (const das of [false, true])
          for (const ls of [false, true]) {
            const rules: RuleSet = { ...DEFAULT_RULES, decks, s17, das, ls };
            for (const cell of generateAllCells()) {
              const live = drillLegalActions(cell.cards, rules, cell.up).includes('surrender');
              const chip = rulesChipLabels(OPEN, rules, cell);
              expect(chip[0], `${cell.id} ${JSON.stringify(rules)}`).toBe(live ? 'Surrender OK' : 'No surrender');
              checked++;
            }
          }
    expect(checked).toBe(32 * 330);
  });

  it('a quiz item says Surrender OK only where its own Surrender button is live', () => {
    const rules = { ...DEFAULT_RULES, ls: true, surrenderIndices: true };
    for (let seed = 1; seed <= 400; seed++) {
      const item = drawQuizItem(seed, undefined, rules, 50);
      if (!item.cards) continue;
      const live = quizLegalActions(item, rules).includes('surrender');
      expect(quizRulesChip(item, rules)[0], item.label).toBe(live ? 'Surrender OK' : 'No surrender');
    }
  });
});
