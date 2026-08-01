import { mulberry32 } from '../engine/cards';

/**
 * ET7 (docs/BACKLOG.md, experiential training): adversarial dealer-pace
 * pressure for the count drill. A real dealer doesn't keep a metronome pace --
 * they occasionally rip a burst of cards fast. This modulates the flash
 * interval with sudden, unpredictable SPEED-UP BURSTS that then RECOVER to the
 * normal pace (operator's choice), training you to hold the count through a
 * "fast dealer" spike. Distinct from the Timed Challenge (a smooth monotonic
 * ramp) and from D1/RV5 distractions (an interruption, not a pace change).
 *
 * PURE + SEEDED: `paceMultiplier(seed, index)` is deterministic, so a run is
 * reproducible and unit-testable; the CountDrillView multiplies its configured
 * per-card interval by this. Exactly one burst per window of `PACE_WINDOW`
 * cards, at a seeded position within the window, so bursts are frequent but
 * their timing can't be anticipated -- and every burst recovers before the next.
 */

/** Cards per window; each window contains exactly one burst. */
export const PACE_WINDOW = 8;
/** Burst length in cards. */
export const PACE_BURST_LEN = 3;
/** Interval multiplier during a burst (< 1 = faster). 0.4 => 2.5x dealer speed. */
export const PACE_BURST_MULT = 0.4;

/**
 * Interval multiplier for the card at `index`: `PACE_BURST_MULT` during a burst,
 * `1` at normal pace. The burst's position within each window is seeded, so it
 * moves unpredictably window to window but is fully reproducible for a run.
 */
export function paceMultiplier(seed: number, index: number): number {
  if (index < 0) return 1;
  const window = Math.floor(index / PACE_WINDOW);
  // Seeded start offset within the window, leaving room for the whole burst.
  const slots = PACE_WINDOW - PACE_BURST_LEN + 1;
  const offset = Math.floor(mulberry32((seed + window * 0x9e3779b1) >>> 0)() * slots);
  const posInWindow = index % PACE_WINDOW;
  const inBurst = posInWindow >= offset && posInWindow < offset + PACE_BURST_LEN;
  return inBurst ? PACE_BURST_MULT : 1;
}
