import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import { goalPct, handCategoryProgress } from './handProgress';

describe('handCategoryProgress', () => {
  it('judges on the last 30 answers even when the stored window holds a spare', () => {
    const s = structuredClone(EMPTY_STATS);
    s.cellStats = { 'hard-16-v-10': { right: 31, wrong: 0, lastAt: '' } };
    // 31 stored: the oldest (a miss) is the Wrong-tap spare, not judged.
    s.handRecent = { hard: '0' + '1'.repeat(30) };
    const hard = handCategoryProgress(s)[0]!;
    expect(hard).toMatchObject({ recent: true, judgedRight: 30, judgedN: 30, pct: 1, onTarget: true });
  });

  it('carries the all-time category tally, which holds answers from before per-cell tracking', () => {
    const s = structuredClone(EMPTY_STATS);
    s.categories.pairs = { right: 380, wrong: 20 };
    s.cellStats = { 'pair-8-v-A': { right: 12, wrong: 0, lastAt: '' } };
    const pair = handCategoryProgress(s).find((c) => c.prefix === 'pair')!;
    // Judged on the cells only: the goal is about answers since.
    expect(pair).toMatchObject({ n: 12, thin: true, allRight: 380, allN: 400, legacy: true });
    // A tally no bigger than the cells is not older history.
    s.categories.pairs = { right: 10, wrong: 0 };
    expect(handCategoryProgress(s).find((c) => c.prefix === 'pair')!.legacy).toBe(false);
  });
});

describe('goalPct', () => {
  it('floors, so a miss never reads as the goal, and never prints 0% above zero', () => {
    expect(goalPct(0.899)).toBe('89%');
    expect(goalPct(0.9)).toBe('90%');
    expect(goalPct(1)).toBe('100%');
    expect(goalPct(0)).toBe('0%');
    expect(goalPct(1 / 300)).toBe('<1%');
  });
});
