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

/**
 * Wave A F3: no shot clock while the drill is being answered eyes-free or out
 * loud. The prompt alone takes 1.5-3.5s to say and a spoken answer has a mic
 * tail on top, so a 3s clock expired before the question had finished -- and
 * a driver cannot glance at a countdown bar anyway.
 */
export function shotClockSuspended(eyesFree: boolean, voiceOn: boolean): boolean {
  return eyesFree || voiceOn;
}

/**
 * Wave A (s09): consecutive timeouts after which the clock stops instead of
 * grading. The first unanswered card is a real timeout; the second in a row
 * means nobody is there (phone down, a glance at traffic), and grading every
 * card that goes by as a miss filled Stats with idle time. The SECOND expiry is
 * not graded: the clock stops and waits for an answer.
 */
export const SHOT_CLOCK_IDLE_AFTER = 2;

/** What to do with an expiry, given how many came straight before it. */
export function expiryVerdict(consecutiveBefore: number): 'grade' | 'stop' {
  return consecutiveBefore + 1 >= SHOT_CLOCK_IDLE_AFTER ? 'stop' : 'grade';
}

/**
 * Wave A (s09): reading time before the next card's clock starts, after a
 * miss in visual mode. The next card is dealt the moment you answer, under a
 * 3-4 line correction; with the clock running from the deal, reading the
 * correction timed out the next card. A right answer has nothing to read.
 */
export const CORRECTION_READ_GRACE_MS = 2500;

export function readGraceMs(lastWasMiss: boolean): number {
  return lastWasMiss ? CORRECTION_READ_GRACE_MS : 0;
}

/**
 * Wave A review: whether an answer was given under a RUNNING shot clock, for
 * Stats' timed/untimed split (V5-2). A limit set in Settings is not enough:
 * eyes-free and voice suspend the clock, and the answer that restarts a clock
 * stopped for idleness was given with none running.
 */
export function answeredUnderShotClock(limitMs: number, suspended: boolean, idle: boolean): boolean {
  return shotClockOn(limitMs) && !suspended && !idle;
}

/**
 * Wave A review: the answer time to record for a card dealt under a miss's
 * correction (`graceMs` from readGraceMs). The seconds spent reading the
 * correction are not answer time -- the same reasoning that starts the answer
 * clock at a spoken prompt's end -- so the grace comes off. But the split
 * between reading and answering cannot be seen, so the answer is never
 * credited as faster than the grace itself (or than the raw time, if that was
 * shorter): a tap 2.6s after the deal was not a 0.1s answer. Monotone, so a
 * later answer never records less.
 */
export function answerElapsedMs(rawMs: number, graceMs: number): number {
  if (graceMs <= 0) return rawMs;
  return Math.max(rawMs - graceMs, Math.min(rawMs, graceMs));
}
