import { describe, expect, it } from 'vitest';
import { chimeContourForTest } from './speech';
import { toneSamples } from './tone';

/** Upward zero crossings per sample in [from, to) -- a pitch estimate. */
function crossings(s: Float32Array, from: number, to: number): number {
  let n = 0;
  for (let i = Math.max(1, from); i < to; i++) if (s[i - 1]! < 0 && s[i]! >= 0) n++;
  return n;
}

/**
 * C-R4: "not understood" and "mic open / your turn" are two clearly different
 * tones -- a different pitch CONTOUR, not just a different note or volume.
 */
describe('say-again tone contour (C-R4)', () => {
  it('say-again falls; your-turn and mic-open are flat', () => {
    const [againStart, againEnd] = chimeContourForTest('again');
    expect(againEnd, 'say-again must glide down').toBeLessThan(againStart * 0.75);
    for (const kind of ['turn', 'ready'] as const) {
      const [s, e] = chimeContourForTest(kind);
      expect(e, `${kind} is a steady tone`).toBe(s);
    }
    // Not just the contour: nowhere near the same pitch either.
    expect(Math.abs(againEnd - chimeContourForTest('turn')[0])).toBeGreaterThan(50);
  });

  it('the synthesised samples actually glide (pitch falls across the tone)', () => {
    const [start, end] = chimeContourForTest('again');
    const s = toneSamples(start, 1, end);
    const half = s.length >> 1;
    const first = crossings(s, 0, half);
    const second = crossings(s, half, s.length);
    expect(second).toBeLessThan(first * 0.85);
    // A flat tone does not.
    const flat = toneSamples(start);
    expect(Math.abs(crossings(flat, 0, half) - crossings(flat, half, flat.length))).toBeLessThanOrEqual(2);
  });
});
