import { describe, it, expect } from 'vitest';
import { playerFeltRow, dealerFeltRow, cardWidthAt, CARD_MIN_PX, CARD_MAX_PX } from './feltLayout';

const fits = (counts: number[], vw: number) => {
  const row = playerFeltRow(counts);
  return cardWidthAt(row, vw) * row.slots + row.fixedPx <= vw;
};

describe('feltLayout (B5/W4)', () => {
  it('reserves exactly the felt chrome app.css draws (row padding, hand padding+border, card and hand gaps)', () => {
    expect(playerFeltRow([2])).toEqual({ slots: 2, fixedPx: 24 + 20 + 4 });
    expect(playerFeltRow([2, 2])).toEqual({ slots: 4, fixedPx: 24 + 40 + 8 + 16 });
    expect(playerFeltRow([2, 2, 2])).toEqual({ slots: 6, fixedPx: 24 + 60 + 12 + 32 });
    expect(dealerFeltRow(3)).toEqual({ slots: 3, fixedPx: 24 + 16 });
  });
  it('one or two dealt hands get cards at least 70px wide at 375', () => {
    expect(cardWidthAt(playerFeltRow([2]), 375)).toBeGreaterThanOrEqual(70);
    expect(cardWidthAt(playerFeltRow([2, 2]), 375)).toBeGreaterThanOrEqual(70);
    expect(cardWidthAt(dealerFeltRow(2), 375)).toBeGreaterThanOrEqual(70);
  });
  it('never grows past the cap on a wide screen', () => {
    expect(cardWidthAt(playerFeltRow([2]), 480)).toBe(CARD_MAX_PX);
  });
  it('shrinks for more hands and more cards, and the row still fits at 375', () => {
    expect(cardWidthAt(playerFeltRow([2, 2, 2]), 375)).toBeLessThan(70);
    for (const counts of [[2, 2, 2], [3, 3], [5], [6, 2]]) expect(fits(counts, 375)).toBe(true);
    expect(cardWidthAt(dealerFeltRow(7), 375) * 7 + dealerFeltRow(7).fixedPx).toBeLessThanOrEqual(375);
  });
  it('past one row it bottoms out at the floor, and any single hand still fits the width (the row wraps, never scrolls)', () => {
    for (const counts of [[2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]) {
      const w = cardWidthAt(playerFeltRow(counts), 375);
      expect(w).toBe(CARD_MIN_PX);
      const widest = Math.max(...counts);
      expect(w * widest + playerFeltRow([widest]).fixedPx).toBeLessThanOrEqual(375);
    }
  });
  it('counts an empty felt as one two-card hand', () => {
    expect(playerFeltRow([])).toEqual(playerFeltRow([2]));
  });
});
