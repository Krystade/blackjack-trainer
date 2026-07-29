import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { makePairCancel, isCancellingPair, pairCancelBias, PAIR_CANCEL_NETS } from './pairCancellation';

describe('makePairCancel (R8 pair-cancellation drill)', () => {
  it('is deterministic for a seed: same seed -> identical pair and net', () => {
    const a = makePairCancel(12345);
    const b = makePairCancel(12345);
    expect(b.cards.map((c) => `${c.rank}${c.suit}`)).toEqual(a.cards.map((c) => `${c.rank}${c.suit}`));
    expect(b.net).toBe(a.net);
  });

  it('net always equals the sum of the two Hi-Lo tags and stays within [-2, 2]', () => {
    for (let seed = 0; seed < 500; seed++) {
      const round = makePairCancel(seed);
      const [a, b] = round.cards;
      expect(round.net).toBe(hiLoTag(a.rank) + hiLoTag(b.rank));
      expect(PAIR_CANCEL_NETS).toContain(round.net as (typeof PAIR_CANCEL_NETS)[number]);
    }
  });

  it('draws two distinct cards from the deck (no card dealt twice)', () => {
    for (let seed = 0; seed < 200; seed++) {
      const [a, b] = makePairCancel(seed).cards;
      expect(`${a.rank}${a.suit}`).not.toBe(`${b.rank}${b.suit}`);
    }
  });

  it('produces every net value across enough seeds (the answer set is reachable)', () => {
    const seen = new Set<number>();
    for (let seed = 0; seed < 500; seed++) seen.add(makePairCancel(seed).net);
    for (const net of PAIR_CANCEL_NETS) expect(seen.has(net)).toBe(true);
  });
});

describe('isCancellingPair', () => {
  it('is true for a +1 low and a -1 high card (a genuine cancel)', () => {
    // Force the pair by construction rather than seed-hunting.
    const round = { cards: [{ rank: '3', suit: 's' }, { rank: 'K', suit: 'h' }], net: 0 } as ReturnType<
      typeof makePairCancel
    >;
    expect(hiLoTag('3')).toBe(1);
    expect(hiLoTag('K')).toBe(-1);
    expect(isCancellingPair(round)).toBe(true);
  });

  it('is FALSE for a net-0 pair of two zero-tag cards (nothing cancelled)', () => {
    const round = { cards: [{ rank: '7', suit: 's' }, { rank: '8', suit: 'h' }], net: 0 } as ReturnType<
      typeof makePairCancel
    >;
    expect(isCancellingPair(round)).toBe(false);
  });

  it('is false for any non-zero net', () => {
    const round = { cards: [{ rank: '3', suit: 's' }, { rank: '4', suit: 'h' }], net: 2 } as ReturnType<
      typeof makePairCancel
    >;
    expect(isCancellingPair(round)).toBe(false);
  });
});

describe('makePairCancel cancellingBias (TS#6 content-weighting)', () => {
  it('cancellingBias=0 (default) is unchanged: identical to the bare call', () => {
    for (let seed = 0; seed < 100; seed++) {
      const a = makePairCancel(seed);
      const b = makePairCancel(seed, 0);
      expect(b.cards.map((c) => `${c.rank}${c.suit}`)).toEqual(a.cards.map((c) => `${c.rank}${c.suit}`));
      expect(b.net).toBe(a.net);
    }
  });

  it('cancellingBias=1 ALWAYS yields a genuine cancelling pair (net 0, +1/-1)', () => {
    for (let seed = 0; seed < 300; seed++) {
      const round = makePairCancel(seed, 1);
      expect(round.net).toBe(0);
      expect(isCancellingPair(round)).toBe(true);
    }
  });

  it('a positive bias raises the genuine-cancel rate well above the unbiased draw', () => {
    const rate = (bias: number) => {
      let cancels = 0;
      const n = 400;
      for (let seed = 0; seed < n; seed++) if (isCancellingPair(makePairCancel(seed, bias))) cancels++;
      return cancels / n;
    };
    const unbiased = rate(0);
    const biased = rate(0.6);
    expect(biased).toBeGreaterThan(unbiased);
  });
});

describe('pairCancelBias schedule (TS#6)', () => {
  it('starts high and decays monotonically to 0, clamped to [0,1]', () => {
    expect(pairCancelBias(0)).toBeCloseTo(0.6, 5);
    let prev = Infinity;
    for (let r = 0; r < 30; r++) {
      const b = pairCancelBias(r);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(prev); // non-increasing
      prev = b;
    }
    expect(pairCancelBias(20)).toBe(0); // fully decayed
  });

  it('negative round indices clamp to the starting bias (never above it)', () => {
    expect(pairCancelBias(-5)).toBe(0.6);
  });
});
