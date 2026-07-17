import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../cards';
import { DEFAULT_RULES } from '../ruleset';
import type { RuleSet } from '../ruleset';
import { getChart } from './index';
import type { Chart, DeckClass } from './types';
import { resolveDas } from './transforms';
import { HARD as HARD_D68_H17, SOFT as SOFT_D68_H17, PAIRS as PAIRS_D68_H17 } from './d68_h17';
import { HARD as HARD_D68_S17, SOFT as SOFT_D68_S17, PAIRS as PAIRS_D68_S17 } from './d68_s17';
import { HARD as HARD_D2_H17, SOFT as SOFT_D2_H17, PAIRS as PAIRS_D2_H17 } from './d2_h17';
import { HARD as HARD_D2_S17, SOFT as SOFT_D2_S17, PAIRS as PAIRS_D2_S17 } from './d2_s17';
import { HARD as HARD_D1_H17, SOFT as SOFT_D1_H17, PAIRS as PAIRS_D1_H17 } from './d1_h17';
import { HARD as HARD_D1_S17, SOFT as SOFT_D1_S17, PAIRS as PAIRS_D1_S17 } from './d1_s17';
import { chartLookup } from '../basicStrategy';
import { correctPlay, basicPlay } from '../strategy';
import type { PlayContext } from '../strategy';

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

// DEFAULT_RULES (and every override below) keeps das:true, ls:true. HARD/SOFT
// are untouched by resolveDas and stripLs is a no-op when ls:true, so they
// still deep-equal the raw base modules. PAIRS is das-resolved (Ph/Pd/Ps/Rp
// may turn into P) -- compare against resolveDas applied to the raw module,
// which is what getChart is documented to do, rather than the raw table.
function expectedPairs(raw: Chart, deckClass: DeckClass): Chart['PAIRS'] {
  return resolveDas(raw, true, deckClass).PAIRS;
}

describe('getChart', () => {
  it('getChart(DEFAULT_RULES) resolves the v1 d68_h17 tables (das:true collapses Ph/Ps cells to P)', () => {
    const raw: Chart = { HARD: HARD_D68_H17, SOFT: SOFT_D68_H17, PAIRS: PAIRS_D68_H17 };
    const chart = getChart(DEFAULT_RULES);
    expect(chart.HARD).toEqual(HARD_D68_H17);
    expect(chart.SOFT).toEqual(SOFT_D68_H17);
    expect(chart.PAIRS).toEqual(expectedPairs(raw, 'd68'));
  });

  it('returned chart is immutable: cannot mutate arrays or nested objects', () => {
    const chart = getChart(DEFAULT_RULES);

    // In strict mode, mutations throw; we use expect(...).toThrow to catch them.
    // Get the first row from each chart record.
    const hardFirstRow = Object.values(chart.HARD)[0];
    const softFirstRow = Object.values(chart.SOFT)[0];
    const pairsFirstRow = Object.values(chart.PAIRS)[0];

    expect(() => {
      hardFirstRow[0] = 'X' as any;
    }).toThrow();

    expect(() => {
      softFirstRow[0] = 'X' as any;
    }).toThrow();

    expect(() => {
      pairsFirstRow[0] = 'X' as any;
    }).toThrow();

    expect(() => {
      (chart as any).HARD = {};
    }).toThrow();
  });

  describe('resolves all (decks) × (s17) combos to the correct modules', () => {
    it('d1 H17 (decks=1, s17=false)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 1, s17: false };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D1_H17);
      expect(chart.SOFT).toEqual(SOFT_D1_H17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D1_H17, SOFT: SOFT_D1_H17, PAIRS: PAIRS_D1_H17 }, 'd1'));
    });

    it('d1 S17 (decks=1, s17=true)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 1, s17: true };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D1_S17);
      expect(chart.SOFT).toEqual(SOFT_D1_S17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D1_S17, SOFT: SOFT_D1_S17, PAIRS: PAIRS_D1_S17 }, 'd1'));
    });

    it('d2 H17 (decks=2, s17=false)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 2, s17: false };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D2_H17);
      expect(chart.SOFT).toEqual(SOFT_D2_H17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D2_H17, SOFT: SOFT_D2_H17, PAIRS: PAIRS_D2_H17 }, 'd2'));
    });

    it('d2 S17 (decks=2, s17=true)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 2, s17: true };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D2_S17);
      expect(chart.SOFT).toEqual(SOFT_D2_S17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D2_S17, SOFT: SOFT_D2_S17, PAIRS: PAIRS_D2_S17 }, 'd2'));
    });

    it('d68 H17 (decks=6, s17=false)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 6, s17: false };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D68_H17);
      expect(chart.SOFT).toEqual(SOFT_D68_H17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D68_H17, SOFT: SOFT_D68_H17, PAIRS: PAIRS_D68_H17 }, 'd68'));
    });

    it('d68 S17 (decks=6, s17=true)', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 6, s17: true };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D68_S17);
      expect(chart.SOFT).toEqual(SOFT_D68_S17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D68_S17, SOFT: SOFT_D68_S17, PAIRS: PAIRS_D68_S17 }, 'd68'));
    });

    it('d68 H17 (decks=8, s17=false) maps to same d68_h17 as decks=6', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 8, s17: false };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D68_H17);
      expect(chart.SOFT).toEqual(SOFT_D68_H17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D68_H17, SOFT: SOFT_D68_H17, PAIRS: PAIRS_D68_H17 }, 'd68'));
    });

    it('d68 S17 (decks=8, s17=true) maps to same d68_s17 as decks=6', () => {
      const rules: RuleSet = { ...DEFAULT_RULES, decks: 8, s17: true };
      const chart = getChart(rules);
      expect(chart.HARD).toEqual(HARD_D68_S17);
      expect(chart.SOFT).toEqual(SOFT_D68_S17);
      expect(chart.PAIRS).toEqual(expectedPairs({ HARD: HARD_D68_S17, SOFT: SOFT_D68_S17, PAIRS: PAIRS_D68_S17 }, 'd68'));
    });
  });
});

