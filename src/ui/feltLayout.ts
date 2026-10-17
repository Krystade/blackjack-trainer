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

/* B2 #33: two hands on one row at 375px drop every card to ~57px as soon as
 * either hand draws a third card, while the felt below sits empty. Below
 * WRAP_BELOW_PX the two hands take a row each instead (feltWrap.css): label
 * and bet beside the cards, tighter padding, and a lower cap so the extra row
 * costs as little height as it can. Three or more hands keep one row. */
export const WRAP_BELOW_PX = 70;
export const WRAPPED_CARD_MAX_PX = 70;

/** One hand on its own row (feltWrap.css): 8 row padding, 10 hand padding and
 * border, a 44px side column and its 6px gap, 4 per gap between cards. */
export function handFeltRow(cardCount: number): FeltRow {
  const slots = Math.max(2, cardCount);
  return { slots, fixedPx: 8 + 10 + 44 + 6 + 4 * (slots - 1) };
}

export function wrappedCardWidthAt(row: FeltRow, viewportPx: number): number {
  const w = (Math.min(viewportPx, FELT_MAX_PX) - row.fixedPx) / row.slots;
  return Math.min(WRAPPED_CARD_MAX_PX, Math.max(CARD_MIN_PX, w));
}

export interface PlayerFeltLayout {
  /** True when each hand takes its own row. */
  wrap: boolean;
  /** The one-row figures (what the row uses when it does not wrap). */
  row: FeltRow;
  /** Per hand, the row that hand's cards are sized from. */
  hands: FeltRow[];
}

export function playerFeltLayout(cardCounts: readonly number[], viewportPx: number): PlayerFeltLayout {
  const row = playerFeltRow(cardCounts);
  const wrap = cardCounts.length === 2 && cardWidthAt(row, viewportPx) < WRAP_BELOW_PX;
  return { wrap, row, hands: cardCounts.map((n) => (wrap ? handFeltRow(n) : row)) };
}
