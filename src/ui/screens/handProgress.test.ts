import { describe, expect, it } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import { goalPct, handCategoryProgress } from './handProgress';
import { nextStep } from './nextStep';

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

describe('Wave B2 #9: index answers are not older history', () => {
  it('a new user who only answered the Deviation quiz is not called a returning user', () => {
    // What the tester's legacy.mjs found: 4 answers on 16 v 10 land in the
    // category tally and perIndex, never in cellStats (F4).
    const s = structuredClone(EMPTY_STATS);
    s.categories.hard = { right: 1, wrong: 3 };
    s.perIndex['16v10'] = { right: 1, wrong: 3 };
    expect(handCategoryProgress(s)[0]!.legacy).toBe(false);
    expect(nextStep(s, { sweepDone: false }).why).toBe(
      'Hard totals: 0 answers so far, 20 needed to judge. Get every category to 90%.',
    );
  });
  it('pairs and soft indexes are discounted from their own categories', () => {
    const s = structuredClone(EMPTY_STATS);
    s.categories.pairs = { right: 2, wrong: 2 };
    s.perIndex.TTv6 = { right: 2, wrong: 2 };
    s.categories.soft = { right: 3, wrong: 0 };
    s.perIndex.A8v4 = { right: 3, wrong: 0 };
    const [, soft, pair] = handCategoryProgress(s);
    expect(soft!.legacy).toBe(false);
    expect(pair!.legacy).toBe(false);
  });
  it('real older answers on top of index answers still read as older history', () => {
    const s = structuredClone(EMPTY_STATS);
    s.categories.hard = { right: 41, wrong: 3 };
    s.perIndex['16v10'] = { right: 1, wrong: 3 };
    s.cellStats = { 'hard-16-v-9': { right: 10, wrong: 0, lastAt: '' } };
    expect(handCategoryProgress(s)[0]!.legacy).toBe(true);
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
