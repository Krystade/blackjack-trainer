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
 * THE TICKS BEFORE `hidden` COUNT TOO. iOS can deliver `visibilitychange:
 * hidden` on the way BACK, when the page resumes, so the window it reports is
 * a few hundred milliseconds and everything that happened under the lock sits
 * before it -- and the overdue interval callback can fire before the event
 * as well, so the last tick before `hidden` may itself be the catch-up tick.
 * The `hidden` event is not proof that anything ran; the ticks are. So the
 * window starts at the last tick before the event -- or one tick earlier,
 * when the gap ahead of that last tick is over cadence and the tick itself
 * landed within a cadence of the event: that last tick is the overdue
 * callback, and the freeze is the gap before it. The caller feeds the ticks
 * since the page was last scored; an older stall with ticks after it is not
 * this lock's and does not move the start.
 *
 * ONE GAP OVER CADENCE, WITH AT MOST ONE TICK AFTER IT, IS A FREEZE however
 * long the page kept cadence first. iOS suspends the web process some
 * seconds after the lock; twenty seconds of cadence and then ten of nothing
 * is a page that froze late, not one that "ticked, but sparsely", and the
 * overdue callback that fires on resume -- before or after `visible` -- is
 * the one tick a frozen page produces. Judging the freeze by the largest
 * gap against half the window made the verdict depend on how long the
 * operator waited before unlocking.
 *
 * TWO MORE VERDICTS ARE STAMPED BY THE RUNNER rather than here, because the
 * page was killed outright and came back as a new session, so there was
 * nobody left to do this arithmetic at the time. `frozen-unloaded` is a
 * marker that recorded a lock and then died under it. `unloaded-no-hidden` is
 * a marker that never recorded one: the page died on the step with no
 * `hidden` event ever delivered, which is a force-quit with the screen on, or
 * iOS swallowing the event, and there is no telling those apart from in here.
 * That one is NOT a verdict about the lock -- it shares the `classification`
 * field with these, and can even follow a real verdict for the same step. It
 * is the row that separates "no lock reading from this leg" from "this leg
 * never reached the step", which were the same silence.
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
  /** The longest stretch with no tick, from the window's start to the unlock. */
  maxGapMs: number;
  /** Ticks that landed strictly inside the window. */
  ticksInside: number;
  /** How long before `hidden` the window's start tick landed; 0 when none had. */
  gapBeforeHiddenMs: number;
}

export function classifyLockProbe(input: {
  hiddenMs: number;
  /** Tick times as ms since the page went hidden; those before it (<= 0) count as the start. */
  ticks: readonly number[];
  tickMs?: number;
}): LockProbeReading {
  const tickMs = input.tickMs ?? LOCK_PROBE_TICK_MS;
  const normalGapMs = tickMs * NORMAL_MAX_GAP_TICKS;
  const inside = input.ticks.filter((t) => t > 0 && t < input.hiddenMs).sort((a, b) => a - b);
  const before = input.ticks.filter((t) => t <= 0).sort((a, b) => a - b);
  // The last tick before `hidden` -- or the one before it, when the last
  // tick is the overdue callback landing just ahead of a late event.
  let start = 0;
  if (before.length > 0) {
    const last = before[before.length - 1]!;
    const prev = before.length > 1 ? before[before.length - 2]! : undefined;
    start =
      prev !== undefined && last - prev > normalGapMs && -last <= normalGapMs ? prev : last;
  }
  const spanMs = input.hiddenMs - start;
  const events = [...before.filter((t) => t > start), ...inside, input.hiddenMs];
  let maxGapMs = 0;
  let gapsOverCadence = 0;
  let ticksAfterLastBigGap = 0;
  let prev = start;
  for (const [i, t] of events.entries()) {
    const gap = t - prev;
    if (gap > maxGapMs) maxGapMs = gap;
    if (gap > normalGapMs) {
      gapsOverCadence += 1;
      // Ticks after this gap: the events past it, less the unlock itself.
      ticksAfterLastBigGap = events.length - 1 - i;
    }
    prev = t;
  }
  const reading = (verdict: LockProbeVerdict): LockProbeReading => ({
    verdict,
    maxGapMs,
    ticksInside: inside.length,
    gapBeforeHiddenMs: Math.abs(start),
  });
  // A span no longer than the gap a running page is allowed cannot hold an
  // over-cadence gap at all, so it cannot tell frozen from running: with no
  // tick in it the one gap IS the span, and it would read normal.
  if (spanMs <= normalGapMs) return reading('too-short');
  // Cadence first: on a short span a single normal gap is also half of it.
  if (maxGapMs <= normalGapMs) return reading('normal');
  if (maxGapMs >= spanMs * FROZEN_GAP_FRACTION) return reading('frozen');
  // One hole, and at most the overdue callback after it: the page stopped
  // and did not run again until the unlock.
  if (gapsOverCadence === 1 && ticksAfterLastBigGap <= 1) return reading('frozen');
  return reading('throttled');
}
