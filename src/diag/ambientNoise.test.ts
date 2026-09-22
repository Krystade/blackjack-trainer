import { describe, it, expect } from 'vitest';
import { toDbfs, rms, peak, foldFrames, bandFor, adviceFor } from './ambientNoise';

const frame = (...v: number[]) => Float32Array.from(v);

describe('turning samples into a number', () => {
  it('reads full-scale as 0 dBFS and silence as the floor', () => {
    expect(toDbfs(1)).toBeCloseTo(0, 6);
    expect(toDbfs(0)).toBe(-100);
    // Negative or NaN amplitude is a bug upstream, not -Infinity downstream.
    expect(toDbfs(Number.NaN)).toBe(-100);
  });

  it('halving the amplitude costs about 6 dB', () => {
    expect(toDbfs(0.5) - toDbfs(1)).toBeCloseTo(-6.02, 1);
  });

  it('takes the root mean square, not the mean', () => {
    // Mean of |x| here is 0.5; RMS is sqrt((1+0)/2) = 0.707. A mean would
    // under-report every signal that spends time near zero, i.e. all speech.
    expect(rms(frame(1, -1, 0, 0))).toBeCloseTo(Math.SQRT1_2, 6);
    expect(peak(frame(0.2, -0.9, 0.1))).toBeCloseTo(0.9, 6);
  });

  it('survives an empty frame rather than dividing by zero', () => {
    expect(rms(frame())).toBe(0);
    expect(peak(frame())).toBe(0);
  });
});

describe('folding a window of frames', () => {
  /**
   * The one that matters in a car: a window that is mostly quiet with one
   * loud passage. Averaging per-frame RMS would report the quiet; combining
   * in the power domain reports something between, which is the truth.
   */
  it('does not let a loud passage average away', () => {
    const quiet = frame(0.01, -0.01, 0.01, -0.01);
    const loud = frame(0.9, -0.9, 0.9, -0.9);
    const reading = foldFrames([quiet, quiet, quiet, loud], 4000);

    const meanOfRms = (3 * rms(quiet) + rms(loud)) / 4;
    expect(reading.dbfs).toBeGreaterThan(toDbfs(meanOfRms));
    // ...and the peak carries the loud passage undiluted, which is what
    // catches a microphone that is clipping rather than merely busy.
    expect(reading.peakDbfs).toBeCloseTo(toDbfs(0.9), 5);
  });

  /**
   * A window with no frames is not a quiet room -- it is a measurement that
   * did not happen, and reporting it as "silent" would be a reading that
   * cannot fail.
   */
  it('reports zero frames rather than passing off nothing as silence', () => {
    const reading = foldFrames([], 5000);
    expect(reading.frames).toBe(0);
    expect(reading.ms).toBe(5000);
  });
});

describe('what the number is allowed to mean', () => {
  it('separates a dead microphone from a quiet one', () => {
    // The distinction the operator needs at the roadside: 'silent' in a
    // moving car means the app is on the wrong input, not that it is quiet.
    expect(bandFor(-95)).toBe('silent');
    expect(bandFor(-50)).toBe('quiet');
    expect(bandFor(-35)).toBe('moderate');
    expect(bandFor(-10)).toBe('loud');
  });

  it('covers every band with advice, so no reading renders blank', () => {
    for (const db of [-95, -50, -35, -10]) {
      expect(adviceFor(bandFor(db)).length).toBeGreaterThan(20);
    }
  });

  it('is monotonic: louder never reads as quieter', () => {
    const order: Record<string, number> = { silent: 0, quiet: 1, moderate: 2, loud: 3 };
    let last = -1;
    for (let db = -100; db <= 0; db += 1) {
      const rank = order[bandFor(db)]!;
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
  });
});
