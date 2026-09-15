import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { correctPlay } from './strategy';
import type { PlayContext } from './strategy';
import { indexSetFor, FAB_4_H17, FAB_4_S17 } from './deviations';
import { getChart } from './charts';
import { upIndex } from './basicStrategy';
import { DEFAULT_RULES } from './ruleset';
import type { StrategyRules } from './ruleset';

// H17 six-deck with late surrender -- DEFAULT_RULES already is exactly that.
const H17: StrategyRules = { ...DEFAULT_RULES, surrenderIndices: true };
const H17_OFF: StrategyRules = { ...DEFAULT_RULES };
const S17: StrategyRules = { ...DEFAULT_RULES, s17: true, surrenderIndices: true };

const CAN: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
const CANNOT: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };

/** A hard total built from two non-pair, non-ace cards. */
function hard(total: number): [Card, Card] {
  const lo = Math.floor(total / 2) - 1;
  const hi = total - lo;
  expect(lo).not.toBe(hi); // never a pair -- the PAIRS table must not be consulted
  const name = (n: number): Rank => (n === 10 ? '10' : (String(n) as Rank));
  return [
    { rank: name(lo), suit: 's' },
    { rank: name(hi), suit: 'h' },
  ];
}

function act(total: number, up: Rank, tc: number, rules: StrategyRules, ctx: PlayContext = CAN): string {
  return correctPlay(hard(total), up, tc, ctx, rules).action;
}

describe('the index set only grows when the profile asks', () => {
  it('is the plain Illustrious 18 with the flag off', () => {
    const set = indexSetFor(DEFAULT_RULES);
    expect(set.filter((d) => d.kind === 'surrender')).toEqual([]);
  });

  it('adds six surrender indices under H17', () => {
    const set = indexSetFor(H17).filter((d) => d.kind === 'surrender');
    expect(set.map((d) => d.id).sort()).toEqual(
      ['sur14v10', 'sur15v10', 'sur15v9', 'sur15vA', 'sur16v8', 'sur16v9'].sort(),
    );
  });

  it('adds only FOUR under S17 -- 16 v 8 and 16 v 9 have no S17 source', () => {
    const ids = indexSetFor(S17)
      .filter((d) => d.kind === 'surrender')
      .map((d) => d.id);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain('sur16v8');
    expect(ids).not.toContain('sur16v9');
  });

  it('leaves the eighteen hard/insurance indices untouched either way', () => {
    const off = indexSetFor(DEFAULT_RULES);
    const on = indexSetFor(H17).filter((d) => d.kind !== 'surrender');
    expect(on).toEqual(off);
  });
});

// The single most important property in the feature. The BJA chart prints some
// of these cells with a trailing `-`, which reads as an `lte` threshold and is
// not one; transcribing it literally inverts the cell. See
// docs/sources/verified-surrender-indices.md §1.
describe('every surrender index reads "surrender at TC >= index"', () => {
  for (const dev of [...FAB_4_H17, ...FAB_4_S17]) {
    it(`${dev.id} is gte, not lte`, () => {
      expect(dev.dir).toBe('gte');
    });
  }
});

describe('an index ADDS surrender where basic strategy hits', () => {
  it('16 v 8 hits below +4 and surrenders at +4', () => {
    expect(act(16, '8', 3, H17)).toBe('hit');
    expect(act(16, '8', 4, H17)).toBe('surrender');
  });

  it('15 v 9 hits below +2 and surrenders at +2', () => {
    expect(act(15, '9', 1, H17)).toBe('hit');
    expect(act(15, '9', 2, H17)).toBe('surrender');
  });

  it('14 v 10 hits below +3 and surrenders at +3', () => {
    expect(act(14, '10', 2, H17)).toBe('hit');
    expect(act(14, '10', 3, H17)).toBe('surrender');
  });

  it('none of them surrender with the flag off, at any count', () => {
    for (const tc of [-5, 0, 3, 4, 10]) {
      expect(act(16, '8', tc, H17_OFF)).toBe('hit');
      expect(act(15, '9', tc, H17_OFF)).toBe('hit');
      expect(act(14, '10', tc, H17_OFF)).toBe('hit');
    }
  });
});

describe('an index REMOVES surrender where basic strategy surrenders', () => {
  it('15 v 10 surrenders at 0 and above, and hits below', () => {
    expect(act(15, '10', -1, H17)).toBe('hit');
    expect(act(15, '10', 0, H17)).toBe('surrender');
  });

  it('16 v 9 surrenders at 0 and above, and hits below', () => {
    expect(act(16, '9', -1, H17)).toBe('hit');
    expect(act(16, '9', 0, H17)).toBe('surrender');
  });

  // This is the half the feature would silently lose if the new logic were
  // bolted on as another step-3 deviation: step 3 can only ADD a play.
  it('with the flag off, both surrender at every count including deeply negative', () => {
    for (const tc of [-10, -3, -1, 0, 5]) {
      expect(act(15, '10', tc, H17_OFF)).toBe('surrender');
      expect(act(16, '9', tc, H17_OFF)).toBe('surrender');
    }
  });
});

