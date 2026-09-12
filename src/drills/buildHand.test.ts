import { describe, it, expect } from 'vitest';
import { hardCompositions, makeHardHand } from './buildHand';
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
      const [a, b] = makeHardHand(16, mulberry32(seed))!;
      seen.add(`${a.rank}+${b.rank}`);
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
