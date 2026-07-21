/**
 * Pure five-zone hit-test math for the eyes-free blind-tap input.
 *
 * No DOM, no React, no browser APIs — this module is 100% unit-testable
 * geometry. `src/ui/components/ZonePad.tsx` reads a pointer event's
 * coordinates relative to its own bounding rect and delegates every zone
 * decision to `hitTestZone`; it must contain no geometry of its own.
 *
 * Layout (fixed, never moves):
 *   top-left = hit, top-right = stand, bottom-left = double, bottom-right = split,
 *   center circle (radius = 0.22 * min(w, h)) = surrender — the circle takes
 *   priority over whichever quadrant it overlaps.
 *
 * `mode: 'insurance'` swaps the whole layout for a simple left/right split
 * (left = take, right = decline) with no center circle.
 */

export type ZoneId = 'hit' | 'stand' | 'double' | 'split' | 'surrender';
export type ZoneMode = 'action' | 'insurance';

export const ZONE_LABEL: Record<ZoneId, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

const CENTER_CIRCLE_RATIO = 0.22;

/** Center circle wins over the quadrants; radius = 0.22 * min(w, h). */
export function hitTestZone(
  x: number,
  y: number,
  w: number,
  h: number,
  mode: ZoneMode = 'action',
): ZoneId | 'take' | 'decline' {
  if (mode === 'insurance') {
    return x < w / 2 ? 'take' : 'decline';
  }

  const cx = w / 2;
  const cy = h / 2;
  const radius = CENTER_CIRCLE_RATIO * Math.min(w, h);
  const dx = x - cx;
  const dy = y - cy;
  if (dx * dx + dy * dy <= radius * radius) {
    return 'surrender';
  }

  const left = x < cx;
  const top = y < cy;
  if (left && top) return 'hit';
  if (!left && top) return 'stand';
  if (left && !top) return 'double';
  return 'split';
}