describe('cells with no index keep surrendering unconditionally', () => {
  for (const tc of [-8, -1, 0, 6]) {
    it(`16 v 10 surrenders at TC ${tc}`, () => {
      expect(act(16, '10', tc, H17)).toBe('surrender');
    });
    it(`16 v A surrenders at TC ${tc}`, () => {
      expect(act(16, 'A', tc, H17)).toBe('surrender');
    });
    it(`17 v A surrenders at TC ${tc} under H17`, () => {
      expect(act(17, 'A', tc, H17)).toBe('surrender');
    });
  }
});

describe('15 v A moves by two counts between rulesets, in the expected direction', () => {
  it('H17 surrenders from −1 up', () => {
    expect(act(15, 'A', -2, H17)).toBe('hit');
    expect(act(15, 'A', -1, H17)).toBe('surrender');
  });

  it('S17 surrenders only from +1 up', () => {
    expect(act(15, 'A', 0, S17)).toBe('hit');
    expect(act(15, 'A', 1, S17)).toBe('surrender');
  });
});

describe('S17 leaves its two unsourced cells on basic strategy', () => {
  it('16 v 9 surrenders at every count (basic), not at an index', () => {
    for (const tc of [-6, 0, 6]) expect(act(16, '9', tc, S17)).toBe('surrender');
  });

  it('16 v 8 hits at every count, including where the H17 index would fire', () => {
    for (const tc of [-6, 0, 4, 6]) expect(act(16, '8', tc, S17)).toBe('hit');
  });
});

describe('the rest of the engine still gets its say', () => {
  // Below its surrender index the cell falls THROUGH rather than returning, so
  // a hard-total index on the same cell is still reachable. 16 v 9 carries both
  // a surrender index (0) and a STAND index (+4 under H17).
  it('16 v 9 with surrender unavailable still stands at the +4 stand index', () => {
    expect(act(16, '9', 4, H17, CANNOT)).toBe('stand');
    expect(act(16, '9', 3, H17, CANNOT)).toBe('hit');
  });

  it('a table with no late surrender never surrenders, indices or not', () => {
    for (const tc of [-5, 0, 4, 9]) {
      expect(act(16, '8', tc, H17, CANNOT)).not.toBe('surrender');
      expect(act(15, '10', tc, H17, CANNOT)).not.toBe('surrender');
    }
  });

  it('soft totals are untouched -- A,4 (soft 15) vs 10 never surrenders', () => {
    const soft15: [Card, Card] = [
      { rank: 'A', suit: 's' },
      { rank: '4', suit: 'h' },
    ];
    for (const tc of [-4, 0, 4]) {
      expect(correctPlay(soft15, '10', tc, CAN, H17).action).toBe('hit');
    }
  });
});

// Why this exists: in resolveAsTotal, a cell below its surrender index falls
// THROUGH to the chart rather than returning a hit. That distinction is
// currently invisible -- every surrender-indexed cell is `Rh` or `H` in all six
// charts, and `Rh` resolves to hit anyway -- so no behavioural test can catch a
// regression there. What CAN be caught is the data changing underneath it: the
// day a surrender index lands on an `Rs` cell, the fall-through starts mattering
// (it must resolve to STAND, not hit) and this test fires to say so.
describe('the invariant that makes the fall-through unobservable still holds', () => {
  for (const decks of [1, 2, 6] as const) {
    for (const s17 of [false, true]) {
      const rules: StrategyRules = { ...DEFAULT_RULES, decks, s17, surrenderIndices: true };
      const label = `${decks}D ${s17 ? 'S17' : 'H17'}`;
      it(`${label}: no surrender-indexed cell is an Rs cell`, () => {
        const chart = getChart(rules);
        const indexed = indexSetFor(rules).filter((d) => d.kind === 'surrender');
        expect(indexed.length).toBeGreaterThan(0); // vacuity guard
        for (const dev of indexed) {
          expect(chart.HARD[dev.total!]?.[upIndex(dev.up!)]).not.toBe('Rs');
        }
      });
    }
  }
});

describe('the advice is attributed to the index, not to basic strategy', () => {
  it('names the deviation that fired', () => {
    const advice = correctPlay(hard(16), '8', 4, CAN, H17);
    expect(advice.source).toBe('illustrious18');
    expect(advice.deviationId).toBe('sur16v8');
    expect(advice.reason).toContain('16 v 8');
  });

  it('still says basic on an unindexed surrender', () => {
    const advice = correctPlay(hard(16), '10', 0, CAN, H17);
    expect(advice.source).toBe('basic');
  });
});
