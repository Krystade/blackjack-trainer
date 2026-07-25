import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { missWeight, weightedIndex, bumpMiss, decayMiss } from './weightedDraw';

describe('missWeight', () => {
  it('missCount=0 -> baseline weight 1', () => {
    expect(missWeight(0)).toBe(1);
  });

  it('missCount=1 -> weight 3 (1 + 2*1)', () => {
    expect(missWeight(1)).toBe(3);
  });

  it('missCount=5 -> weight 11 (1 + 2*5)', () => {
    expect(missWeight(5)).toBe(11);
  });

  it('never returns below baseline 1 even for a negative missCount (defensive clamp)', () => {
    expect(missWeight(-3)).toBe(1);
  });
});

describe('bumpMiss', () => {
  it('increments an absent key from 0 to 1', () => {
    const result = bumpMiss({}, 'a');
    expect(result.a).toBe(1);
  });

  it('increments an existing key by 1', () => {
    const result = bumpMiss({ a: 4 }, 'a');
    expect(result.a).toBe(5);
  });

  it('does not mutate the input map', () => {
    const input = { a: 1 };
    bumpMiss(input, 'a');
    expect(input.a).toBe(1);
  });

  it('leaves other keys untouched', () => {
    const result = bumpMiss({ a: 1, b: 2 }, 'a');
    expect(result.b).toBe(2);
  });
});

describe('decayMiss', () => {
  it('decrements an existing positive key by 1', () => {
    const result = decayMiss({ a: 4 }, 'a');
    expect(result.a).toBe(3);
  });

  it('floors at 0 -- never goes negative', () => {
    const result = decayMiss({ a: 0 }, 'a');
    expect(result.a).toBe(0);
  });

  it('an absent key decays to 0 (baseline), not negative', () => {
    const result = decayMiss({}, 'a');
    expect(result.a).toBe(0);
  });

  it('repeated decay on an absent/zero key stays at 0 (floor holds under repetition)', () => {
    let weights: Record<string, number> = {};
    for (let i = 0; i < 10; i++) {
      weights = decayMiss(weights, 'a');
    }
    expect(weights.a).toBe(0);
  });

  it('does not mutate the input map', () => {
    const input = { a: 4 };
    decayMiss(input, 'a');
    expect(input.a).toBe(4);
  });

  it('leaves other keys untouched', () => {
    const result = decayMiss({ a: 4, b: 2 }, 'a');
    expect(result.b).toBe(2);
  });
});

describe('weightedIndex', () => {
  it('a heavily-missed index is drawn disproportionately over many seeds vs a mastered (0-weight) one', () => {
    // 5 candidate slots; slot 2 has been missed heavily, everything else is
    // at baseline. Over many independent seeded draws, slot 2 should show up
    // far more than its 1/5 "fair share".
    const weights = [1, 1, missWeight(20), 1, 1];
    const counts = [0, 0, 0, 0, 0];
    const trials = 2000;
    for (let seed = 0; seed < trials; seed++) {
      const rng = mulberry32(seed);
      const idx = weightedIndex(rng, weights);
      counts[idx]++;
    }
    // Fair share would be ~400/2000 (20%); the heavily-missed slot should
    // clear well above that.
    expect(counts[2]).toBeGreaterThan(trials * 0.3);
    // And it should still be possible to draw the others (not starved to 0).
    expect(counts[0]).toBeGreaterThan(0);
  });

  it('a decayed-back-to-baseline index returns to roughly its fair uniform share', () => {
    const weights = [1, 1, missWeight(0), 1, 1]; // slot 2 decayed back to baseline
    const counts = [0, 0, 0, 0, 0];
    const trials = 5000;
    for (let seed = 0; seed < trials; seed++) {
      const rng = mulberry32(seed * 7919 + 1);
      const idx = weightedIndex(rng, weights);
      counts[idx]++;
    }
    const fairShare = trials / weights.length;
    // All slots are equal weight now -- each should land within a generous
    // band around the fair share (this is a statistical sanity check, not an
    // exact-uniformity proof).
    for (const c of counts) {
      expect(Math.abs(c - fairShare)).toBeLessThan(fairShare * 0.35);
    }
  });

  it('with all-equal weights, matches the plain Math.floor(rng() * n) index for a range of seeds', () => {
    const n = 7;
    const weights = Array(n).fill(1);
    for (let seed = 0; seed < 500; seed++) {
      const rngA = mulberry32(seed);
      const expected = Math.floor(rngA() * n);

      const rngB = mulberry32(seed);
      const actual = weightedIndex(rngB, weights);

      expect(actual).toBe(expected);
    }
  });

  it('single-item weight array always returns index 0', () => {
    for (let seed = 0; seed < 20; seed++) {
      const rng = mulberry32(seed);
      expect(weightedIndex(rng, [5])).toBe(0);
    }
  });
});
