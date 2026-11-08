import { describe, expect, it } from 'vitest';
import {
  CHIP_FALLBACK_UNIT,
  chipBreakdown,
  chipMoney,
  circleAfter,
  onFeltAfter,
  pullBackLine,
  shortDollars,
  showChipsNote,
  topDenom,
  chipFaceLabel,
} from './chips';

/** Track 3 (U6): units in, dollars and chips out. */

const sum = (cs: { denom: number; count: number }[]) => cs.reduce((n, c) => n + c.denom * c.count, 0);

describe('chipMoney', () => {
  it('off unless the setting is on; the profile unit, or the fallback', () => {
    expect(chipMoney({}, { unitDollars: 25 })).toBeNull();
    expect(chipMoney({ showChips: false }, { unitDollars: 25 })).toBeNull();
    expect(chipMoney({ showChips: true }, { unitDollars: 10 })).toEqual({ unit: 10 });
    expect(chipMoney({ showChips: true }, {})).toEqual({ unit: CHIP_FALLBACK_UNIT });
    expect(chipMoney({ showChips: true }, { unitDollars: 0 })).toEqual({ unit: CHIP_FALLBACK_UNIT });
  });
});

describe('chipBreakdown', () => {
  it('the fewest standard chips, high to low', () => {
    expect(chipBreakdown(125)).toEqual([
      { denom: 100, count: 1 },
      { denom: 25, count: 1 },
    ]);
    expect(chipBreakdown(1630)).toEqual([
      { denom: 1000, count: 1 },
      { denom: 500, count: 1 },
      { denom: 100, count: 1 },
      { denom: 25, count: 1 },
      { denom: 5, count: 1 },
    ]);
    expect(chipBreakdown(7)).toEqual([
      { denom: 5, count: 1 },
      { denom: 1, count: 2 },
    ]);
  });

  it('a 3:2 natural on $125 pays $187.50: a black, three greens, two reds and a pink', () => {
    const pay = chipBreakdown(187.5);
    expect(pay).toEqual([
      { denom: 100, count: 1 },
      { denom: 25, count: 3 },
      { denom: 5, count: 2 },
      { denom: 2.5, count: 1 },
    ]);
    expect(sum(pay)).toBe(187.5);
  });

  it('a half dollar is a pink $2.50 when there are two dollars to take it from, else the coin', () => {
    expect(chipBreakdown(2.5)).toEqual([{ denom: 2.5, count: 1 }]);
    expect(chipBreakdown(3.5)).toEqual([
      { denom: 2.5, count: 1 },
      { denom: 1, count: 1 },
    ]);
    expect(chipBreakdown(1.5)).toEqual([
      { denom: 1, count: 1 },
      { denom: 0.5, count: 1 },
    ]);
    expect(chipBreakdown(0.5)).toEqual([{ denom: 0.5, count: 1 }]);
  });

  it('every amount on the half dollar adds back up', () => {
    for (let h = 1; h <= 4000; h += 7) expect(sum(chipBreakdown(h / 2)), `$${h / 2}`).toBe(h / 2);
  });

  it('nothing for nothing', () => {
    expect(chipBreakdown(0)).toEqual([]);
    expect(chipBreakdown(-25)).toEqual([]);
    expect(chipBreakdown(Number.NaN)).toEqual([]);
    expect(topDenom(0)).toBeNull();
    expect(topDenom(30)).toBe(25);
  });
});

describe('chipFaceLabel', () => {
  it('the value printed on each chip', () => {
    expect([1000, 500, 100, 25, 5, 2.5, 1, 0.5].map((d) => chipFaceLabel(d as never))).toEqual(['1k', '500', '100', '25', '5', '2½', '1', '½']);
  });
});

describe('shortDollars', () => {
  it('a chip face: whole dollars, then k', () => {
    expect(shortDollars(25)).toBe('$25');
    expect(shortDollars(300)).toBe('$300');
    expect(shortDollars(1000)).toBe('$1k');
    expect(shortDollars(1200)).toBe('$1.2k');
    expect(shortDollars(12.5)).toBe('$12.50');
  });
});

describe('circleAfter', () => {
  const u = 25;
  it('in play: the stake, doubled when doubled', () => {
    expect(circleAfter({ bet: 4, doubled: false }, u)).toEqual({ stake: 100, paid: 0, back: 100, live: true });
    expect(circleAfter({ bet: 4, doubled: true }, u).stake).toBe(200);
  });
  it('a natural pays 3:2 beside the stake: $187.50 on $125', () => {
    expect(circleAfter({ bet: 5, doubled: false, result: 'blackjack', net: 7.5 }, u)).toEqual({ stake: 125, paid: 187.5, back: 125, live: false });
  });
  it('6:5 pays what the hand net says', () => {
    expect(circleAfter({ bet: 5, doubled: false, result: 'blackjack', net: 6 }, u).paid).toBe(150);
  });
  it('a doubled win pays the doubled stake', () => {
    expect(circleAfter({ bet: 2, doubled: true, result: 'win', net: 4 }, u)).toEqual({ stake: 100, paid: 100, back: 100, live: false });
  });
  it('a loss empties the circle, a push leaves it, a surrender leaves half', () => {
    expect(circleAfter({ bet: 4, doubled: false, result: 'lose', net: -4 }, u).back).toBe(0);
    expect(circleAfter({ bet: 4, doubled: false, result: 'push', net: 0 }, u)).toEqual({ stake: 100, paid: 0, back: 100, live: false });
    expect(circleAfter({ bet: 4, doubled: false, result: 'surrender', net: -2 }, u).back).toBe(50);
  });
  it('a dealer mispay shows as paid (the hand net is the truth)', () => {
    expect(circleAfter({ bet: 4, doubled: false, result: 'win', net: 3 }, u).paid).toBe(75);
  });
});

describe('the pull-back line', () => {
  it('sums what is left on the felt across hands', () => {
    expect(
      onFeltAfter(
        [
          { bet: 5, doubled: false, result: 'blackjack', net: 7.5 },
          { bet: 4, doubled: false, result: 'lose', net: -4 },
        ],
        25,
      ),
    ).toBe(312.5);
    expect(onFeltAfter([{ bet: 4, doubled: false }], 25), 'a live hand is not yours yet').toBe(0);
  });
  it('says what to pull back, or add, for the next bet', () => {
    expect(pullBackLine(312.5, 100)).toBe('On the felt $312.50 · next bet $100 · pull back $212.50');
    expect(pullBackLine(50, 100)).toBe('On the felt $50 · next bet $100 · add $50');
  });
  it('says nothing with an empty felt or the next bet already there', () => {
    expect(pullBackLine(0, 100)).toBeNull();
    expect(pullBackLine(100, 100)).toBeNull();
  });
});

describe('showChipsNote', () => {
  it('names the unit, or the fallback until one is set', () => {
    expect(showChipsNote(10)).toContain('$10 a unit');
    expect(showChipsNote(undefined)).toContain('$25 a unit until you set $ per unit');
  });
});
