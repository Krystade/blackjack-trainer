import { describe, it, expect } from 'vitest';
import { tableMaskNote } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import type { Card } from '../engine/cards';

const c = (rank: Card['rank']): Card => ({ rank, suit: 's' });

const WITH_SURRENDER: StrategyRules = { ...DEFAULT_RULES, ls: true, surrenderIndices: true };

function item(patch: Partial<QuizItem>): QuizItem {
  return {
    cards: [c('10'), c('6')],
    up: '9',
    tc: 5,
    deviationId: '16v9',
    isDeviationSide: true,
    correct: 'stand',
    label: '16 v 9: stand at TC >= +4 (H17)',
    isDistractor: false,
    ...patch,
  } as QuizItem;
}

describe('the sentence saying which table the question was asked for', () => {
  it('speaks up where the drill and the table the operator sits at disagree', () => {
    // sur16v9 surrenders from TC 0 up; the 16v9 stand index starts at +4.
    // Every count this index covers is a surrender at a table that allows
    // one, so "stand at +4" is a play their table penalises.
    const note = tableMaskNote(item({}), WITH_SURRENDER);
    expect(note, 'the quiz taught a play the table overrules, silently').not.toBeNull();
    expect(note).toContain('surrender');
  });

  it('says nothing at a table with no surrender, where the drill IS the table', () => {
    expect(tableMaskNote(item({}), { ...WITH_SURRENDER, ls: false })).toBeNull();
  });

  it('says nothing about a cell the two tables agree on', () => {
    // 12 v 3 stands from TC +2 at both tables: no surrender cell, no
    // surrender index, nothing masked. This is the guard on the test above
    // -- a note printed on every item passes that one and fails this.
    expect(
      tableMaskNote(
        item({
          cards: [c('7'), c('5')],
          up: '3',
          tc: 2,
          deviationId: '12v3',
          correct: 'stand',
          label: '12 v 3: stand at TC >= +2',
        }),
        WITH_SURRENDER,
      ),
    ).toBeNull();
  });

  it('says nothing on a Fab 4 item, which is asked with surrender on', () => {
    expect(
      tableMaskNote(
        item({
          cards: [c('10'), c('5')],
          up: '10',
          tc: 2,
          deviationId: 'sur15v10',
          correct: 'surrender',
          label: '15 v 10: surrender at TC >= 0',
        }),
        WITH_SURRENDER,
      ),
    ).toBeNull();
  });

  it('says nothing on an insurance prompt or a distractor', () => {
    expect(tableMaskNote(item({ cards: null, deviationId: 'ins' }), WITH_SURRENDER)).toBeNull();
    expect(
      tableMaskNote(item({ deviationId: undefined, isDistractor: true }), WITH_SURRENDER),
    ).toBeNull();
  });
});
