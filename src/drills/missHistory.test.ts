import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { missHistoryLine, ordinal, shortCellLabel } from './missHistory';

const miss = (hand: string, extra: Partial<GradedEvent> = {}): GradedEvent => ({
  kind: 'action', category: 'pairs', correct: false, classification: 'basic-error',
  taken: 'stand', expected: 'split', reason: 'Basic split vs dealer 4', tc: 0, hand, ...extra,
});

describe('missHistoryLine', () => {
  it('says the cost, which miss this is on the cell, and how many of the last five', () => {
    // recent '0111' + this miss = '01110': five results, two misses. Last four would hold only one.
    expect(missHistoryLine(miss('pair-8-v-4', { evCost: 0.6123 }), { right: 3, wrong: 2, lastAt: '', recent: '0111' })).toBe('−0.61 u · 3rd miss on 8,8 v 4, 2 of last 5');
    // Four results after the miss: too few for "of last 5".
    expect(missHistoryLine(miss('pair-8-v-4', { evCost: 0.61 }), { right: 2, wrong: 1, lastAt: '', recent: '101' })).toBe('−0.61 u · 2nd miss on 8,8 v 4');
    // A full stored window (11) reads only its last five.
    expect(missHistoryLine(miss('soft-18-v-9'), { right: 5, wrong: 10, lastAt: '', recent: '0000011111' })).toBe('11th miss on A,7 v 9, 1 of last 5');
  });
  it('drops what it cannot say honestly', () => {
    expect(missHistoryLine(miss('hard-16-v-10'), null)).toBe('1st miss on 16 v 10');
    expect(missHistoryLine(miss('hard-16-v-10', { evCost: 0.0004 }), null)).toBe('under 0.01 u · 1st miss on 16 v 10');
    expect(missHistoryLine({ ...miss('hard-16-v-10'), correct: true, classification: 'correct' }, null)).toBeNull();
    expect(missHistoryLine(miss('9,7 v 10', { deviationId: '16v10' }), null)).toBeNull();
    expect(missHistoryLine({ ...miss('dealer A'), kind: 'insurance' }, null)).toBeNull();
  });
  it('reads table notation from the quiz the same as a cell id', () => {
    expect(missHistoryLine(miss('9,7 v 10', { evCost: 0.02 }), null)).toBe('−0.02 u · 1st miss on 16 v 10');
  });
});

describe('labels', () => {
  it('ordinal', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st']);
  });
  it('shortCellLabel', () => {
    expect(['hard-16-v-10', 'soft-18-v-9', 'pair-8-v-4', 'pair-A-v-6'].map(shortCellLabel)).toEqual(['16 v 10', 'A,7 v 9', '8,8 v 4', 'A,A v 6']);
  });
});
