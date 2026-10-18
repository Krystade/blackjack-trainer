import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { makeCountDrill, makeCountdown, runningCountThrough } from './countDrill';
import { countRunRows } from './countRun';

const c = (rank: Rank): Card => ({ rank, suit: 's' });

describe('countRunRows (E5)', () => {
  it('one row per card, each with its tag and the running count after it', () => {
    const rows = countRunRows([[c('K')], [c('5')], [c('8')], [c('2')], [c('A')]]);
    expect(rows.map((r) => [r.n, r.tag, r.total])).toEqual([
      [1, -1, -1],
      [2, 1, 0],
      [3, 0, 0],
      [4, 1, 1],
      [5, -1, 0],
    ]);
  });

  it('a group row carries the group net tag', () => {
    const rows = countRunRows([[c('2'), c('3'), c('K')], [c('10'), c('J')]]);
    expect(rows.map((r) => [r.cards.length, r.tag, r.total])).toEqual([
      [3, 1, 1],
      [2, -2, -1],
    ]);
  });

  it('over 200 seeded 52-card runs the tags sum to the final count, which is the last total', () => {
    for (let seed = 0; seed < 200; seed++) {
      const round = makeCountDrill(52, 1, seed, 'none');
      const rows = countRunRows(round.groups);
      expect(rows).toHaveLength(52);
      expect(rows.reduce((s, r) => s + r.tag, 0)).toBe(round.finalRc);
      expect(rows.at(-1)!.total).toBe(round.finalRc);
      rows.forEach((r, i) => expect(r.total).toBe(runningCountThrough(round.groups, i)));
    }
  });

  it('marks the checkpoint on the row it was asked after, against that row total', () => {
    const groups = [[c('5')], [c('6')], [c('K')], [c('3')]];
    const rows = countRunRows(groups, [
      { atGroup: 1, answer: 2 },
      { atGroup: 2, answer: 3 },
    ]);
    expect(rows.map((r) => r.checkpoint ?? null)).toEqual([
      null,
      { said: 2, was: 2, right: true },
      { said: 3, was: 1, right: false },
      null,
    ]);
  });

  it("Countdown's hidden card closes the deck at zero", () => {
    for (let seed = 0; seed < 50; seed++) {
      const round = makeCountdown(seed);
      const rows = countRunRows(
        round.shown.map((card) => [card]),
        [],
        round.hidden,
      );
      expect(rows).toHaveLength(52);
      expect(rows.at(-1)!.hidden).toBe(true);
      expect(rows.at(-1)!.tag).toBe(hiLoTag(round.hidden.rank));
      expect(rows.at(-1)!.total).toBe(0);
      expect(rows.at(-2)!.total + hiLoTag(round.hidden.rank)).toBe(0);
    }
  });
});
