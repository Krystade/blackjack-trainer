import { describe, it, expect } from 'vitest';
import {
  SHOT_CLOCK_OFF,
  SHOT_CLOCK_OPTIONS,
  shotClockExpired,
  shotClockLabel,
  shotClockOn,
} from './shotClock';

describe('shot clock: off is off', () => {
  it('never expires when the limit is zero, however long you take', () => {
    expect(shotClockOn(SHOT_CLOCK_OFF)).toBe(false);
    expect(shotClockExpired(999_999, SHOT_CLOCK_OFF)).toBe(false);
  });

  /**
   * A negative limit can only come from a corrupt settings blob, and which way
   * it fails matters: read as "on", every card would expire the instant it was
   * drawn and the drill would be unusable with nothing on screen saying why.
   */
  it('treats a nonsense negative limit as off rather than as instantly expired', () => {
    expect(shotClockOn(-5000)).toBe(false);
    expect(shotClockExpired(0, -5000)).toBe(false);
    expect(shotClockLabel(-5000)).toBe('Off');
  });

  it('offers Off plus three real limits, and labels them in seconds', () => {
    expect(SHOT_CLOCK_OPTIONS[0]).toBe(SHOT_CLOCK_OFF);
    expect(shotClockLabel(SHOT_CLOCK_OFF)).toBe('Off');
    expect(shotClockLabel(3000)).toBe('3s');
    expect(shotClockLabel(8000)).toBe('8s');
    // Every offered value must label as something a person can read, and the
    // three real ones must be distinguishable from each other.
    const labels = SHOT_CLOCK_OPTIONS.map(shotClockLabel);
    expect(new Set(labels).size).toBe(SHOT_CLOCK_OPTIONS.length);
  });
});

describe('shot clock: the boundary', () => {
  it('is not expired a millisecond early', () => {
    expect(shotClockExpired(4999, 5000)).toBe(false);
  });

  /** Stated once here so two drill views cannot disagree about it. */
  it('is expired at exactly the limit, not one tick after', () => {
    expect(shotClockExpired(5000, 5000)).toBe(true);
    expect(shotClockExpired(5001, 5000)).toBe(true);
  });

  /**
   * The case this function exists for: a throttled background tab fires the
   * timer many seconds late. Still expired, and the measured elapsed is what
   * gets recorded rather than the nominal limit.
   */
  it('is expired when a throttled timer fires long after the limit', () => {
    expect(shotClockExpired(31_000, 3000)).toBe(true);
  });

  it('is not expired when an answer beat the limit, even by a hair', () => {
    expect(shotClockExpired(2999.9, 3000)).toBe(false);
  });
});
