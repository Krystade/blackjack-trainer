import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { handValue, isBlackjack, isBust } from '../engine/hand';
import { DEFAULT_RULES, type RuleSet } from '../engine/ruleset';
import { basicPlay } from '../engine/strategy';
import { cardsInRound, makeCountTable, tableRounds, tableShoeDecks } from './countTable';

describe('makeCountTable (#47)', () => {
  it('deals the asked rounds, every table shape turning up', () => {
    const run = makeCountTable(200, 7);
    expect(run.rounds).toHaveLength(200);
    const seatCounts = new Set<number>();
    const dealerSizes = new Set<number>();
    const handSizes = new Set<number>();
    for (const r of run.rounds) {
      seatCounts.add(r.players.length);
      dealerSizes.add(Math.min(r.dealer.length, 5));
      for (const h of r.players) handSizes.add(Math.min(h.length, 4));
    }
    expect([...seatCounts].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    // Dealer: 2 (stood, or a natural), 3, 4, 5 and more.
    expect([...dealerSizes].sort()).toEqual([2, 3, 4, 5]);
    // Players: 2 (stood), 3 (a hit or a double), 4 and more.
    expect([...handSizes].sort()).toEqual([2, 3, 4]);
  });

  // Wave X review: dealt card by card, a dealer hitting a hard 20 read as fake.
  for (const s17 of [true, false]) {
    it(`every hand is played as at a real table: players by basic strategy, the dealer by the rules (${s17 ? 'S17' : 'H17'})`, () => {
      const rules: RuleSet = { ...DEFAULT_RULES, s17 };
      const play: RuleSet = { ...rules, decks: 6 };
      const hits = (cards: Card[]) => {
        const hv = handValue(cards);
        return hv.total < 17 || (hv.total === 17 && hv.soft && !s17);
      };
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const r of makeCountTable(40, seed, rules).rounds) {
          const up = r.dealer[0]!.rank;
          if (isBlackjack(r.dealer)) {
            // The peek ends the round: nobody plays, the dealer draws nothing.
            for (const h of r.players) expect(h).toHaveLength(2);
            expect(r.dealer).toHaveLength(2);
            continue;
          }
          let live = false;
          for (const h of r.players) {
            if (isBlackjack(h)) continue;
            // Each card past the second was asked for; the hand stopped where
            // basic strategy stops, or on a bust, or after its one double card.
            for (let n = 2; n < h.length; n++) {
              const advice = basicPlay(h.slice(0, n), up, { canDouble: n === 2, canSplit: false, canSurrender: rules.ls && n === 2 }, play).action;
              expect(['hit', 'double'], `${h.map((c) => c.rank)} v ${up} at ${n}`).toContain(advice);
              if (advice === 'double') expect(h).toHaveLength(3);
            }
            const doubled = h.length === 3 && basicPlay(h.slice(0, 2), up, { canDouble: true, canSplit: false, canSurrender: rules.ls }, play).action === 'double';
            if (!isBust(h) && !doubled) {
              const last = basicPlay(h, up, { canDouble: h.length === 2, canSplit: false, canSurrender: rules.ls && h.length === 2 }, play).action;
              expect(['stand', 'surrender'], `${h.map((c) => c.rank)} v ${up} stopped`).toContain(last);
            }
            const surrendered = h.length === 2 && basicPlay(h, up, { canDouble: true, canSplit: false, canSurrender: rules.ls }, play).action === 'surrender';
            if (!isBust(h) && !surrendered) live = true;
          }
          // The dealer draws while the rules say hit -- and only for a live hand.
          for (let n = 2; n < r.dealer.length; n++) expect(hits(r.dealer.slice(0, n)), `dealer ${r.dealer.map((c) => c.rank)}`).toBe(true);
          if (live) expect(hits(r.dealer), `dealer ${r.dealer.map((c) => c.rank)} stopped early`).toBe(false);
          else expect(r.dealer).toHaveLength(2);
        }
      }
    });
  }

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
