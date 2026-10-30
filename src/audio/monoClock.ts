/**
 * B19: the clock for INTERVALS -- self-hearing suppression windows, echo
 * windows, session ages, time since the inputs changed.
 *
 * These were measured with Date.now(), the wall clock, and the wall clock is
 * corrected mid-drive (diagnosticLog.ts has a resync detector for exactly
 * that). A 3s step forward while the app is speaking ends the suppression
 * window early, and the car mic's copy of the prompt is graded as Jack's
 * answer -- the 2026-10-02 HIT mis-grade. performance.now() only moves
 * forward at a steady rate. Keep Date.now() for timestamps that are logged.
 *
 * Every side of one subtraction must use this same clock: a stamp taken with
 * one and read with the other is off by ~1.7e12 ms.
 */
export function monoNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}
