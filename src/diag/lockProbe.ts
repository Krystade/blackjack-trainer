/**
 * Does the page keep running while the phone is locked?
 *
 * WHY THIS NEEDS ITS OWN CLOCK. The obvious test -- "if nothing is
 * timestamped inside the locked window, iOS froze the page" -- cannot
 * discriminate. A field-test step that has finished speaking and is waiting
 * for an answer runs no timer at all, so a frozen page and an idle page write
 * the same nothing. The one periodic row in the app is the recogniser
 * heartbeat (`useVoiceControl.ts`), gated on the microphone being open, which
 * it is on eight of thirty-two steps. Safari has no `freeze`/`resume` events
 * either (`environment.ts`), so the pattern in the rows is the only signal.
 *
 * So the probe step ticks on its own interval, and this file is the
 * arithmetic that turns the ticks that landed while the screen was off into
 * one of three verdicts -- which is the whole of what the live-link design
 * (`docs/research/2026-09-27-live-field-test-link.md` §4, §5.1) waits on:
 *
 *   normal     the page kept its cadence: a held-open stream can be tried.
 *   throttled  the page ticked, but sparsely: alive, timers deferred. Rules
 *              out a held-open connection; a discrete poll on the step
 *              cadence still works.
 *   frozen     JS stopped for at least half the window. No transport survives.
 *
 * ON THE GAPS, NOT THE COUNT. The first version counted ticks, and that
 * cannot tell frozen from throttled: a page frozen for the whole window
 * fires its one overdue interval callback on resume, usually before
 * `visibilitychange` is delivered, so it counted one tick inside the window
 * and was called throttled. A page that ran for four seconds and was then
 * suspended for twenty-six counted two. The largest gap between consecutive
 * events -- the lock, each tick, the unlock -- is what says whether anything
 * ran, and for how long it did not.
 *
 * A fourth verdict, `frozen-unloaded`, is stamped by the runner rather than
 * here: the page was killed outright and came back as a new session, so
 * there was nobody left to do this arithmetic at the time.
 *
 * WHAT IT DOES NOT DO: end on a timer. Its timers are the thing under test,
 * and a bare timeout would score "the operator never locked it" as normal.
 * It ends on the screen coming back, or on the next boot finding the marker
 * still set.
 */

export const LOCK_PROBE_TICK_MS = 2000;

/**
 * The largest gap that still counts as keeping time: one dropped tick plus
 * the slop a background interval has. iOS coalesces hidden-page timers to
 * about a second; that is well inside this.
 */
const NORMAL_MAX_GAP_TICKS = 2.5;

/** A gap covering this much of the window is the page not running. */
const FROZEN_GAP_FRACTION = 0.5;

export type LockProbeVerdict = 'normal' | 'throttled' | 'frozen' | 'too-short';

export interface LockProbeReading {
  verdict: LockProbeVerdict;
  /** The longest stretch with no tick, counting the lock and unlock as events. */
  maxGapMs: number;
  /** Ticks that landed strictly inside the window. */
  ticksInside: number;
}

export function classifyLockProbe(input: {
  hiddenMs: number;
  /** Tick times as ms since the page went hidden; outside the window is ignored. */
  ticks: readonly number[];
  tickMs?: number;
}): LockProbeReading {
  const tickMs = input.tickMs ?? LOCK_PROBE_TICK_MS;
  const inside = input.ticks.filter((t) => t > 0 && t < input.hiddenMs).sort((a, b) => a - b);
  let maxGapMs = 0;
  let prev = 0;
  for (const t of [...inside, input.hiddenMs]) {
    if (t - prev > maxGapMs) maxGapMs = t - prev;
    prev = t;
  }
  const reading = (verdict: LockProbeVerdict): LockProbeReading => ({
    verdict,
    maxGapMs,
    ticksInside: inside.length,
  });
  // Fewer than two ticks' worth of window and the gaps say nothing either
  // way: one tick could land or miss on interval slop alone.
  if (input.hiddenMs < tickMs * 2) return reading('too-short');
  // Cadence first: on a short window a single normal gap is also half of it.
  if (maxGapMs <= tickMs * NORMAL_MAX_GAP_TICKS) return reading('normal');
  if (maxGapMs >= input.hiddenMs * FROZEN_GAP_FRACTION) return reading('frozen');
  return reading('throttled');
}
