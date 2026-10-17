import { describe, it, expect } from 'vitest';
import { playerFeltRow, dealerFeltRow, cardWidthAt, CARD_MIN_PX, CARD_MAX_PX, playerFeltLayout, handFeltRow, wrappedCardWidthAt } from './feltLayout';

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

describe('playerFeltLayout (B2 #33): two hands take a row each rather than drop below 70px', () => {
  const widths = (counts: number[], vw: number) => {
    const l = playerFeltLayout(counts, vw);
    return l.hands.map((row) => (l.wrap ? wrappedCardWidthAt(row, vw) : cardWidthAt(row, vw)));
  };
  it('two dealt hands stay on one row', () => {
    expect(playerFeltLayout([2, 2], 375).wrap).toBe(false);
    expect(widths([2, 2], 375).every((w) => w >= 70)).toBe(true);
  });
  it('a hit that would shrink both hands below 70 puts each on its own row, every card 70px or more', () => {
    for (const counts of [[3, 2], [2, 3], [4, 2], [3, 3], [3, 4], [4, 4]]) {
      expect(playerFeltLayout(counts, 375).wrap, `${counts}`).toBe(true);
      for (const w of widths(counts, 375)) expect(w, `${counts}`).toBeGreaterThanOrEqual(70);
    }
  });
  it('each wrapped hand fits the width on its own (the side column included)', () => {
    for (const n of [2, 3, 4, 5, 6]) {
      const row = handFeltRow(n);
      expect(wrappedCardWidthAt(row, 375) * row.slots + row.fixedPx).toBeLessThanOrEqual(375);
    }
  });
  it('one hand, three hands, and a wide screen keep the single row', () => {
    expect(playerFeltLayout([5], 375).wrap).toBe(false);
    expect(playerFeltLayout([3, 2, 2], 375).wrap).toBe(false);
    expect(playerFeltLayout([3, 2], 480).wrap).toBe(false);
  });
  it('unwrapped, every hand reads the row', () => {
    const l = playerFeltLayout([2, 2], 375);
    expect(l.hands).toEqual([l.row, l.row]);
  });
});
