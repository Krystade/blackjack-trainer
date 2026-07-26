import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { runningCountThrough } from './countDrill';

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
