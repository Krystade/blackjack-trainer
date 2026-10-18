import { describe, it, expect } from 'vitest';
import { DEFAULT_RULES } from '../../engine/ruleset';
import { activeIndices } from './readiness';
import { indexRows } from './indexRows';
import { drillIndexDirection, playFigures } from './playStats';
import { EMPTY_STATS } from '../../store/types';
import type { Stats } from '../../store/types';

const ASKED = activeIndices(DEFAULT_RULES);

describe('E7: indexRows', () => {
  it('lists answered indexes worst first and counts the rest as not seen', () => {
    const { seen, unseen } = indexRows(
      ASKED,
      {
        '16v10': { right: 3, wrong: 1 }, // 75%
        '12v3': { right: 1, wrong: 3 }, // 25%
        ins: { right: 5, wrong: 0 }, // 100%
        '9v2': { right: 1, wrong: 1 }, // 50%
      },
      { '12v3': { early: 2, late: 1 }, '16v10': { early: 0, late: 1 } },
    );
    expect(seen.map((r) => r.id)).toEqual(['12v3', '9v2', '16v10', 'ins']);
    expect(unseen).toBe(ASKED.length - 4);
    const r = seen[0]!;
    expect(r).toMatchObject({ hand: '12 v 3', play: 'stand at TC ≥ +2', right: 1, wrong: 3, answered: 4, early: 2, late: 1 });
    expect(r.accuracy).toBeCloseTo(0.25);
    // No direction recorded reads as zero, never as a dash.
    expect(seen.find((x) => x.id === 'ins')).toMatchObject({ early: 0, late: 0 });
  });

  it('ties go to the index with more wrong answers, then set order', () => {
    // All three at 50%. 9v2 comes last in set order but has the most wrong
    // answers, so it leads; 16v10 and 12v2 tie again and keep set order.
    const order = ASKED.map((d) => d.id);
    expect(order.indexOf('16v10')).toBeLessThan(order.indexOf('12v2'));
    expect(order.indexOf('12v2')).toBeLessThan(order.indexOf('9v2'));
    const { seen } = indexRows(
      ASKED,
      { '12v2': { right: 1, wrong: 1 }, '9v2': { right: 2, wrong: 2 }, '16v10': { right: 1, wrong: 1 } },
      undefined,
    );
    expect(seen.map((r) => r.id)).toEqual(['9v2', '16v10', '12v2']);
  });

  it("adds a Play phantom's off-tally miss to the index's wrong answers", () => {
    const { seen, unseen } = indexRows(ASKED, { '16v10': { right: 2, wrong: 0 } }, {
      '16v10': { early: 2, late: 0, offTally: 2 },
      '12v3': { early: 1, late: 0, offTally: 1 },
    });
    expect(seen.find((r) => r.id === '16v10')).toMatchObject({ right: 2, wrong: 2, answered: 4, early: 2 });
    // An index seen only as a phantom at the table is seen, at 0%.
    expect(seen[0]).toMatchObject({ id: '12v3', right: 0, wrong: 1, accuracy: 0, early: 1 });
    expect(unseen).toBe(ASKED.length - 2);
  });

  it('only asked indexes appear, and a hand-edited blob cannot produce NaN', () => {
    const { seen, unseen } = indexRows(
      ASKED,
      {
        '11vA': { right: 9, wrong: 9 },
        '16v10': { right: 'x' as unknown as number, wrong: 2 },
        '12v3': { right: -4, wrong: '1' as unknown as number },
      },
      { '16v10': { early: null as unknown as number, late: 1 } },
    );
    expect(seen.map((r) => r.id)).toEqual(['16v10']);
    expect(seen[0]).toMatchObject({ right: 0, wrong: 2, early: 0, late: 1, accuracy: 0 });
    // A negative or non-number count is no answer at all, so 12v3 is unseen.
    expect(unseen).toBe(ASKED.length - 1);
  });
});

describe('E7: the Play and drill slices of the direction tally', () => {
  it('Play reads the table slice; the drills read pooled minus table', () => {
    const s: Stats = {
      ...structuredClone(EMPTY_STATS),
      indexDirection: { '16v10': { early: 3, late: 2, offTally: 1 }, '12v3': { early: 1, late: 0 } },
      tableIndexDirection: { '16v10': { early: 1, late: 2, offTally: 1 } },
    };
    expect(playFigures(s).indexDirection).toEqual({ '16v10': { early: 1, late: 2, offTally: 1 } });
    expect(drillIndexDirection(s)).toEqual({ '16v10': { early: 2, late: 0 }, '12v3': { early: 1, late: 0 } });
    expect(drillIndexDirection(EMPTY_STATS)).toEqual({});
  });
});
