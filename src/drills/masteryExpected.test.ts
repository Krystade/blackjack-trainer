import { describe, it, expect } from 'vitest';
import { buildFlashcardEvent, masteryExpectedPlay } from './gradeAnswer';
import { generateAllCells } from './flashcards';
import { DEFAULT_RULES, type StrategyRules } from '../engine/ruleset';
import type { PlayContext } from '../engine/strategy';
import type { Card } from '../engine/cards';

/**
 * R1 (review of C10): the Mastery challenge showed 16 v 10 "stand" (the TC 0
 * index) while the grader, which reads a card with no count by the chart
 * alone, marked Stand a miss. The view's expected play is masteryExpectedPlay;
 * this pins it to the grader for every cell, with and without late
 * surrender, and with the Fallbacks contexts.
 */
const CTXS: (PlayContext | undefined)[] = [
  undefined,
  { canDouble: false, canSplit: true, canSurrender: false },
  { canDouble: true, canSplit: true, canSurrender: false },
  { canDouble: false, canSplit: false, canSurrender: false },
];
const RULES: [string, StrategyRules][] = [
  ['default', DEFAULT_RULES],
  ['no LS', { ...DEFAULT_RULES, ls: false }],
  ['LS', { ...DEFAULT_RULES, ls: true }],
];

describe('Mastery: the play shown is the play graded', () => {
  it.each(RULES)('every cell, %s', (_name, rules) => {
    for (const cell of generateAllCells()) {
      for (const ctx of CTXS) {
        const expected = masteryExpectedPlay(cell.cards, cell.up, ctx, rules);
        const card = { cards: cell.cards, up: cell.up, correct: expected, cellId: cell.id, ...(ctx ? { ctx } : {}) };
        const graded = buildFlashcardEvent(card, expected, rules, 500, 'mastery');
        expect({ cell: cell.id, ctx, action: graded.correctAction }).toEqual({ cell: cell.id, ctx, action: expected });
        expect({ cell: cell.id, ctx, correct: graded.correct }).toEqual({ cell: cell.id, ctx, correct: true });
      }
    }
  });

  it('16 v 10 without surrender is hit, and Hit is graded right', () => {
    const rules = { ...DEFAULT_RULES, ls: false };
    const cards: Card[] = [{ rank: '10', suit: 's' }, { rank: '6', suit: 'h' }];
    expect(masteryExpectedPlay(cards, '10', undefined, rules)).toBe('hit');
    const card = { cards, up: '10' as const, correct: 'hit' as const, cellId: 'hard-16-v-10' };
    expect(buildFlashcardEvent(card, 'hit', rules, 500, 'mastery').correct).toBe(true);
    expect(buildFlashcardEvent(card, 'stand', rules, 500, 'mastery').correct).toBe(false);
  });
});
