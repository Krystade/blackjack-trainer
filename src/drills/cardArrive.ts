/**
 * Wave A review (s04): how a flashed count card arrives.
 *
 * Every card is a fresh element (CountDrillView keys it by position), so an
 * identical card dealt next to itself still visibly arrives. Two things the
 * fixed 220ms card-deal-in did not cover:
 *
 * - Fast pace. Timed Challenge ramps down to 150ms a card; a 220ms fade from
 *   opacity 0 replaced every card before it was fully shown, which measured
 *   reading a half-faded card instead of counting speed. The arrival is a
 *   quarter of the card's time at most.
 * - Reduced motion. No deal-in runs at all there, so the same card twice
 *   changed nothing on screen. A short blank before each card -- opacity, no
 *   movement -- marks the new card instead.
 */

/** The deal-in's normal length (app.css card-deal-in). */
export const DEAL_IN_MS = 220;
/** The longest blank before a card under reduced motion. */
export const BLANK_MAX_MS = 80;
/** Two frames at 60Hz: the shortest blank that is still seen. */
const BLANK_MIN_MS = 34;

export function cardArrival(onScreenMs: number): { arriveMs: number; blankMs: number } {
  if (!Number.isFinite(onScreenMs) || onScreenMs <= 0) return { arriveMs: DEAL_IN_MS, blankMs: BLANK_MAX_MS };
  const quarter = Math.floor(onScreenMs / 4);
  return {
    arriveMs: Math.min(DEAL_IN_MS, quarter),
    blankMs: Math.min(BLANK_MAX_MS, Math.max(BLANK_MIN_MS, Math.min(quarter, Math.round(onScreenMs / 5)))),
  };
}
