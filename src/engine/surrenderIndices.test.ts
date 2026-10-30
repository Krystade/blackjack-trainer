import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { correctPlay, basicPlay } from './strategy';
import { classifyAction } from './grade';
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
  for (const decks of [6, 8] as const) {
    for (const s17 of [false, true]) {
      const rules: StrategyRules = { ...DEFAULT_RULES, decks, s17, surrenderIndices: true };
      const label = `${decks}D ${s17 ? 'S17' : 'H17'}`;
      it(`${label}: no surrender-indexed cell is an Rs cell`, () => {
        const chart = getChart(rules);
        const indexed = indexSetFor(rules).filter((d) => d.kind === 'surrender');
        expect(indexed.length).toBeGreaterThan(0); // vacuity guard
        for (const dev of indexed) {
          const idx = upIndex(dev.up!);
          expect(chart.HARD[dev.total!]?.[idx]).not.toBe('Rs');
          // C1: a pair that does not split plays as its hard total
          // (pairTotalIndex), so 7,7 v 10 is a 14 v 10 cell too.
          const half = dev.total! / 2;
          const pairRank = half === 10 ? '10' : String(half);
          const pairCell = (chart.PAIRS as Record<string, string[] | undefined>)[pairRank]?.[idx];
          expect(pairCell).not.toBe('Rs');
        }
      });
    }
  }
});

