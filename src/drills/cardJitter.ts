import { mulberry32 } from '../engine/cards';

/**
 * R9 / red-team #7 (docs/BACKLOG.md): "messy" card presentation. Real dealers
 * don't lay cards in a neat, upright, centered row; software-trained counters
 * report that the tidy on-screen stream doesn't transfer because "the glimpse
 * is totally different". This applies a small, seeded, deterministic rotation
 * + offset per card so the visual-recognition half of counting (find + read a
 * messy scatter at a glance) gets trained too, not just the arithmetic half.
 *
 * Pure and seeded: the same (seed, index) always yields the same jitter, so a
 * re-render never reshuffles the scatter and tests can pin it exactly.
 */
export interface CardJitter {
  rotateDeg: number;
  dxRem: number;
  dyRem: number;
}

/** Max absolute rotation (degrees) and translation (rem) — kept small so cards
 * stay readable and non-overlapping enough to count, just no longer robotically
 * aligned. */
export const JITTER_MAX_ROT_DEG = 8;
export const JITTER_MAX_SHIFT_REM = 0.35;

/**
 * Deterministic per-card jitter. `index` is decorrelated into the seed (a large
 * odd multiplier) so adjacent cards in the same round get visibly different
 * transforms rather than a smooth gradient.
 */
export function cardJitter(seed: number, index: number): CardJitter {
  const rng = mulberry32((seed + index * 0x9e3779b1) >>> 0);
  const rotateDeg = (rng() * 2 - 1) * JITTER_MAX_ROT_DEG;
  const dxRem = (rng() * 2 - 1) * JITTER_MAX_SHIFT_REM;
  const dyRem = (rng() * 2 - 1) * JITTER_MAX_SHIFT_REM;
  return { rotateDeg, dxRem, dyRem };
}

/** CSS transform string for a jitter (a plain object so callers can spread it
 * into an inline `style`). */
export function jitterTransform(j: CardJitter): string {
  return `translate(${j.dxRem.toFixed(3)}rem, ${j.dyRem.toFixed(3)}rem) rotate(${j.rotateDeg.toFixed(2)}deg)`;
}
