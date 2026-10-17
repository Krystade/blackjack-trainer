import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../../store/types';
import type { Stats } from '../../store/types';
import { activeIndices, readiness, weakestCategories } from './readiness';
import { ladder } from './nextStep';
import { indexTestSet } from '../../drills/indexTest';
import { indexSetFor } from '../../engine/deviations';
import { DEFAULT_RULES } from '../../engine/ruleset';

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

  // Wave B2 #10 (deliberate change): the tile used to count indexes answered
  // RIGHT once ("seen"), beside the ladder's "practised" (3+ answers), so four
  // misses read "1/17 practised" over "0/17 seen". One figure now.
  it('counts an index as practised from three answers, right or wrong, as the ladder does', () => {
    const s = structuredClone(EMPTY_STATS);
    s.perIndex['16v10'] = { right: 1, wrong: 0 };
    s.perIndex['15v10'] = { right: 0, wrong: 3 };
    s.perIndex['12v3'] = { right: 0, wrong: 4 };
    const r = readiness(s);
    expect(r.indicesPractised).toBe(2);
    expect(r.indicesTotal).toBe(17);
    const rung = ladder(s, { sweepDone: true }).rungs.find((x) => x.id === 'deviations')!;
    expect(rung.progress).toBe(`${r.indicesPractised}/${r.indicesTotal} indices practised`);
  });
});

describe('readiness index set (F11)', () => {
  it('follows the profile: H17 17, S17 18 (11vA), and the Fab 4 on top', () => {
    const s = structuredClone(EMPTY_STATS);
    s.perIndex['11vA'] = { right: 1, wrong: 0 };
    s.perIndex['11vA'] = { right: 3, wrong: 0 };
    expect(readiness(s, { decks: 6, s17: false })).toMatchObject({ indicesTotal: 17, indicesPractised: 0 });
    expect(readiness(s, { decks: 6, s17: true })).toMatchObject({ indicesTotal: 18, indicesPractised: 1 });
    expect(readiness(s, { decks: 6, s17: true, surrenderIndices: true }).indicesTotal).toBe(18 + 4);
  });
});

describe('Wave B2 #22: Home counts the indexes the drills ask', () => {
  const rules = (r: object) => ({ ...DEFAULT_RULES, ...r });
  it.each([
    ['H17', {}],
    ['H17 with BJA extras', { bjaExtras: true }],
    ['H17 with Fab 4 and extras', { surrenderIndices: true, bjaExtras: true }],
    ['S17 with Fab 4', { s17: true, surrenderIndices: true }],
    ['2-deck H17', { decks: 2 }],
  ])('%s: the total is the Index test set, inactive and chart-played indexes left out', (_n, r) => {
    const asked = indexTestSet(rules(r)).map((d) => d.id).sort();
    expect(activeIndices(rules(r)).map((d) => d.id).sort()).toEqual(asked);
    expect(readiness(structuredClone(EMPTY_STATS), rules(r)).indicesTotal).toBe(asked.length);
    // No inactive index is counted.
    const inactive = indexSetFor(rules(r)).filter((d) => !d.active).map((d) => d.id);
    for (const id of inactive) expect(asked).not.toContain(id);
  });
  it('2-deck H17: 9 v 2 is never asked there, so it is not in the total (16, not 17)', () => {
    expect(readiness(structuredClone(EMPTY_STATS), rules({ decks: 2 })).indicesTotal).toBe(16);
    expect(activeIndices(rules({ decks: 2 })).map((d) => d.id)).not.toContain('9v2');
  });
  it('an inactive index with tallies does not count toward practised', () => {
    const s = structuredClone(EMPTY_STATS);
    s.perIndex['11vA'] = { right: 5, wrong: 0 };
    expect(readiness(s, rules({}))).toMatchObject({ indicesPractised: 0, indicesTotal: 17 });
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
