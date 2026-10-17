import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import type { Stats } from '../../store/types';
import { readiness, weakestCategories } from './readiness';

function withCats(cats: Record<string, { right: number; wrong: number }>): Stats {
  const s = structuredClone(EMPTY_STATS);
  Object.assign(s.categories, cats);
  return s;
}

describe('readiness', () => {
  it('reports null, not zero, on a fresh install', () => {
    // "0% accurate" is a lie about someone who has not played yet.
    const r = readiness(structuredClone(EMPTY_STATS));
    expect(r.accuracyPct).toBeNull();
    expect(r.medianMs).toBeNull();
    expect(r.decisions).toBe(0);
  });

  it('computes accuracy across every category', () => {
    const r = readiness(withCats({ hard: { right: 8, wrong: 2 }, soft: { right: 1, wrong: 1 } }));
    expect(r.decisions).toBe(12);
    expect(r.accuracyPct).toBeCloseTo(75, 5);
  });

  it('never divides by zero when a category is untouched', () => {
    expect(readiness(withCats({ hard: { right: 0, wrong: 0 } })).accuracyPct).toBeNull();
  });

  it('counts an index as known once it has been answered right', () => {
    const s = structuredClone(EMPTY_STATS);
    s.perIndex['16v10'] = { right: 1, wrong: 0 };
    s.perIndex['15v10'] = { right: 0, wrong: 3 };
    const r = readiness(s);
    expect(r.indicesKnown).toBe(1);
    expect(r.indicesTotal).toBeGreaterThan(10);
  });
});

describe('weakestCategories', () => {
  it('ignores categories with too few attempts to mean anything', () => {
    // One miss out of one is not evidence of a weakness.
    expect(weakestCategories(withCats({ hard: { right: 0, wrong: 1 } }))).toEqual([]);
  });

  it('lists the worst first, and only categories below the 90% target (W13)', () => {
    const s = structuredClone(EMPTY_STATS);
    s.cellStats = {
      'hard-16-v-10': { right: 9, wrong: 1, lastAt: '' }, // 90%: on target, not weak
      'soft-18-v-9': { right: 5, wrong: 5, lastAt: '' },
      'pair-8-v-A': { right: 2, wrong: 8, lastAt: '' },
    };
    expect(weakestCategories(s)).toEqual(['pairs', 'soft']);
  });

  it('reads hard/soft/pairs from the same judged figure as Next step (W3, F27)', () => {
    const s = structuredClone(EMPTY_STATS);
    // The old per-category tally says hard is weak; the cells and the recent
    // window (what Next step and Stats judge on) say it is not.
    s.categories.hard = { right: 1, wrong: 9 };
    s.cellStats = { 'hard-16-v-10': { right: 20, wrong: 10, lastAt: '' } };
    s.handRecent = { hard: '1'.repeat(30) };
    expect(weakestCategories(s)).toEqual([]);
    s.handRecent = { hard: '0'.repeat(10) + '1'.repeat(20) };
    expect(weakestCategories(s)).toEqual(['hard']);
  });

  it('still names non-hand categories from their own tally', () => {
    expect(weakestCategories(withCats({ wong: { right: 3, wrong: 7 } }))).toEqual(['wong']);
  });

  it('omits categories with no mistakes at all', () => {
    expect(weakestCategories(withCats({ hard: { right: 10, wrong: 0 } }))).toEqual([]);
  });
});