// C1 (audit 2026-10-29): the Fab 4 are six-deck values. The 1D/2D basic
// charts disagree with them at TC 0, so below four decks the set is absent and
// the surrender cells play the deck-class chart.
describe('single and double deck surrender by their own basic chart', () => {
  for (const decks of [1, 2] as const) {
    for (const s17 of [false, true]) {
      it(`${decks}D ${s17 ? 'S17' : 'H17'}: no surrender index even with the flag on`, () => {
        const rules: StrategyRules = { ...DEFAULT_RULES, decks, s17, surrenderIndices: true };
        expect(indexSetFor(rules).filter((d) => d.kind === 'surrender')).toEqual([]);
      });
    }
  }

  it('1D H17 and S17 hit 15 v 10 at TC 0 (the chart cell is H)', () => {
    for (const s17 of [false, true]) {
      const rules: StrategyRules = { ...DEFAULT_RULES, decks: 1, s17, surrenderIndices: true };
      expect(act(15, '10', 0, rules)).toBe('hit');
      expect(act(15, '10', 3, rules)).toBe('hit');
    }
  });

  it('1D and 2D H17 hit 16 v 9 at TC 0', () => {
    for (const decks of [1, 2] as const) {
      const rules: StrategyRules = { ...DEFAULT_RULES, decks, surrenderIndices: true };
      expect(act(16, '9', 0, rules)).toBe('hit');
    }
  });

  it('1D surrenders 7,7 v 10 at every count, as its chart prints Rs', () => {
    const rules: StrategyRules = { ...DEFAULT_RULES, decks: 1, surrenderIndices: true };
    const sevens: Card[] = [{ rank: '7', suit: 's' }, { rank: '7', suit: 'h' }];
    for (const tc of [-3, 0, 2]) {
      expect(correctPlay(sevens, '10', tc, CAN, rules).action).toBe('surrender');
    }
  });

  it('6 and 8 decks still carry the set', () => {
    for (const decks of [6, 8] as const) {
      const rules: StrategyRules = { ...DEFAULT_RULES, decks, surrenderIndices: true };
      expect(indexSetFor(rules).filter((d) => d.kind === 'surrender')).toHaveLength(6);
    }
  });
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

// C5 (audit 2026-10-29): below an index on a cell the chart surrenders, the
// play was reported as "Basic hit (surrender unavailable)" with no index, so
// the miss was a basic error and the index never heard of it.
describe('a play below a surrender index is filed under the index (C5)', () => {
  it('15 v 10 at TC −1: hit, attributed to sur15v10, and no false "unavailable"', () => {
    const advice = correctPlay(hard(15), '10', -1, CAN, H17);
    expect(advice.action).toBe('hit');
    expect(advice.source).toBe('illustrious18');
    expect(advice.deviationId).toBe('sur15v10');
    expect(advice.reason).not.toContain('unavailable');
  });

  it('surrendering there is a missed deviation on sur15v10', () => {
    const withCount = correctPlay(hard(15), '10', -1, CAN, H17);
    const basicOnly = basicPlay(hard(15), '10', CAN, H17);
    expect(classifyAction('surrender', withCount, basicOnly, hard(15), '10', -1, H17).classification).toBe('missed-deviation');
  });

  it('surrendering 16 v 8 early (TC +2, index +4) is a phantom deviation on sur16v8', () => {
    const withCount = correctPlay(hard(16), '8', 2, CAN, H17);
    const basicOnly = basicPlay(hard(16), '8', CAN, H17);
    expect(withCount.action).toBe('hit');
    expect(classifyAction('surrender', withCount, basicOnly, hard(16), '8', 2, H17)).toMatchObject({
      classification: 'phantom-deviation',
      phantomOf: 'sur16v8',
    });
  });
});

// C11: the BJA chart's "0-" on 15 v 10 means stop surrendering at any negative
// running count; with the RC known, a truncated TC 0 cannot hide it.
describe('zero-count cells read the running count when it is known (C11)', () => {
  it('15 v 10: RC -3 is below the index even at TC 0; RC 0 is at it', () => {
    expect(correctPlay(hard(15), '10', 0, CAN, H17, -3).action).toBe('hit');
    expect(correctPlay(hard(15), '10', 0, CAN, H17, 0).action).toBe('surrender');
    expect(correctPlay(hard(15), '10', 0, CAN, H17).action).toBe('surrender'); // no rc: TC as before
  });

  it('16 v 10 stands only from RC 0 up, with surrender unavailable', () => {
    expect(correctPlay(hard(16), '10', 0, CANNOT, H17_OFF, -2).action).toBe('hit');
    expect(correctPlay(hard(16), '10', 0, CANNOT, H17_OFF, 0).action).toBe('stand');
  });

  it('the cells that carry it are exactly the zero-count ones', () => {
    const ids = indexSetFor({ ...H17, bjaExtras: true }).filter((d) => d.rcSign).map((d) => d.id).sort();
    expect(ids).toEqual(['12v4', '16v10', 'A8v6', 'sur15v10']);
  });
});

// R2 (review of C11): when the running count's sign decides a zero-count
// cell against what the rounded true count says, the reason says so -- in
// running-count words -- instead of a TC rule that contradicts the TC shown.
describe('a zero-count cell decided by the running count says so (R2)', () => {
  const C = (rank: Rank): Card => ({ rank, suit: 's' });
  const RC_16 = '16 v 10: stand when the running count is 0 or more; hit at any negative running count';
  const RC_12 = '12 v 4: stand when the running count is 0 or more; hit at any negative running count';
  const RC_15 = '15 v 10: surrender when the running count is 0 or more; hit at any negative running count';
  const RC_A8 = 'A,8 v 6: double when the running count is 0 or more; stand at any negative running count';

  it('16 v 10 at TC 0 with RC -3 is a hit, and the reason names the running count', () => {
    const a = correctPlay(hard(16), '10', 0, CANNOT, H17_OFF, -3);
    expect(a.action).toBe('hit');
    expect(a.reason).toBe(RC_16);
  });

  it('12 v 4 at TC 0 with RC -3 is a hit under the index, said by the running count', () => {
    const a = correctPlay([C('10'), C('2')], '4', 0, CANNOT, H17_OFF, -3);
    expect(a).toMatchObject({ action: 'hit', deviationId: '12v4', reason: RC_12 });
  });

  it('15 v 10 surrender and A,8 v 6 double too', () => {
    expect(correctPlay(hard(15), '10', 0, CAN, H17, -2)).toMatchObject({ action: 'hit', reason: RC_15 });
    const soft19: Card[] = [C('A'), C('8')];
    const a8 = correctPlay(soft19, '6', 0, { canDouble: true, canSplit: false, canSurrender: false }, { ...H17, bjaExtras: true }, -1);
    expect(a8).toMatchObject({ action: 'stand', reason: RC_A8 });
  });

  it('where the running count agrees with the true count the reason is the index label, as before', () => {
    // RC +2 at TC 0: both readings say stand.
    expect(correctPlay(hard(16), '10', 0, CANNOT, H17_OFF, 2).reason).toBe('16 v 10: stand at TC ≥ 0');
    // Floor: RC -3 floors to TC -1, which already reads as below.
    expect(correctPlay([C('10'), C('2')], '4', -1, CANNOT, H17_OFF, -3).reason).toBe('12 v 4: stand at TC ≥ 0; hit below');
    // No running count known (the drills): the TC rule.
    expect(correctPlay(hard(16), '10', 0, CANNOT, H17_OFF).reason).toBe('16 v 10: stand at TC ≥ 0');
  });
});
