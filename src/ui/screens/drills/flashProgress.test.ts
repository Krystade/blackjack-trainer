import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../../../store/types';
import type { Stats } from '../../../store/types';
import { flashProgressLine, goalsCrossed, goalMetLine } from './flashProgress';

const withHard = (right: number, wrong: number, recent?: string): Stats => ({
  ...EMPTY_STATS,
  cellStats: { 'hard-16-v-10': { right, wrong, lastAt: '', ...(recent ? { recent } : {}) } },
  ...(recent ? { handRecent: { hard: recent } } : {}),
});

describe('flashProgressLine', () => {
  it('shows answers until a hand type can be judged, then its figure, ticked at the goal', () => {
    expect(flashProgressLine(withHard(5, 2), ['hard'])).toBe('Goal 90%: Hard 7/20');
    expect(flashProgressLine(withHard(27, 3, '1'.repeat(27) + '000'), ['hard'])).toBe('Goal 90%: Hard 90% ✓');
    expect(flashProgressLine(withHard(26, 4, '1'.repeat(26) + '0000'), ['hard', 'soft'])).toBe('Goal 90%: Hard 86% · Soft 0/20');
  });
});

describe('goalsCrossed', () => {
  it('names a hand type the moment it reaches the goal, and only then', () => {
    const before = withHard(19, 0, '1'.repeat(19));
    const after = withHard(20, 0, '1'.repeat(20));
    expect(goalsCrossed(before, after, ['hard'])).toEqual(['Hard totals']);
    expect(goalsCrossed(after, withHard(21, 0, '1'.repeat(21)), ['hard'])).toEqual([]);
    expect(goalMetLine(['Hard totals'], after)).toBe('Hard totals on target: 100% over your last 20.');
  });
});
