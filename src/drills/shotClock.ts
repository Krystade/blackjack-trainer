/**
 * The optional shot clock (R1, docs/BACKLOG.md).
 *
 * R1's telemetry half measures how long a decision took. This is the other
 * half: a limit you have to beat. The reason it matters is the one R1 opens
 * with -- what predicts survival at a table is not whether you can WORK OUT the
 * right play, it is whether you already know it. An untimed drill cannot tell
 * those apart, because given long enough almost anyone re-derives the chart, and
 * a learner grinding out 95% at nine seconds a card reads as fluent while being
 * nothing of the kind.
 *
 * Running out of time is therefore a graded outcome, not a nudge: the card
 * counts as missed, goes back into the spaced-repetition deck as a miss, and is
 * tallied under its own `timeout` mistake class rather than being folded into
 * the wrong-play taxonomy. You did not choose the wrong play. You did not choose.
 *
 * OFF BY DEFAULT (`0`). Speed pressure applied before accuracy exists inflates
 * in-drill scores without improving retained skill -- the same finding that made
 * R2's competence gate default to on -- so this is something you switch on when
 * the accuracy is already there.
 *
 * DELIBERATELY SMALL. The countdown bar is a CSS animation keyed to the card, so
 * nothing here ticks, and no helper exists to compute a bar width that CSS is
 * already computing. What is left is the decision the drills actually have to
 * make -- is the clock on, and is this answer late -- plus the option list.
 *
 * Pure: no clock is read here. The caller owns elapsed time (via
 * `performance.now()`, as the R1 latency capture already does) and passes it in.
 */

/** The limit is off. Kept as a name so `=== 0` never reads as a magic number. */
export const SHOT_CLOCK_OFF = 0;

/**
 * The limits offered in Settings, in ms.
 *
 * Three, and spread wide, because the interesting question is which order of
 * magnitude you are in, not whether you need six seconds or seven. Eight seconds
 * is roomy enough to be a backstop against freezing; three is tight enough that
 * only recall can beat it.
 */
export const SHOT_CLOCK_OPTIONS: readonly number[] = [SHOT_CLOCK_OFF, 3000, 5000, 8000];

export function shotClockLabel(ms: number): string {
  if (!shotClockOn(ms)) return 'Off';
  return `${ms / 1000}s`;
}

/**
 * True when the limit is on at all.
 *
 * A nonsense negative limit (only reachable from a corrupt settings blob) reads
 * as OFF rather than as on-and-already-expired. The alternative failure mode is
 * the bad one: every card timing out the instant it is drawn, with the drill
 * unusable and nothing on screen saying why.
 */
export function shotClockOn(limitMs: number): boolean {
  return limitMs > SHOT_CLOCK_OFF;
}

/**
 * Whether an answer is late, judged on MEASURED elapsed time.
 *
 * The drills fire a `setTimeout` for the limit, but they ask this before
 * grading a timeout rather than trusting that the timer fired on schedule.
 * Background tabs throttle timers hard -- a three-second timer in a backgrounded
 * tab can fire many seconds late -- so the timer is a prompt to check, and the
 * measurement is the answer. (Late is still late, so a throttled timer reaches
 * the same verdict; what this buys is that the recorded `elapsedMs` is the real
 * one, and that a timer which somehow fires early cannot grade a timeout.)
 *
 * `>=`, not `>`: at exactly the limit the time is gone. The boundary is
 * arbitrary either way at millisecond resolution, but a rule stated once beats
 * two drill views disagreeing about it.
 */
export function shotClockExpired(elapsedMs: number, limitMs: number): boolean {
  if (!shotClockOn(limitMs)) return false;
  return elapsedMs >= limitMs;
}
