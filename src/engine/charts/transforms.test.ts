import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../cards';
import type { Chart, DeckClass } from './types';
import { resolveDas, stripLs, assertFullyResolved } from './transforms';
import { getChart } from './index';
import { HARD as HARD_D68_H17, SOFT as SOFT_D68_H17, PAIRS as PAIRS_D68_H17 } from './d68_h17';
import { HARD as HARD_D68_S17, SOFT as SOFT_D68_S17, PAIRS as PAIRS_D68_S17 } from './d68_s17';
import { HARD as HARD_D2_H17, SOFT as SOFT_D2_H17, PAIRS as PAIRS_D2_H17 } from './d2_h17';
import { HARD as HARD_D2_S17, SOFT as SOFT_D2_S17, PAIRS as PAIRS_D2_S17 } from './d2_s17';
import { HARD as HARD_D1_H17, SOFT as SOFT_D1_H17, PAIRS as PAIRS_D1_H17 } from './d1_h17';
import { HARD as HARD_D1_S17, SOFT as SOFT_D1_S17, PAIRS as PAIRS_D1_S17 } from './d1_s17';
import { play } from '../strategy';
import type { PlayContext } from '../strategy';

const D68_H17: Chart = { HARD: HARD_D68_H17, SOFT: SOFT_D68_H17, PAIRS: PAIRS_D68_H17 };
const D2_H17: Chart = { HARD: HARD_D2_H17, SOFT: SOFT_D2_H17, PAIRS: PAIRS_D2_H17 };
const D1_H17: Chart = { HARD: HARD_D1_H17, SOFT: SOFT_D1_H17, PAIRS: PAIRS_D1_H17 };

const ALL_BASES: { name: string; deckClass: DeckClass; chart: Chart }[] = [
  { name: 'd68 H17', deckClass: 'd68', chart: D68_H17 },
  { name: 'd68 S17', deckClass: 'd68', chart: { HARD: HARD_D68_S17, SOFT: SOFT_D68_S17, PAIRS: PAIRS_D68_S17 } },
  { name: 'd2 H17', deckClass: 'd2', chart: D2_H17 },
  { name: 'd2 S17', deckClass: 'd2', chart: { HARD: HARD_D2_S17, SOFT: SOFT_D2_S17, PAIRS: PAIRS_D2_S17 } },
  { name: 'd1 H17', deckClass: 'd1', chart: D1_H17 },
  { name: 'd1 S17', deckClass: 'd1', chart: { HARD: HARD_D1_S17, SOFT: SOFT_D1_S17, PAIRS: PAIRS_D1_S17 } },
];

const VALID_CELLS = new Set(['H', 'S', 'Dh', 'Ds', 'P', 'Rh', 'Rs', 'Rp']);

function deepCloneChart(chart: Chart): Chart {
  return JSON.parse(JSON.stringify(chart));
}

describe('resolveDas', () => {
  describe('d68: das:false collapses Ph pairs to H', () => {
    it('2,2 v 2 -> H', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['2']![0]).toBe('H');
    });
    it('3,3 v 2 -> H', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['3']![0]).toBe('H');
    });
    it('6,6 v 2 -> H', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['6']![0]).toBe('H');
    });
    it('4,4 v 5 -> H', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['4']![3]).toBe('H');
    });
    it('4,4 v 6 -> H', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['4']![4]).toBe('H');
    });
  });

  describe('d68: das:true resolves those same cells to P', () => {
    it('2,2 v 2 -> P', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['2']![0]).toBe('P');
    });
    it('3,3 v 2 -> P', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['3']![0]).toBe('P');
    });
    it('6,6 v 2 -> P', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['6']![0]).toBe('P');
    });
    it('4,4 v 5 -> P', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['4']![3]).toBe('P');
    });
    it('4,4 v 6 -> P', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['4']![4]).toBe('P');
    });
  });

  describe('d1: das:false resolves Pd -> Dh and Ps -> S', () => {
    it('4,4 v 5 (Pd) -> Dh', () => {
      expect(resolveDas(D1_H17, false, 'd1').PAIRS['4']![3]).toBe('Dh');
    });
    it('4,4 v 6 (Pd) -> Dh', () => {
      expect(resolveDas(D1_H17, false, 'd1').PAIRS['4']![4]).toBe('Dh');
    });
    it('9,9 v A (Ps) -> S', () => {
      expect(resolveDas(D1_H17, false, 'd1').PAIRS['9']![9]).toBe('S');
    });
  });

  describe('d1: das:true resolves the same Pd/Ps cells to P', () => {
    it('4,4 v 5 -> P', () => {
      expect(resolveDas(D1_H17, true, 'd1').PAIRS['4']![3]).toBe('P');
    });
    it('4,4 v 6 -> P', () => {
      expect(resolveDas(D1_H17, true, 'd1').PAIRS['4']![4]).toBe('P');
    });
    it('9,9 v A -> P', () => {
      expect(resolveDas(D1_H17, true, 'd1').PAIRS['9']![9]).toBe('P');
    });
  });

  describe('2D Rp legend: DAS on -> split; DAS off -> stays Rp', () => {
    it('das:true -> 8,8 v A = P', () => {
      expect(resolveDas(D2_H17, true, 'd2').PAIRS['8']![9]).toBe('P');
    });
    it('das:false -> 8,8 v A = Rp (unresolved -- runtime handles surrender-else-split)', () => {
      expect(resolveDas(D2_H17, false, 'd2').PAIRS['8']![9]).toBe('Rp');
    });
  });

  describe('d68 Rp is unconditional: DAS never resolves it', () => {
    it('das:true -> 8,8 v A stays Rp', () => {
      expect(resolveDas(D68_H17, true, 'd68').PAIRS['8']![9]).toBe('Rp');
    });
    it('das:false -> 8,8 v A stays Rp', () => {
      expect(resolveDas(D68_H17, false, 'd68').PAIRS['8']![9]).toBe('Rp');
    });
  });

  it('does not mutate the input chart (purity)', () => {
    const before = deepCloneChart(D68_H17);
    resolveDas(D68_H17, true, 'd68');
    resolveDas(D68_H17, false, 'd68');
    expect(D68_H17).toEqual(before);
  });
});

