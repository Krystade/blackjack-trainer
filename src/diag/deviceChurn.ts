/**
 * When the audio inputs last changed underneath us.
 *
 * ONE NUMBER, to separate two very different failures. From the 2026-10-04
 * drive:
 *
 *   21:11:19.107  route inputs        reason=listen-on count=1 labels="iPhone Microphone"
 *   21:11:21.353  mic session-error   error=audio-capture sessionMs=2287
 *
 * The Corolla was in that list a minute before and gone by the time the
 * session opened, and two seconds later the microphone could not be read. The
 * error line carried no sign of it, so `audio-capture` reads as an
 * unexplained hardware failure -- and in a car that is the ONE reading that
 * does not need explaining, because the Bluetooth input disappearing under a
 * live session is routine.
 *
 * `audio-capture` two seconds after a device change is the car. The same error
 * out of a clear sky is a real fault. Only the second deserves a hunt.
 *
 * MODULE-LEVEL because the event is a property of the device, not of any
 * recogniser: the inputs change while nothing is listening, and the next
 * session that fails wants to know how long ago that was.
 */
let lastChangedAt: number | null = null;

/** Called from every `devicechange` the app hears. */
export function markInputDeviceChanged(at: number): void {
  lastChangedAt = at;
}

/**
 * Milliseconds since the inputs last changed, or null if they never have.
 *
 * Never negative: a clock that steps backwards is not evidence of anything,
 * and a negative age in an export invites exactly the wrong theory.
 */
export function msSinceInputDeviceChanged(now: number): number | null {
  if (lastChangedAt === null) return null;
  return Math.max(0, now - lastChangedAt);
}

/** Test-only: a device nothing has happened to yet. */
export function _resetDeviceChurnForTest(): void {
  lastChangedAt = null;
}
