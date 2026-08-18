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

  it('lists the worst first', () => {
    const s = withCats({
      hard: { right: 9, wrong: 1 },
      soft: { right: 5, wrong: 5 },
      pairs: { right: 2, wrong: 8 },
    });
    expect(weakestCategories(s)).toEqual(['pairs', 'soft', 'hard']);
  });

  it('omits categories with no mistakes at all', () => {
    expect(weakestCategories(withCats({ hard: { right: 10, wrong: 0 } }))).toEqual([]);
  });
});
