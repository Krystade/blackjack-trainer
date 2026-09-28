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
 * and this is the arithmetic that turns the ticks that landed while the
 * screen was off into a verdict. ON THE GAPS, NOT THE COUNT. The first
 * version counted ticks, and a page that was frozen for the whole window
 * fires its one overdue interval callback on resume -- before
 * `visibilitychange` is delivered -- so it counted one tick and was called
 * throttled. Frozen versus throttled is exactly the decision the live-link
 * design waits on, and a count cannot make it.
 */
describe('classifyLockProbe', () => {
  const tick = LOCK_PROBE_TICK_MS;
  /** Ticks every `tick` ms from `from` up to but not past `until`, with slop. */
  const cadence = (from: number, until: number, slop = 0) => {
    const out: number[] = [];
    for (let t = from; t < until; t += tick) out.push(t + slop);
    return out;
  };

  it('calls a window too short to hold two ticks inconclusive, whatever landed in it', () => {
    expect(classifyLockProbe({ hiddenMs: tick, ticks: [] }).verdict).toBe('too-short');
    expect(classifyLockProbe({ hiddenMs: tick * 2 - 1, ticks: [tick] }).verdict).toBe(
      'too-short',
    );
    // Exactly two ticks' worth is enough to say something.
    expect(classifyLockProbe({ hiddenMs: tick * 2, ticks: [tick, tick * 2 - 100] }).verdict).toBe(
      'normal',
    );
  });

  it('calls a full cadence normal, with the slop a real interval has', () => {
    expect(classifyLockProbe({ hiddenMs: 30_000, ticks: cadence(tick, 30_000, 150) })).toMatchObject(
      { verdict: 'normal', ticksInside: 14 },
    );
    // One dropped tick is still a page keeping time.
    const oneDropped = cadence(tick, 30_000).filter((t) => t !== tick * 5);
    expect(classifyLockProbe({ hiddenMs: 30_000, ticks: oneDropped }).verdict).toBe('normal');
  });

  /**
   * THE CATCH-UP TICK. A page frozen for the whole window fires its overdue
   * callback once on resume, usually before `visible` is delivered. That is
   * one tick inside the window and it means nothing ran.
   */
  it('calls one tick at the very end of the window frozen, not throttled', () => {
    const v = classifyLockProbe({ hiddenMs: 30_000, ticks: [29_900] });
    expect(v.verdict).toBe('frozen');
    expect(v.maxGapMs).toBe(29_900);
    expect(v.ticksInside).toBe(1);
  });

  it('calls a page that ran for a few seconds and then stopped frozen', () => {
    // iOS suspends the web process a few seconds after the lock: two ticks,
    // then nothing for the remaining twenty-six seconds.
    expect(classifyLockProbe({ hiddenMs: 30_000, ticks: [tick, tick * 2] }).verdict).toBe(
      'frozen',
    );
    expect(classifyLockProbe({ hiddenMs: 30_000, ticks: [] })).toMatchObject({
      verdict: 'frozen',
      maxGapMs: 30_000,
      ticksInside: 0,
    });
  });

  it('calls sparse ticks throttled: alive, but not keeping time', () => {
    // Every 8 s instead of every 2 s: no gap covers half the window, but every
    // gap is well past the cadence.
    expect(classifyLockProbe({ hiddenMs: 30_000, ticks: [8_000, 16_000, 24_000] }).verdict).toBe(
      'throttled',
    );
  });

  /**
   * THE TWO LINES THAT PICK A TRANSPORT are pinned on both sides rather than
   * left to a comparison that happens to be true.
   */
  it('draws normal/throttled at two and a half ticks, and throttled/frozen at half the window', () => {
    const withGap = (gap: number) => {
      // A full cadence with one hole of exactly `gap` ms starting at 10 s.
      const ticks = [...cadence(tick, 10_000 + 1), ...cadence(10_000 + gap, 30_000)];
      return classifyLockProbe({ hiddenMs: 30_000, ticks });
    };
    expect(withGap(tick * 2.5).verdict).toBe('normal');
    expect(withGap(tick * 2.5 + 1).verdict).toBe('throttled');
    expect(withGap(15_000 - 1).verdict).toBe('throttled');
    expect(withGap(15_000).verdict).toBe('frozen');
  });

  it('ignores ticks that fall outside the window', () => {
    const v = classifyLockProbe({
      hiddenMs: 30_000,
      ticks: [-2_000, -1, ...cadence(tick, 30_000), 30_000, 31_000],
    });
    expect(v.verdict).toBe('normal');
    expect(v.ticksInside).toBe(14);
  });
});
