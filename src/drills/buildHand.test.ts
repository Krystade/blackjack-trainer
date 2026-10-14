import { describe, it, expect } from 'vitest';
import { hardCompositions, makeHardHand, pickComposition, rankPairsForTotal } from './buildHand';
import { mulberry32 } from '../engine/cards';
import { handValue } from '../engine/hand';
import { correctPlay } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';

// The other shipped chart. There is no exported S17 preset, so it is built
// here from DEFAULT_RULES -- and it matters that it is a REAL second chart:
// running the property against one ruleset twice would prove half as much.
const S17_RULES = { ...DEFAULT_RULES, s17: true };
import type { Rank } from '../engine/cards';

const UPS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const TOTALS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

describe('hardCompositions', () => {
  it('every composition really is that hard total', () => {
    for (const total of TOTALS) {
      const options = hardCompositions(total);
      expect(options.length, `no composition for ${total}`).toBeGreaterThan(0);
      for (const cards of options) {
        const v = handValue(cards);
        expect(v.total, `${cards[0].rank}+${cards[1].rank}`).toBe(total);
        expect(v.soft).toBe(false);
      }
    }
  });

  it('never an ace and never a pair -- those are other cells', () => {
    for (const total of TOTALS) {
      for (const [a, b] of hardCompositions(total)) {
        expect(a.rank).not.toBe('A');
        expect(b.rank).not.toBe('A');
        // Equal VALUES are a pair cell, which also rules out 10+J.
        expect(handValue([a]).total).not.toBe(handValue([b]).total);
      }
    }
  });

  it('lists each unordered pair once', () => {
    for (const total of TOTALS) {
      const seen = hardCompositions(total).map(([a, b]) => `${a.rank}+${b.rank}`);
      expect(new Set(seen).size).toBe(seen.length);
      // 6+10 and 10+6 are the same hand; only one may appear.
      for (const [a, b] of hardCompositions(total)) {
        expect(seen).not.toContain(`${b.rank}+${a.rank}`);
      }
    }
  });

  it('includes the face cards, which have to read as tens at speed', () => {
    const sixteen = hardCompositions(16).map(([a, b]) => `${a.rank}+${b.rank}`);
    expect(sixteen).toContain('6+10');
    expect(sixteen).toContain('6+J');
    expect(sixteen).toContain('6+Q');
    expect(sixteen).toContain('6+K');
    expect(sixteen).toContain('7+9');
  });

  it('4 and 20 exist only as pairs, so they have no hard composition', () => {
    expect(hardCompositions(4)).toEqual([]);
    expect(hardCompositions(20)).toEqual([]);
    expect(makeHardHand(4)).toBeNull();
    expect(makeHardHand(20)).toBeNull();
  });
});

describe('makeHardHand', () => {
  it('without an rng it is the old fixed hand, unchanged', () => {
    // Every existing caller and test depends on this.
    expect(makeHardHand(16)).toEqual([
      { rank: '6', suit: 's' },
      { rank: '10', suit: 'h' },
    ]);
    expect(makeHardHand(12)).toEqual([
      { rank: '2', suit: 's' },
      { rank: '10', suit: 'h' },
    ]);
  });

  it('with an rng the composition actually varies', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      // Order is cosmetic (#18), so the shape is the sorted ranks.
      const [a, b] = makeHardHand(16, mulberry32(seed))!;
      seen.add([a.rank, b.rank].sort().join('+'));
    }
    // Vacuity guard: a broken rng path would give exactly one.
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(hardCompositions(16).length);
  });

  it('is deterministic in the seed', () => {
    expect(makeHardHand(15, mulberry32(9))).toEqual(makeHardHand(15, mulberry32(9)));
  });

  /**
   * THE SAFETY PROPERTY the whole change rests on: for a two-card hard hand,
   * basic strategy is a function of the total, so swapping the composition can
   * never change the right answer. Asserted rather than assumed -- if a
   * composition-dependent rule is ever added to the chart, this fails loudly
   * instead of the drill quietly grading a correct answer wrong.
   */
  it('every composition of a total grades to the same action', () => {
    for (const rules of [DEFAULT_RULES, S17_RULES]) {
      for (const total of TOTALS) {
        for (const up of UPS) {
          for (const tc of [-3, 0, 3, 6]) {
            const actions = hardCompositions(total).map(
              (cards) =>
                correctPlay(cards, up, tc, { canDouble: true, canSplit: false, canSurrender: true }, rules)
                  .action,
            );
            expect(new Set(actions).size, `${total} v ${up} tc ${tc}`).toBe(1);
          }
        }
      }
    }
  });
});

