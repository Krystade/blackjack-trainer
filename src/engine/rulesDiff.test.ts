import { describe, it, expect, vi } from 'vitest';
import { DEFAULT_RULES, type StrategyRules } from './ruleset';
import { ILLUSTRIOUS_18, type Deviation } from './deviations';
import { cellIdForDeviation, comparisonRules, diffRules, rulesNames } from './rulesDiff';

const r = (p: Partial<StrategyRules>): StrategyRules => ({ ...DEFAULT_RULES, ...p });
const fmt = (d: Deviation | null) => (d === null ? 'none' : `${d.active ? '' : 'off '}${d.dir} ${d.threshold}`);
const cells = (a: StrategyRules, b: StrategyRules) => diffRules(a, b).cells.map((c) => `${c.cellId}:${c.a}/${c.b}`).sort();
const idx = (a: StrategyRules, b: StrategyRules) => diffRules(a, b).indices.map((d) => `${d.id}:${fmt(d.a)}/${fmt(d.b)}`).sort();

const SIX_D_CELLS = ['hard-11-v-A:Dh/H', 'hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'pair-8-v-A:Rp/P', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S'];
const H17_S17_INDICES = ['10vA:gte 3/gte 4', '11vA:off gte 0/gte 1', '12v6:lte -4/lte -2', '16v9:gte 4/gte 5'];

