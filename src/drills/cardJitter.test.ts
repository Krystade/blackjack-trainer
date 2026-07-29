import { describe, it, expect } from 'vitest';
import {
  cardJitter,
  jitterTransform,
  JITTER_MAX_ROT_DEG,
  JITTER_MAX_SHIFT_REM,
} from './cardJitter';

describe('cardJitter (R9 messy card presentation)', () => {
  it('is deterministic: same (seed, index) -> identical jitter', () => {
    for (let i = 0; i < 20; i++) {
      expect(cardJitter(12345, i)).toEqual(cardJitter(12345, i));
    }
  });

  it('stays within the readable bounds (rotation and shift are capped)', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (let i = 0; i < 8; i++) {
        const j = cardJitter(seed, i);
        expect(Math.abs(j.rotateDeg)).toBeLessThanOrEqual(JITTER_MAX_ROT_DEG);
        expect(Math.abs(j.dxRem)).toBeLessThanOrEqual(JITTER_MAX_SHIFT_REM);
        expect(Math.abs(j.dyRem)).toBeLessThanOrEqual(JITTER_MAX_SHIFT_REM);
      }
    }
  });

  it('decorrelates by index: adjacent cards in a round get distinct transforms', () => {
    // A smooth/duplicated jitter would defeat the "messy scatter" goal.
    let distinctPairs = 0;
    for (let i = 1; i < 12; i++) {
      const a = cardJitter(777, i - 1);
      const b = cardJitter(777, i);
      if (a.rotateDeg !== b.rotateDeg || a.dxRem !== b.dxRem || a.dyRem !== b.dyRem) distinctPairs++;
    }
    expect(distinctPairs).toBe(11); // every adjacent pair differs
  });

  it('is not the identity (it actually perturbs cards)', () => {
    // Across a handful of cards at least one has a meaningfully non-zero rotation.
    const anyRotated = Array.from({ length: 6 }, (_, i) => cardJitter(42, i)).some(
      (j) => Math.abs(j.rotateDeg) > 0.5,
    );
    expect(anyRotated).toBe(true);
  });

  it('jitterTransform renders a translate+rotate CSS string', () => {
    const s = jitterTransform({ rotateDeg: 3.5, dxRem: 0.1, dyRem: -0.2 });
    expect(s).toBe('translate(0.100rem, -0.200rem) rotate(3.50deg)');
  });
});
