import { describe, expect, it } from 'vitest';
import { vpGapPx } from './viewportGap';

describe('vpGapPx', () => {
  it('is 0 when a fixed bottom:0 box ends on the screen edge (current iOS, every browser tab)', () => {
    expect(vpGapPx(812, 812)).toBe(0);
  });

  it('moves bars down by the shortfall when the fixed box stops short (WebKit 237961)', () => {
    expect(vpGapPx(765, 812)).toBe(-47);
    expect(vpGapPx(642.6, 693)).toBe(-50);
  });

  it('never moves bars up, and ignores sub-pixel noise', () => {
    expect(vpGapPx(830, 812)).toBe(0);
    expect(vpGapPx(811.7, 812)).toBe(0);
  });

  it('distrusts readings no status bar explains', () => {
    expect(vpGapPx(500, 812)).toBe(0);
    expect(vpGapPx(Number.NaN, 812)).toBe(0);
    expect(vpGapPx(812, 0)).toBe(0);
  });
});