describe('stripLs', () => {
  it('ls:false maps Rh -> H (16 v 10, d68_h17)', () => {
    expect(stripLs(D68_H17, false).HARD[16][8]).toBe('H');
  });

  it('ls:false maps Rs -> S (17 v A, d68_h17)', () => {
    expect(stripLs(D68_H17, false).HARD[17][9]).toBe('S');
  });

  it('ls:false maps Rp -> P (8,8 v A, d68_h17)', () => {
    expect(stripLs(D68_H17, false).PAIRS['8']![9]).toBe('P');
  });

  it('ls:true leaves the chart unchanged', () => {
    expect(stripLs(D68_H17, true).HARD[16][8]).toBe('Rh');
    expect(stripLs(D68_H17, true).HARD[17][9]).toBe('Rs');
    expect(stripLs(D68_H17, true).PAIRS['8']![9]).toBe('Rp');
  });

  it('does not mutate the input chart (purity)', () => {
    const before = deepCloneChart(D68_H17);
    stripLs(D68_H17, false);
    stripLs(D68_H17, true);
    expect(D68_H17).toEqual(before);
  });
});

describe('full matrix sanity: every assembled cell is a valid final action', () => {
  for (const { name, deckClass, chart } of ALL_BASES) {
    for (const das of [true, false]) {
      for (const ls of [true, false]) {
        it(`${name} das:${das} ls:${ls} -> all cells in {H,S,Dh,Ds,P,Rh,Rs,Rp}`, () => {
          const assembled = stripLs(resolveDas(chart, das, deckClass), ls);
          const offenders: string[] = [];
          for (const [total, row] of Object.entries(assembled.HARD)) {
            row.forEach((cell, i) => {
              if (!VALID_CELLS.has(cell)) offenders.push(`HARD[${total}][${i}]=${cell}`);
            });
          }
          for (const [total, row] of Object.entries(assembled.SOFT)) {
            row.forEach((cell, i) => {
              if (!VALID_CELLS.has(cell)) offenders.push(`SOFT[${total}][${i}]=${cell}`);
            });
          }
          for (const [rank, row] of Object.entries(assembled.PAIRS)) {
            row!.forEach((cell, i) => {
              if (!VALID_CELLS.has(cell)) offenders.push(`PAIRS[${rank}][${i}]=${cell}`);
            });
          }
          expect(offenders).toEqual([]);
        });
      }
    }
  }
});

describe('assertFullyResolved (assembly-time guard)', () => {
  it('does not throw for a fully-resolved chart', () => {
    const resolved = stripLs(resolveDas(D1_H17, true, 'd1'), true);
    expect(() => assertFullyResolved(resolved)).not.toThrow();
  });

  it('throws when a Ph cell survives', () => {
    const bad: Chart = { HARD: {}, SOFT: {}, PAIRS: { '2': ['Ph', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'] } };
    expect(() => assertFullyResolved(bad)).toThrow(/Ph/);
  });

  it('throws when a Pd cell survives', () => {
    const bad: Chart = { HARD: {}, SOFT: {}, PAIRS: { '4': ['H', 'H', 'H', 'Pd', 'H', 'H', 'H', 'H', 'H', 'H'] } };
    expect(() => assertFullyResolved(bad)).toThrow(/Pd/);
  });

  it('getChart() never returns a chart with Ph/Pd/Ps for any registered ruleset', () => {
    for (const decks of [1, 2, 6, 8] as const) {
      for (const s17 of [true, false]) {
        for (const das of [true, false]) {
          for (const ls of [true, false]) {
            const chart = getChart({ decks, s17, das, ls, rsa: false, bj65: false });
            expect(() => assertFullyResolved(chart)).not.toThrow();
          }
        }
      }
    }
  });
});

function cards(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

describe('pinned throws: a hand-crafted chart with an unresolved conditional cell must fail loud', () => {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };

  it('strategy pair-path: a PAIRS cell of "Ph" throws (rank 2, not the hardcoded 8,8vA special case)', () => {
    const chart: Chart = {
      HARD: HARD_D68_H17,
      SOFT: SOFT_D68_H17,
      PAIRS: { '2': ['Ph', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'] },
    };
    expect(() => play(cards('2', '2'), '2', 0, ctx, [], chart)).toThrow(/Ph/);
  });

  it('strategy resolveAsTotal: a HARD cell of "Ph" (non-pair hand) throws', () => {
    const chart: Chart = {
      HARD: { ...HARD_D68_H17, 12: ['Ph', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'] },
      SOFT: SOFT_D68_H17,
      PAIRS: {},
    };
    // (10,2) = hard 12, not a pair -> goes straight to resolveAsTotal.
    expect(() => play(cards('10', '2'), '2', 0, ctx, [], chart)).toThrow(/Ph/);
  });
});
