import { describe, it, expect } from 'vitest';
import { classifyLockProbe, LOCK_PROBE_TICK_MS } from './lockProbe';

/**
 * THE LOCK QUESTION CANNOT BE READ FROM THE LOG THAT EXISTS.
 *
 * "If nothing is timestamped inside the locked window, iOS froze the page"
 * is not a discriminating test: on a step that has finished speaking and is
 * waiting for an answer the app runs no timer at all, so a frozen page and
 * an idle page write the same nothing. The only periodic row is the
 * recogniser heartbeat, and it exists only on the eight microphone-open
 * steps.
 *
 * So the probe brings its own clock -- a tick every `LOCK_PROBE_TICK_MS` --
 * and this is the arithmetic that turns "how many ticks landed while the
 * screen was off" into a verdict. Pure, so the three shapes of the answer
 * can be pinned without a phone.
 */
describe('classifyLockProbe', () => {
  const tickMs = LOCK_PROBE_TICK_MS;

  it('calls a window too short to hold two ticks inconclusive, whatever landed in it', () => {
    expect(classifyLockProbe({ hiddenMs: tickMs, ticksInside: 0 })).toBe('too-short');
    expect(classifyLockProbe({ hiddenMs: tickMs * 2 - 1, ticksInside: 1 })).toBe('too-short');
  });

  it('calls a full cadence normal', () => {
    // 30s hidden at a 2s tick: fifteen expected, fifteen seen.
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 30_000 / tickMs })).toBe('normal');
    // setInterval slop and the 1s flush buffer cost a tick or two; that is
    // still a page that kept running.
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 30_000 / tickMs - 2 })).toBe(
      'normal',
    );
  });

  it('calls a sparse cadence throttled, not frozen', () => {
    // The page ticked -- so it was alive -- but at a fraction of the rate.
    // This is the shape the design doc predicts and the one that rules out a
    // held-open connection while leaving a discrete poll usable.
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 3 })).toBe('throttled');
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 1 })).toBe('throttled');
  });

  it('calls no ticks at all frozen', () => {
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 0 })).toBe('frozen');
  });

  /**
   * THE BOUNDARY BETWEEN NORMAL AND THROTTLED IS THE ONE THAT PICKS A
   * TRANSPORT, so it is pinned on both sides rather than left to a
   * comparison that happens to be true.
   */
  it('draws the normal/throttled line at two thirds of the expected ticks', () => {
    const expected = 30_000 / tickMs; // 15
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 10 })).toBe('normal');
    expect(classifyLockProbe({ hiddenMs: 30_000, ticksInside: 9 })).toBe('throttled');
    expect(Math.ceil(expected * (2 / 3))).toBe(10);
  });
});
