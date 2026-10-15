import { describe, expect, it } from 'vitest';
import { hiLoTag } from '../engine/count';
import { cardsInRound, makeCountTable, tableRounds, tableShoeDecks } from './countTable';

describe('makeCountTable (#47)', () => {
  it('deals the asked rounds with table-shaped hands', () => {
    const run = makeCountTable(200, 7);
    expect(run.rounds).toHaveLength(200);
    const seatCounts = new Set<number>();
    const dealerSizes = new Set<number>();
    const handSizes = new Set<number>();
    for (const r of run.rounds) {
      expect(r.players.length).toBeGreaterThanOrEqual(1);
      expect(r.players.length).toBeLessThanOrEqual(6);
      expect(r.dealer.length).toBeGreaterThanOrEqual(2);
      expect(r.dealer.length).toBeLessThanOrEqual(6);
      seatCounts.add(r.players.length);
      dealerSizes.add(r.dealer.length);
      for (const h of r.players) {
        expect([2, 3]).toContain(h.length);
        handSizes.add(h.length);
      }
    }
    expect(seatCounts.size).toBe(6);
    expect(dealerSizes.size).toBe(5);
    expect(handSizes.size).toBe(2);
  });

  it('one group per round holding exactly that round\'s cards, and the count is their sum', () => {
    const run = makeCountTable(10, 42);
    expect(run.groups).toHaveLength(10);
    run.rounds.forEach((r, i) => expect(run.groups[i]).toHaveLength(cardsInRound(r)));
    const sum = run.groups.flat().reduce((s, c) => s + hiLoTag(c.rank), 0);
    expect(run.finalRc).toBe(sum);
  });

  it('is a real shoe: no card appears more often than the shoe holds', () => {
    expect(tableShoeDecks(10)).toBe(6);
    const run = makeCountTable(10, 3);
    const seen = new Map<string, number>();
    for (const c of run.groups.flat()) seen.set(c.rank + c.suit, (seen.get(c.rank + c.suit) ?? 0) + 1);
    for (const n of seen.values()) expect(n).toBeLessThanOrEqual(6);
  });

  it('is seeded', () => {
    expect(makeCountTable(5, 9)).toEqual(makeCountTable(5, 9));
    expect(makeCountTable(5, 9)).not.toEqual(makeCountTable(5, 10));
  });

  it('reads the rounds setting with a default of 10', () => {
    expect(tableRounds(undefined)).toBe(10);
    expect(tableRounds(5)).toBe(5);
    expect(tableRounds(20)).toBe(20);
    expect(tableRounds(7)).toBe(10);
  });
});
