/**
 * Does the page keep running while the phone is locked?
 *
 * WHY THIS NEEDS ITS OWN CLOCK. The obvious test -- "if nothing is
 * timestamped inside the locked window, iOS froze the page" -- cannot
 * discriminate. A field-test step that has finished speaking and is waiting
 * for an answer runs no timer at all, so a frozen page and an idle page write
 * the same nothing. The one periodic row in the app is the recogniser
 * heartbeat (`useVoiceControl.ts`), gated on the microphone being open, which
 * it is on eight of thirty-one steps. Safari has no `freeze`/`resume` events
 * either (`environment.ts`), so the pattern in the rows is the only signal.
 *
 * So the probe step ticks on its own interval, and this file is the
 * arithmetic that turns "how many ticks landed while the screen was off" into
 * one of three verdicts -- which is the whole of what the live-link design
 * (`docs/research/2026-09-27-live-field-test-link.md` §4, §5.1) waits on:
 *
 *   normal     the page kept its cadence: a held-open stream can be tried.
 *   throttled  the page ticked, but sparsely: alive, timers deferred. Rules
 *              out a held-open connection; a discrete poll on the step
 *              cadence still works.
 *   frozen     nothing ticked: JS execution stopped. No transport survives.
 *
 * A fourth, `frozen-unloaded`, is stamped by the runner rather than here: the
 * page was killed outright and came back as a new session, so there was
 * nobody left to do this arithmetic at the time.
 *
 * WHAT IT DOES NOT DO: end on a timer. Its timers are the thing under test,
 * and a bare timeout would score "the operator never locked it" as normal.
 * It ends on the screen coming back, or on the next boot finding the marker
 * still set.
 */

export const LOCK_PROBE_TICK_MS = 2000;

/** How much of the expected cadence still counts as the page keeping time. */
const NORMAL_FRACTION = 2 / 3;

export type LockProbeVerdict = 'normal' | 'throttled' | 'frozen' | 'too-short';

export function classifyLockProbe(input: {
  hiddenMs: number;
  ticksInside: number;
  tickMs?: number;
}): LockProbeVerdict {
  const tickMs = input.tickMs ?? LOCK_PROBE_TICK_MS;
  // Fewer than two ticks' worth of window and the count says nothing either
  // way: one tick could land or miss on interval slop alone.
  if (input.hiddenMs < tickMs * 2) return 'too-short';
  if (input.ticksInside <= 0) return 'frozen';
  const expected = Math.floor(input.hiddenMs / tickMs);
  return input.ticksInside >= Math.ceil(expected * NORMAL_FRACTION) ? 'normal' : 'throttled';
}