describe('pickComposition (#18)', () => {
  const shapeOf = (cards: [{ rank: string }, { rank: string }]) => {
    const values = cards.map((c) => handValue([c as never]).total).sort((a, b) => a - b);
    return values.join('+');
  };

  it('lists rank pairs with the ten-value cards as one rank', () => {
    expect(rankPairsForTotal(16)).toEqual([
      [6, 10],
      [7, 9],
    ]);
    expect(rankPairsForTotal(5)).toEqual([[2, 3]]);
    expect(rankPairsForTotal(4)).toEqual([]);
    expect(rankPairsForTotal(20)).toEqual([]);
  });

  it('hard 16 is 10+6 or 9+7, each about half the time', () => {
    const counts = new Map<string, number>();
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      const shape = shapeOf(pickComposition(16, mulberry32(seed))!);
      counts.set(shape, (counts.get(shape) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(['6+10', '7+9']);
    // Uniform over FACES (the old draw) puts 6+10 at 4 in 5.
    const share = counts.get('6+10')! / N;
    expect(share).toBeGreaterThan(0.45);
    expect(share).toBeLessThan(0.55);
  });

  it('is uniform over rank pairs for every total', () => {
    for (const total of TOTALS) {
      const pairs = rankPairsForTotal(total);
      const counts = new Map<string, number>();
      const N = 600 * pairs.length;
      for (let seed = 1; seed <= N; seed++) {
        const shape = shapeOf(pickComposition(total, mulberry32(seed * 7 + total))!);
        counts.set(shape, (counts.get(shape) ?? 0) + 1);
      }
      expect(counts.size, `total ${total}`).toBe(pairs.length);
      for (const n of counts.values()) {
        expect(n / N, `total ${total}`).toBeGreaterThan(1 / pairs.length - 0.06);
        expect(n / N, `total ${total}`).toBeLessThan(1 / pairs.length + 0.06);
      }
    }
  });

  it('is always that hard total, never an ace, never a pair', () => {
    for (const total of TOTALS) {
      for (let seed = 1; seed <= 200; seed++) {
        const cards = pickComposition(total, mulberry32(seed))!;
        const v = handValue(cards);
        expect(v.total).toBe(total);
        expect(v.soft).toBe(false);
        expect(cards.some((c) => c.rank === 'A')).toBe(false);
        expect(handValue([cards[0]]).total).not.toBe(handValue([cards[1]]).total);
      }
    }
  });

  it('face, suit and order are cosmetic and do vary', () => {
    const faces = new Set<string>();
    const suits = new Set<string>();
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 400; seed++) {
      const cards = pickComposition(16, mulberry32(seed))!;
      for (const c of cards) {
        if (handValue([c]).total === 10) faces.add(c.rank);
        suits.add(c.suit);
      }
      firsts.add(String(handValue([cards[0]]).total > handValue([cards[1]]).total));
    }
    expect([...faces].sort()).toEqual(['10', 'J', 'K', 'Q']);
    expect(suits.size).toBe(4);
    expect(firsts.size).toBe(2);
  });

  it('has no composition for 4 or 20, and makeHardHand with an rng is pickComposition', () => {
    expect(pickComposition(4, mulberry32(1))).toBeNull();
    expect(pickComposition(20, mulberry32(1))).toBeNull();
    for (let seed = 1; seed <= 50; seed++) {
      expect(makeHardHand(15, mulberry32(seed))).toEqual(pickComposition(15, mulberry32(seed)));
    }
  });
});
