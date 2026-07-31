import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { weightedIndex } from './weightedDraw';

describe('weightedIndex', () => {
  it('a heavily-weighted index is drawn disproportionately over many seeds vs a baseline one', () => {
    // 5 candidate slots; slot 2 carries a heavy weight, everything else is at
    // baseline. Over many independent seeded draws, slot 2 should show up far
    // more than its 1/5 "fair share".
    const weights = [1, 1, 41, 1, 1];
    const counts = [0, 0, 0, 0, 0];
    const trials = 2000;
    for (let seed = 0; seed < trials; seed++) {
      const rng = mulberry32(seed);
      const idx = weightedIndex(rng, weights);
      counts[idx]++;
    }
    // Fair share would be ~400/2000 (20%); the heavy slot should clear well above.
    expect(counts[2]).toBeGreaterThan(trials * 0.3);
    // And it should still be possible to draw the others (not starved to 0).
    expect(counts[0]).toBeGreaterThan(0);
  });

  it('all-equal weights land each slot within a generous band around the fair share', () => {
    const weights = [1, 1, 1, 1, 1];
    const counts = [0, 0, 0, 0, 0];
    const trials = 5000;
    for (let seed = 0; seed < trials; seed++) {
      const rng = mulberry32(seed * 7919 + 1);
      const idx = weightedIndex(rng, weights);
      counts[idx]++;
    }
    const fairShare = trials / weights.length;
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
