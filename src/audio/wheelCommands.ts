/**
 * The steering wheel, wired to whatever drill is on screen.
 *
 * WHY THIS EXISTS AT ALL. The operator's actual use is practising while
 * driving, and until now that forced a choice between two halves of it:
 *
 *   - microphone ON  -> answering by voice works, but opening the mic switches
 *     the car from its media profile to its hands-free CALL profile, so the
 *     wheel's buttons go to that "call" and not to this app. (The car even
 *     displays the app as a phone call. See audio/carControls.ts.)
 *   - microphone OFF -> the wheel reaches the app, but nothing could answer.
 *
 * The 2026-09-11 drive settled the half that could not be settled from a desk:
 * the wheel DOES reach the app, and this car sends `nexttrack` and `pause` when
 * a button is pressed. So the second row is now the interesting one -- a drill
 * that can be advanced from the wheel needs no microphone, which means no call
 * route, which means the wheel keeps working. Both halves at once, by giving up
 * the thing that was breaking them.
 *
 * A wheel press is deliberately NOT its own vocabulary. It maps onto the
 * affirmative the voice path already has -- "yes" -- so every screen that can
 * be driven by voice can be driven by the wheel with one line, and the two can
 * never drift into meaning different things.
 *
 * Module-level rather than context, for the same reason speech.ts is: the
 * Media Session handler is registered once, deep inside the audio layer, and
 * has no React tree to read from when the car calls it.
 */

/** What a press means. One entry today; the shape is here so a second button
 * (a real "no", if a car turns out to send one) does not need a refactor. */
export type WheelCommand = 'advance';

type WheelHandler = (command: WheelCommand) => void;

let handler: WheelHandler | null = null;

/**
 * Claim the wheel for the screen that is currently up.
 *
 * Last claim wins, and passing `null` releases it. A screen that releases
 * leaves the wheel inert rather than pointing at a screen the driver has left
 * -- an advance delivered to an unmounted drill would either do nothing or,
 * worse, record an answer for a hand nobody is looking at.
 */
export function setWheelCommandHandler(next: WheelHandler | null): void {
  handler = next;
}

/**
 * Deliver a press. Returns whether anything was listening, so the caller can
 * tell "handled" from "nothing on screen wanted it" -- the log records both,
 * and a press that reached nobody is itself evidence about the mapping.
 */
export function invokeWheelCommand(command: WheelCommand): boolean {
  if (!handler) return false;
  try {
    handler(command);
  } catch {
    // A screen throwing must never break the car's transport controls: the
    // driver may be relying on pause to shut the app up.
    return false;
  }
  return true;
}

/** Test-only: drop any claim. */
export function _resetWheelCommandsForTest(): void {
  handler = null;
}
