/* B5/W4 (spec 2026-10-16): how wide a card can be on the felt.
 *
 * The same numbers drive src/ui/components/cardSize.css: Table.tsx hands the
 * row's slot count and fixed chrome to CSS as --felt-slots / --felt-fixed, and
 * the CSS clamp mirrors cardWidthAt. Change one, change the other. */

export const CARD_MIN_PX = 32;
export const CARD_MAX_PX = 84;
/** The felt never lays out wider than this (the app column's cap). */
const FELT_MAX_PX = 480;

export interface FeltRow {
  /** Card widths the row has to hold (a hand always reserves two). */
  slots: number;
  /** Pixels of chrome in the row that are not cards. */
  fixedPx: number;
}

/** Player row: 24 row padding, 20 per hand (padding + border), 4 per gap
 * between cards in a hand, 16 per gap between hands (app.css). */
export function playerFeltRow(cardCounts: readonly number[]): FeltRow {
  const counts = cardCounts.length ? cardCounts : [2];
  const hands = counts.length;
  const slots = counts.reduce((s, n) => s + Math.max(2, n), 0);
  return { slots, fixedPx: 24 + 20 * hands + 4 * (slots - hands) + 16 * (hands - 1) };
}

/** Dealer row: 24 row padding and an 8px gap between cards. */
export function dealerFeltRow(cardCount: number): FeltRow {
  const slots = Math.max(2, cardCount);
  return { slots, fixedPx: 24 + 8 * (slots - 1) };
}

export function cardWidthAt(row: FeltRow, viewportPx: number): number {
  const w = (Math.min(viewportPx, FELT_MAX_PX) - row.fixedPx) / row.slots;
  return Math.min(CARD_MAX_PX, Math.max(CARD_MIN_PX, w));
}
