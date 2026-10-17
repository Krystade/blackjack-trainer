import { describe, it, expect } from 'vitest';
import {
  SHOT_CLOCK_OFF,
  CORRECTION_READ_GRACE_MS,
  answeredUnderShotClock,
  answerElapsedMs,
  expiryVerdict,
  readGraceMs,
  shotClockSuspended,
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

describe('Wave A: idle stop, suspension and reading grace', () => {
  it('grades the first timeout and stops on the second in a row', () => {
    expect(expiryVerdict(0)).toBe('grade');
    expect(expiryVerdict(1)).toBe('stop');
    expect(expiryVerdict(5)).toBe('stop');
  });
  it('is suspended eyes-free or with voice on', () => {
    expect(shotClockSuspended(false, false)).toBe(false);
    expect(shotClockSuspended(true, false)).toBe(true);
    expect(shotClockSuspended(false, true)).toBe(true);
  });
  it('gives reading time only after a miss', () => {
    expect(readGraceMs(true)).toBe(CORRECTION_READ_GRACE_MS);
    expect(readGraceMs(false)).toBe(0);
    expect(CORRECTION_READ_GRACE_MS).toBeGreaterThan(0);
  });
});

describe('Wave A review: what an answer records', () => {
  it('is under the shot clock only when one was actually running', () => {
    expect(answeredUnderShotClock(3000, false, false)).toBe(true);
    expect(answeredUnderShotClock(0, false, false)).toBe(false);
    // Eyes-free / voice: suspended, no clock on screen.
    expect(answeredUnderShotClock(3000, true, false)).toBe(false);
    // Stopped for idleness: the answer that restarts it was untimed.
    expect(answeredUnderShotClock(3000, false, true)).toBe(false);
  });

  it('takes the correction-reading grace off the answer time, never below the grace itself', () => {
    // No grace: untouched.
    expect(answerElapsedMs(4000, 0)).toBe(4000);
    // Answered inside the grace: nothing was spent reading on top of it.
    expect(answerElapsedMs(1200, CORRECTION_READ_GRACE_MS)).toBe(1200);
    // Read for the grace, then 1.5s to answer: 1.5s is under the grace, so
    // the answer is credited as the grace (fluent), not 4.0s (hesitant).
    expect(answerElapsedMs(CORRECTION_READ_GRACE_MS + 1500, CORRECTION_READ_GRACE_MS)).toBe(CORRECTION_READ_GRACE_MS);
    // Read, then a slow 3.5s answer: the 3.5s is what is recorded.
    expect(answerElapsedMs(CORRECTION_READ_GRACE_MS + 3500, CORRECTION_READ_GRACE_MS)).toBe(3500);
    // Monotone: a later answer never records less time.
    let prev = -1;
    for (let raw = 0; raw <= 10_000; raw += 50) {
      const v = answerElapsedMs(raw, CORRECTION_READ_GRACE_MS);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
