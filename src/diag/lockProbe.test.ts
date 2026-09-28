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

  it('calls a window no longer than a normal gap inconclusive, whatever landed in it', () => {
    expect(classifyLockProbe({ hiddenMs: tick, ticks: [] }).verdict).toBe('too-short');
    expect(classifyLockProbe({ hiddenMs: tick * 2 - 1, ticks: [tick] }).verdict).toBe(
      'too-short',
    );
    // A frozen page under a lock shorter than the allowed gap: no tick, and
    // the one gap is the whole span. That read `normal` when the bound was
    // two ticks and the allowed gap two and a half.
    expect(classifyLockProbe({ hiddenMs: 4_500, ticks: [] }).verdict).toBe('too-short');
    expect(classifyLockProbe({ hiddenMs: 4_800, ticks: [4_700] }).verdict).toBe('too-short');
    expect(classifyLockProbe({ hiddenMs: 3_000, ticks: [-1_900] }).verdict).toBe('too-short');
    // Just past the allowed gap is enough to say something, either way.
    expect(classifyLockProbe({ hiddenMs: 5_001, ticks: [] }).verdict).toBe('frozen');
    expect(classifyLockProbe({ hiddenMs: 5_001, ticks: [tick, tick * 2] }).verdict).toBe(
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

  /**
   * iOS suspends the web process some seconds after the lock. Cadence for
   * twenty seconds and then nothing is a page that froze late; the old rule
   * (largest gap against half the window) called it throttled or frozen
   * depending on how long the operator waited before unlocking.
   */
  it('calls a page that kept cadence and then stopped for good frozen, however late it stopped', () => {
    expect(
      classifyLockProbe({ hiddenMs: 30_000, ticks: cadence(tick, 20_001) }).verdict,
    ).toBe('frozen');
    // ...with the overdue callback landing on resume, just before `visible`
    // (the usual order, per the header): still one hole, still frozen.
    expect(
      classifyLockProbe({ hiddenMs: 30_000, ticks: [...cadence(tick, 20_001), 29_900] }).verdict,
    ).toBe('frozen');
    expect(
      classifyLockProbe({ hiddenMs: 60_000, ticks: [...cadence(tick, 40_001), 59_900] }).verdict,
    ).toBe('frozen');
    // Two ticks after the hole is a page that came back and kept going: not
    // a freeze, whatever the hole's size short of half the window.
    expect(
      classifyLockProbe({ hiddenMs: 30_000, ticks: [...cadence(tick, 20_001), 27_900, 29_900] })
        .verdict,
    ).toBe('throttled');
    // ...but one hole in the middle with the cadence back afterwards is not
    // a freeze (the boundary test below pins the half-window rule for it).
    expect(
      classifyLockProbe({
        hiddenMs: 30_000,
        ticks: [...cadence(tick, 10_001), ...cadence(20_000, 30_000)],
      }).verdict,
    ).toBe('throttled');
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

  it('ignores ticks after the window, and counts only those inside it', () => {
    const v = classifyLockProbe({
      hiddenMs: 30_000,
      ticks: [-2_000, -1, ...cadence(tick, 30_000), 30_000, 31_000],
    });
    expect(v.verdict).toBe('normal');
    expect(v.ticksInside).toBe(14);
    expect(v.gapBeforeHiddenMs).toBe(1);
  });

  /**
   * A `hidden` DELIVERED ON THE WAY BACK. iOS can hand the event over when
   * the page resumes, so the window is a few hundred milliseconds and the
   * whole lock sits before it. The last tick before the event is the last
   * time anything ran, and the span runs from there.
   */
  it('calls a lock whose hidden event arrived on resume frozen, from the tick before it', () => {
    const v = classifyLockProbe({ hiddenMs: 300, ticks: [-30_000, 250] });
    expect(v).toMatchObject({ verdict: 'frozen', gapBeforeHiddenMs: 30_000 });
    expect(v.maxGapMs).toBe(30_250);
    // The overdue callback can fire BEFORE the late `hidden` too. Then the
    // last tick before the event is the catch-up tick, and the window has to
    // start where the cadence broke, not at that tick.
    const early = classifyLockProbe({ hiddenMs: 300, ticks: [-34_000, -32_000, -30_050, -50] });
    expect(early).toMatchObject({ verdict: 'frozen', gapBeforeHiddenMs: 30_050 });
    expect(early.maxGapMs).toBe(30_000);
    // An older stall with the cadence back after it is not this lock's: the
    // window still starts at the last tick, and a normal lock reads normal.
    const stale = classifyLockProbe({
      hiddenMs: 30_000,
      ticks: [-60_000, -52_000, ...cadence(-50_000, 1), ...cadence(tick, 30_000)],
    });
    expect(stale).toMatchObject({ verdict: 'normal', gapBeforeHiddenMs: 0 });
    // ...but a short window with a fresh tick before it is still inconclusive.
    expect(classifyLockProbe({ hiddenMs: 300, ticks: [-500] }).verdict).toBe('too-short');
    // A tick before hidden at cadence does not turn a normal lock into anything else.
    expect(
      classifyLockProbe({ hiddenMs: 30_000, ticks: [-1_500, ...cadence(tick, 30_000)] }).verdict,
    ).toBe('normal');
  });
});