describe('chartLookup default-rules parity', () => {
  it('hard 16 vs 10 matches with and without an explicit rules arg', () => {
    const noArg = chartLookup(cards('9', '7'), '10');
    const withArg = chartLookup(cards('9', '7'), '10', DEFAULT_RULES);
    expect(noArg).toBe('Rh');
    expect(withArg).toBe(noArg);
  });

  it('pair 8s vs A matches with and without an explicit rules arg', () => {
    const noArg = chartLookup(cards('8', '8'), 'A');
    const withArg = chartLookup(cards('8', '8'), 'A', DEFAULT_RULES);
    expect(noArg).toBe('Rp');
    expect(withArg).toBe(noArg);
  });
});

describe('correctPlay/basicPlay default-rules parity', () => {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };

  it('correctPlay: hard 16 vs 10 basic case matches with/without explicit rules', () => {
    const noArg = correctPlay(cards('9', '7'), '10', -5, ctx);
    const withArg = correctPlay(cards('9', '7'), '10', -5, ctx, DEFAULT_RULES);
    expect(withArg).toEqual(noArg);
  });

  it('correctPlay: 16v10 deviation (tc>=0) still fires identically with default rules threaded', () => {
    // canSurrender:false so the basic Rh fallback (surrender-unavailable ->
    // hit) doesn't short-circuit before the deviation check.
    const noSurrenderCtx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
    const noArg = correctPlay(cards('9', '7'), '10', 1, noSurrenderCtx);
    const withArg = correctPlay(cards('9', '7'), '10', 1, noSurrenderCtx, DEFAULT_RULES);
    expect(noArg.source).toBe('illustrious18');
    expect(noArg.deviationId).toBe('16v10');
    expect(withArg).toEqual(noArg);
  });

  it('basicPlay: soft 18 vs 9 matches with/without explicit rules', () => {
    const noArg = basicPlay(cards('A', '7'), '9', ctx);
    const withArg = basicPlay(cards('A', '7'), '9', ctx, DEFAULT_RULES);
    expect(withArg).toEqual(noArg);
  });
});
