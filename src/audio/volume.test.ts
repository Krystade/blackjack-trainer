import { describe, it, expect } from 'vitest';
import {
  MAX_VOLUME,
  clampVolume,
  effectiveVolume,
  elementVolume,
  utteranceVolume,
  chimePeak,
  CHIME_PEAK_GAIN,
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

describe('a request above unity reaches the voice as unity', () => {
  /**
   * The whole of the clip path's level control, now that the GainNode route is
   * gone (audio/volume.ts says why -- it stretched a 3029ms prompt to 4455ms
   * on the phone). An element clamped here is an element that still PLAYS; the
   * setter throws above 1, and a throw takes out the utterance.
   */
  it('hands an element at most unity, whatever was asked for', () => {
    expect(elementVolume(1)).toBe(1);
    expect(elementVolume(1.5)).toBe(1);
    expect(elementVolume(2)).toBe(1);
    expect(elementVolume(99)).toBe(1);
  });

  it('still attenuates below unity, which is the half that works', () => {
    expect(elementVolume(0)).toBe(0);
    expect(elementVolume(0.25)).toBe(0.25);
  });

  // The one path the headroom above unity still reaches: a bare oscillator,
  // inside the graph already, with nothing to resample and nothing to damage.
  it('spends the headroom above unity on the chimes instead', () => {
    expect(chimePeak(1)).toBe(CHIME_PEAK_GAIN);
    expect(chimePeak(2)).toBe(1);
    expect(chimePeak(2)).toBeGreaterThan(chimePeak(1));
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

describe('effectiveVolume', () => {
  it('is zero when muted, whatever the level says', () => {
    expect(effectiveVolume({ volume: 2, muted: true })).toBe(0);
    expect(effectiveVolume({ volume: 0.3, muted: true })).toBe(0);
  });

  it('is the clamped level when not muted', () => {
    expect(effectiveVolume({ volume: 0.3, muted: false })).toBe(0.3);
    // Still clamped: mute must not become the only thing keeping a bad value
    // out of an HTMLMediaElement, whose setter throws above 1.
    expect(effectiveVolume({ volume: 99, muted: false })).toBe(MAX_VOLUME);
  });

  it('treats a missing flag as unmuted, so older stored settings still speak', () => {
    expect(effectiveVolume({ volume: 1 })).toBe(1);
  });
});
