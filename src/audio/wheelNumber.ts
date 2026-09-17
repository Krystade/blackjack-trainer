/**
 * Entering a NUMBER with two buttons.
 *
 * WHY THIS IS NEEDED. In a car the microphone and the steering wheel are
 * mutually exclusive: opening the mic flips the Bluetooth link from A2DP to
 * HFP, the car decides the phone is on a call, and every wheel button goes to
 * that call instead of to the browser (audio/carControls.ts). So a drill that
 * is playable with the wheel is a drill playable with no microphone at all --
 * and the count drills ask for a number, which one affirmative button cannot
 * say. The request was explicit (operator, 2026-09-16): use the wheel buttons,
 * "next or prev", to enter the running and true counts.
 *
 * THE SCHEME. Forward is plus one, back is minus one, and quiet means "done".
 * A standing proposal accumulates while the buttons are being pressed; a short
 * silence gets it read back out loud; a longer silence submits it. Nothing is
 * ever submitted that has not first been spoken, which is the same
 * propose-and-confirm contract the voice path runs on -- with silence standing
 * in for the "yes", because there is no third button to say it with.
 *
 * WHY THE TWO DELAYS ARE WHAT THEY ARE. The gap between them is the only
 * chance to correct a mistake, and it is a chance taken with eyes on the road:
 * the readback has to land early enough that the rest of the window is usable,
 * and the window has to be long enough to react in. Hence a readback at 0.9s
 * and a commit at 3s, leaving about two seconds after hearing "plus four" to
 * press again if it should have been five. Pressing during that window
 * restarts BOTH -- a correction is just more entry.
 *
 * ONE PRESS IS ONE UNIT, deliberately, with no acceleration on a fast
 * double-press. Eyes-free, a control whose step size depends on how quickly
 * you happened to press it is a control you cannot aim; the counts these
 * drills produce sit in single digits, and being certain about four presses
 * beats being fast and wrong.
 *
 * Pure and clock-injected for the same reason voiceControl.ts is: the whole
 * value of it is in the timing, and timing tested through a real setTimeout is
 * timing tested by waiting.
 */

/** Quiet time before the standing proposal is read back out loud. */
export const READBACK_MS = 900;

/**
 * Quiet time before it is submitted.
 *
 * Measured from the last press, not from the readback, so the correction
 * window is a fixed thing the operator can learn rather than something that
 * moves with how long the readback took to say.
 */
export const COMMIT_MS = 3000;

export interface WheelNumberDeps<H> {
  /** Injected `setTimeout`. */
  schedule: (fn: () => void, ms: number) => H;
  /** Injected `clearTimeout`. */
  cancel: (handle: H) => void;
  /** Say the standing proposal. */
  readback: (value: number) => void;
  /** Submit it. */
  commit: (value: number) => void;
  /**
   * Constrain the proposal, e.g. a countdown tag that can only be -1, 0 or 1.
   * Applied on every press, so the readback can never name a value the drill
   * would refuse.
   */
  clamp?: (value: number) => number;
}

export interface WheelNumberEntry {
  /** Nudge the proposal. Returns the value now standing. */
  press: (direction: 'forward' | 'back') => number;
  /** The standing proposal, or null when nothing is being entered. */
  value: () => number | null;
  /** Abandon it -- a phase change, a new question, a screen being left. */
  reset: () => void;
}

export function createWheelNumberEntry<H>(deps: WheelNumberDeps<H>): WheelNumberEntry {
  let value: number | null = null;
  let readbackHandle: H | null = null;
  let commitHandle: H | null = null;

  const clearTimers = (): void => {
    if (readbackHandle !== null) {
      deps.cancel(readbackHandle);
      readbackHandle = null;
    }
    if (commitHandle !== null) {
      deps.cancel(commitHandle);
      commitHandle = null;
    }
  };

  const reset = (): void => {
    clearTimers();
    value = null;
  };

  const press = (direction: 'forward' | 'back'): number => {
    const next = (value ?? 0) + (direction === 'forward' ? 1 : -1);
    value = deps.clamp ? deps.clamp(next) : next;

    // BOTH timers restart on every press, and the commit one is the important
    // half: a proposal that submitted itself while a finger was still moving
    // would grade an answer the operator was in the middle of correcting.
    clearTimers();
    const entered = value;
    readbackHandle = deps.schedule(() => {
      readbackHandle = null;
      deps.readback(entered);
    }, READBACK_MS);
    commitHandle = deps.schedule(() => {
      commitHandle = null;
      // Cleared BEFORE the callback, not after: a commit handler that starts
      // the next question would otherwise find the old proposal still
      // standing and offer it as an answer to a different card.
      value = null;
      deps.commit(entered);
    }, COMMIT_MS);

    return value;
  };

  return { press, value: () => value, reset };
}