describe('diffRules, H17 vs S17', () => {
  it('6 decks: exactly the six cells the spec names (11vA, A7v2, A8v6, 15vA/17vA/88vA surrender)', () => {
    expect(cells(r({ s17: false }), r({ s17: true }))).toEqual(SIX_D_CELLS);
    expect(diffRules(r({ s17: false }), r({ s17: true })).sameChart).toBe(false);
  });
  it('6 decks: four index changes', () => {
    expect(idx(r({ s17: false }), r({ s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('8 decks: same as 6', () => {
    expect(cells(r({ decks: 8, s17: false }), r({ decks: 8, s17: true }))).toEqual(SIX_D_CELLS);
    expect(idx(r({ decks: 8, s17: false }), r({ decks: 8, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('6 decks, late surrender off: the surrender lines drop out', () => {
    expect(cells(r({ s17: false, ls: false }), r({ s17: true, ls: false }))).toEqual(['hard-11-v-A:Dh/H', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S']);
  });
  it('2 decks', () => {
    expect(cells(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }))).toEqual(
      ['hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'soft-14-v-4:Dh/H', 'soft-18-v-2:Ds/S', 'soft-19-v-6:Ds/S']);
    expect(idx(r({ decks: 2, s17: false }), r({ decks: 2, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('1 deck', () => {
    expect(cells(r({ decks: 1, s17: false }), r({ decks: 1, s17: true }))).toEqual(
      ['hard-15-v-A:Rh/H', 'hard-17-v-A:Rs/S', 'pair-7-v-A:Rh/H', 'pair-9-v-A:P/S', 'soft-18-v-A:H/S']);
    expect(idx(r({ decks: 1, s17: false }), r({ decks: 1, s17: true }))).toEqual(H17_S17_INDICES);
  });
  it('Fab 4 on: 15 v A moves two counts and two surrender indices are H17-only', () => {
    expect(idx(r({ s17: false, surrenderIndices: true }), r({ s17: true, surrenderIndices: true }))).toEqual(
      [...H17_S17_INDICES, 'sur15vA:gte -1/gte 1', 'sur16v8:gte 4/none', 'sur16v9:gte 0/none']);
  });
});

describe('diffRules, deck counts', () => {
  it.each([false, true])('6 vs 8 decks share the d68 chart and every index (s17 %s)', (s17) => {
    for (const surrenderIndices of [false, true]) {
      const d = diffRules(r({ decks: 6, s17, surrenderIndices }), r({ decks: 8, s17, surrenderIndices }));
      expect(d.sameChart).toBe(true);
      expect(d.cells).toEqual([]);
      expect(d.indices).toEqual([]);
    }
  });
  it('6 vs 1 deck: 17 chart cells and only the insurance index', () => {
    const d = diffRules(r({}), r({ decks: 1 }));
    expect(d.cells).toHaveLength(17);
    expect(idx(r({}), r({ decks: 1 }))).toEqual(['ins:gte 3/gte 2']);
  });
});

describe('cellIdForDeviation', () => {
  const byId = (id: string) => ILLUSTRIOUS_18.find((d) => d.id === id)!;
  it('maps every kind this lane knows', () => {
    expect(cellIdForDeviation(byId('12v6'))).toBe('hard-12-v-6');
    expect(cellIdForDeviation(byId('10vA'))).toBe('hard-10-v-A');
    expect(cellIdForDeviation(byId('TTv5'))).toBe('pair-10-v-5');
    expect(cellIdForDeviation(byId('ins'))).toBe('insurance');
  });
  it('maps a soft kind with total and up, and returns null for an unknown kind', () => {
    expect(cellIdForDeviation({ ...byId('9v2'), kind: 'soft', total: 19, up: '6' } as unknown as Deviation)).toBe('soft-19-v-6');
    expect(cellIdForDeviation({ ...byId('9v2'), kind: 'mystery' } as unknown as Deviation)).toBeNull();
  });
});

describe('comparisonRules and rulesNames', () => {
  it("comparisonRules keeps the profile's options on both sides", () => {
    const base = r({ decks: 2, s17: true, surrenderIndices: true });
    expect(comparisonRules(base, 'h17s17')).toEqual([{ ...base, s17: false }, { ...base, s17: true }]);
    expect(comparisonRules(base, 'decks68')).toEqual([{ ...base, decks: 6 }, { ...base, decks: 8 }]);
    expect(comparisonRules(base, 'custom', { decks: 8, s17: false })).toEqual([base, { ...base, decks: 8, s17: false }]);
  });
  it('names only what differs', () => {
    expect(rulesNames(r({ s17: false }), r({ s17: true }))).toEqual(['H17', 'S17']);
    expect(rulesNames(r({ decks: 6 }), r({ decks: 8 }))).toEqual(['6 decks', '8 decks']);
    expect(rulesNames(r({ decks: 6, s17: false }), r({ decks: 1, s17: true }))).toEqual(['6 decks · H17', '1 deck · S17']);
    expect(rulesNames(r({ ls: true }), r({ ls: false }))).toEqual(['surrender', 'no surrender']);
    expect(rulesNames(r({}), r({}))).toEqual(['Your game', 'Your game']);
  });
});

describe('diffRules compares every index field, not only threshold', () => {
  it('flags entries whose threshold matches but dir, active, action or kind differ', async () => {
    const base = ILLUSTRIOUS_18.find((d) => d.id === '16v10')!;
    const same = { ...base, id: '15v10' as const };
    const setA: Deviation[] = [base, { ...base, id: '12v2' }, { ...base, id: '12v3' }, { ...base, id: '13v2' }, same];
    const setB: Deviation[] = [
      { ...base, dir: 'lte' },
      { ...base, id: '12v2', active: false },
      { ...base, id: '12v3', action: 'hit' },
      { ...base, id: '13v2', kind: 'surrender' },
      same,
    ];
    vi.resetModules();
    vi.doMock('./deviations', async (orig) => ({
      ...(await orig<typeof import('./deviations')>()),
      indexSetFor: (rules: StrategyRules) => (rules.s17 ? setB : setA),
    }));
    try {
      const mod = await import('./rulesDiff');
      expect(mod.diffRules(r({ s17: false }), r({ s17: true })).indices.map((d) => d.id)).toEqual(['16v10', '12v2', '12v3', '13v2']);
    } finally {
      vi.doUnmock('./deviations');
      vi.resetModules();
    }
  });
});
