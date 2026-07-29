import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { runningCountThrough, makeCountDrill } from './countDrill';

/** Builds a minimal Card for a given rank -- suit is irrelevant to hiLoTag. */
function card(rank: Rank): Card {
  return { rank, suit: 's' };
}

describe('runningCountThrough', () => {
  it('sums hiLoTag over every card in groups[0..uptoIndex] inclusive', () => {
    // group 0: 2,3 (+1,+1) -- group 1: K (-1) -- group 2: 7 (0)
    const groups: Card[][] = [[card('2'), card('3')], [card('K')], [card('7')]];
    expect(runningCountThrough(groups, 0)).toBe(2); // just group 0
    expect(runningCountThrough(groups, 1)).toBe(1); // groups 0+1
    expect(runningCountThrough(groups, 2)).toBe(1); // groups 0+1+2 (+0 from the 7)
  });

  it('matches a plain reduce over the same cards (anti-drift against hiLoTag)', () => {
    const groups: Card[][] = [
      [card('A'), card('5')],
      [card('9')],
      [card('10'), card('4'), card('Q')],
    ];
    for (let upto = 0; upto < groups.length; upto++) {
      const expected = groups
        .slice(0, upto + 1)
        .flat()
        .reduce((sum, c) => sum + hiLoTag(c.rank), 0);
      expect(runningCountThrough(groups, upto)).toBe(expected);
    }
  });

  it('is 0 for an index before any cards (uptoIndex -1, an empty sum)', () => {
    const groups: Card[][] = [[card('K')]];
    expect(runningCountThrough(groups, -1)).toBe(0);
  });

  it('clamps safely when uptoIndex is beyond the groups array (never throws, sums what exists)', () => {
    const groups: Card[][] = [[card('2')], [card('3')]];
    expect(runningCountThrough(groups, 10)).toBe(2);
  });

  it('is 0 for an empty groups array regardless of uptoIndex', () => {
    expect(runningCountThrough([], 5)).toBe(0);
  });
});

describe('makeCountDrill bias (R8/CM#1 — adversarial same-sign clustering)', () => {
  const tagsOf = (round: { groups: Card[][] }) => round.groups.flat().map((c) => hiLoTag(c.rank));

  it("bias 'none' is unbiased and deterministic for a seed (unchanged default behavior)", () => {
    const a = makeCountDrill(52, 1, 7);
    const b = makeCountDrill(52, 1, 7, 'none');
    expect(tagsOf(b)).toEqual(tagsOf(a)); // omitting bias === passing 'none'
    // A random shoe interleaves signs: a −1 appears somewhere after a +1.
    const tags = tagsOf(a);
    const firstPos = tags.indexOf(1);
    const lastNeg = tags.lastIndexOf(-1);
    expect(firstPos).toBeGreaterThanOrEqual(0);
    expect(lastNeg).toBeGreaterThan(firstPos); // signs are interleaved, not clustered
  });

  it("bias 'negative' front-loads every negative-tag card ahead of every positive-tag card (count dives, then climbs)", () => {
    const tags = tagsOf(makeCountDrill(52, 1, 7, 'negative'));
    const lastNeg = tags.lastIndexOf(-1);
    const firstPos = tags.indexOf(1);
    expect(lastNeg).toBeGreaterThanOrEqual(0);
    expect(firstPos).toBeGreaterThan(lastNeg); // all −1s precede all +1s
    // The running count reaches its global minimum before recovering upward.
    let rc = 0;
    let min = 0;
    let minIdx = 0;
    tags.forEach((t, i) => {
      rc += t;
      if (rc < min) {
        min = rc;
        minIdx = i;
      }
    });
    expect(min).toBeLessThan(0);
    expect(minIdx).toBeGreaterThan(0);
  });

  it("bias 'positive' front-loads every positive-tag card ahead of every negative-tag card", () => {
    const tags = tagsOf(makeCountDrill(52, 1, 7, 'positive'));
    const lastPos = tags.lastIndexOf(1);
    const firstNeg = tags.indexOf(-1);
    expect(lastPos).toBeGreaterThanOrEqual(0);
    expect(firstNeg).toBeGreaterThan(lastPos); // all +1s precede all −1s
  });

  it('bias preserves the multiset: same finalRc and card count as the unbiased shoe (same journey endpoint, harder path)', () => {
    const plain = makeCountDrill(52, 1, 7);
    for (const bias of ['negative', 'positive'] as const) {
      const biased = makeCountDrill(52, 1, 7, bias);
      expect(biased.finalRc).toBe(plain.finalRc); // order-independent sum
      expect(biased.groups.flat()).toHaveLength(plain.groups.flat().length);
      // Same multiset of tags, just reordered.
      const sorted = (r: { groups: Card[][] }) => tagsOf(r).slice().sort();
      expect(sorted(biased)).toEqual(sorted(plain));
    }
  });
});
