import { describe, it, expect } from 'vitest';
import {
  MAX_VOLUME,
  clampVolume,
  elementVolume,
  utteranceVolume,
  needsAmplification,
  gainFactor,
  chimePeak,
} from './volume';

/**
 * These ceilings are not style choices, they are platform behaviour measured
 * in a browser: `HTMLMediaElement.volume = 2` THROWS IndexSizeError, and
 * `SpeechSynthesisUtterance.volume = 2` silently clamps to 1. A regression
 * here does not look like a wrong number, it looks like an exception thrown
 * mid-utterance -- so the split is pinned rather than trusted.
 */

describe('clampVolume', () => {
  it('allows the full range up to the boost ceiling', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(1)).toBe(1);
    expect(clampVolume(2)).toBe(2);
  });

  it('clamps out-of-range values', () => {
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(99)).toBe(MAX_VOLUME);
  });

  // A corrupt stored setting must not become NaN and silence the app.
  // Nonsense falls back to normal volume, NOT to the ceiling: a corrupt
  // stored setting should not blast at 200% in a car.
  it('falls back to normal volume for nonsense', () => {
    expect(clampVolume(NaN)).toBe(1);
    expect(clampVolume(Infinity)).toBe(1);
    expect(clampVolume(-Infinity)).toBe(1);
  });

  it('preserves silence, which is a legitimate setting', () => {
    expect(clampVolume(0)).toBe(0);
    expect(elementVolume(0)).toBe(0);
    expect(utteranceVolume(0)).toBe(0);
  });
});

describe('element and utterance ceilings', () => {
  // The throwing case. This is the assertion that protects playback.
  it('never hands a media element more than 1', () => {
    expect(elementVolume(1.5)).toBe(1);
    expect(elementVolume(2)).toBe(1);
    expect(elementVolume(0.4)).toBe(0.4);
  });

  it('never hands an utterance more than 1', () => {
    expect(utteranceVolume(2)).toBe(1);
    expect(utteranceVolume(0.6)).toBe(0.6);
  });
});

describe('amplification is only engaged when it has work to do', () => {
  /**
   * The safety property. Routing through Web Audio means a suspended
   * AudioContext produces SILENCE rather than quiet, so the ordinary path
   * must never touch it.
   */
  it('is not needed at or below unity', () => {
    expect(needsAmplification(0)).toBe(false);
    expect(needsAmplification(0.5)).toBe(false);
    expect(needsAmplification(1)).toBe(false);
  });

  it('is needed above unity', () => {
    expect(needsAmplification(1.01)).toBe(true);
    expect(needsAmplification(2)).toBe(true);
  });

  it('has unity gain whenever it is not needed', () => {
    expect(gainFactor(0)).toBe(1);
    expect(gainFactor(0.5)).toBe(1);
    expect(gainFactor(1)).toBe(1);
  });

  it('carries only the excess above unity', () => {
    expect(gainFactor(1.5)).toBe(1.5);
    expect(gainFactor(2)).toBe(2);
    expect(gainFactor(5)).toBe(MAX_VOLUME);
  });

  // element x gain reconstructs the requested loudness.
  it('composes back to the requested volume', () => {
    for (const v of [0, 0.25, 1, 1.5, 2]) {
      expect(elementVolume(v) * gainFactor(v)).toBeCloseTo(clampVolume(v), 5);
    }
  });
});

describe('chimePeak', () => {
  it('is louder than the old fixed 0.3 at full volume', () => {
    expect(chimePeak(1)).toBeGreaterThan(0.3);
  });

  it('scales with the setting and still respects silence', () => {
    expect(chimePeak(0)).toBe(0);
    expect(chimePeak(2)).toBeGreaterThan(chimePeak(1));
  });

  // A bare oscillator clips above full scale, so the envelope must not exceed it.
  it('never exceeds full scale', () => {
    expect(chimePeak(2)).toBeLessThanOrEqual(1);
    expect(chimePeak(99)).toBeLessThanOrEqual(1);
  });
});
