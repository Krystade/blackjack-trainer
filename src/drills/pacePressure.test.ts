import { describe, it, expect } from 'vitest';
import {
  paceMultiplier,
  PACE_WINDOW,
  PACE_BURST_LEN,
  PACE_BURST_MULT,
} from './pacePressure';

describe('paceMultiplier (ET7 dealer-pace pressure)', () => {
  it('is deterministic: same (seed, index) -> same multiplier', () => {
    for (let i = 0; i < 40; i++) {
      expect(paceMultiplier(123, i)).toBe(paceMultiplier(123, i));
    }
  });

  it('only ever returns the burst multiplier or 1 (a normal-pace or a fast burst)', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let i = 0; i < PACE_WINDOW * 6; i++) {
        const m = paceMultiplier(seed, i);
        expect(m === 1 || m === PACE_BURST_MULT).toBe(true);
      }
    }
  });

  it('has EXACTLY one burst (PACE_BURST_LEN fast cards) per window', () => {
    for (let seed = 0; seed < 50; seed++) {
      for (let w = 0; w < 5; w++) {
        let fast = 0;
        for (let p = 0; p < PACE_WINDOW; p++) {
          if (paceMultiplier(seed, w * PACE_WINDOW + p) === PACE_BURST_MULT) fast++;
        }
        expect(fast).toBe(PACE_BURST_LEN);
      }
    }
  });

  it('every burst RECOVERS: the fast cards in a window are contiguous, then back to normal', () => {
    // A contiguous burst means the fast positions form one run (no gaps) within
    // the window -- i.e. it speeds up, then recovers, rather than flickering.
    for (let seed = 0; seed < 50; seed++) {
      const fastPositions: number[] = [];
      for (let p = 0; p < PACE_WINDOW; p++) {
        if (paceMultiplier(seed, p) === PACE_BURST_MULT) fastPositions.push(p);
      }
      expect(fastPositions).toHaveLength(PACE_BURST_LEN);
      for (let k = 1; k < fastPositions.length; k++) {
        expect(fastPositions[k]).toBe(fastPositions[k - 1] + 1); // contiguous
      }
    }
  });

  it('burst timing varies window to window (unpredictable, not a fixed cadence)', () => {
    const firstFastOf = (seed: number, w: number) => {
      for (let p = 0; p < PACE_WINDOW; p++) {
        if (paceMultiplier(seed, w * PACE_WINDOW + p) === PACE_BURST_MULT) return p;
      }
      return -1;
    };
    const offsets = new Set<number>();
    for (let w = 0; w < 20; w++) offsets.add(firstFastOf(2024, w));
    expect(offsets.size).toBeGreaterThan(1); // a fixed cadence would give one offset
  });

  it('negative index is safe (normal pace)', () => {
    expect(paceMultiplier(1, -1)).toBe(1);
  });
});
