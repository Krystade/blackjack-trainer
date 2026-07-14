import { describe, it, expect } from 'vitest';
import { RANKS, Shoe } from './cards';
import { hiLoTag, trueCount } from './count';

describe('hiLoTag', () => {
  it('returns +1 for 2-6', () => {
    expect(hiLoTag('2')).toBe(1);
    expect(hiLoTag('3')).toBe(1);
    expect(hiLoTag('4')).toBe(1);
    expect(hiLoTag('5')).toBe(1);
    expect(hiLoTag('6')).toBe(1);
  });

  it('returns 0 for 7-9', () => {
    expect(hiLoTag('7')).toBe(0);
    expect(hiLoTag('8')).toBe(0);
    expect(hiLoTag('9')).toBe(0);
  });

  it('returns -1 for 10/J/Q/K/A', () => {
    expect(hiLoTag('10')).toBe(-1);
    expect(hiLoTag('J')).toBe(-1);
    expect(hiLoTag('Q')).toBe(-1);
    expect(hiLoTag('K')).toBe(-1);
    expect(hiLoTag('A')).toBe(-1);
  });

  it('covers all 13 ranks', () => {
    RANKS.forEach((rank) => {
      const tag = hiLoTag(rank);
      expect(tag).toBeOneOf([-1, 0, 1]);
    });
  });
});

describe('full 6-deck shoe', () => {
  it('all tags sum to 0', () => {
    const shoe = new Shoe({ seed: 1, decks: 6 });
    let sum = 0;
    while (shoe.cardsRemaining > 0) {
      const card = shoe.draw();
      sum += hiLoTag(card.rank);
    }
    expect(sum).toBe(0);
  });
});

describe('trueCount', () => {
  it('trueCount(6, 3) = 2', () => {
    expect(trueCount(6, 3)).toBe(2);
  });

  it('trueCount(-3, 2) = -2 (floor toward -∞)', () => {
    expect(trueCount(-3, 2)).toBe(-2);
  });

  it('trueCount(5, 2) = 2 (2.5 → 2)', () => {
    expect(trueCount(5, 2)).toBe(2);
  });

  it('trueCount(3, 0.5) = 6', () => {
    expect(trueCount(3, 0.5)).toBe(6);
  });

  it('trueCount(0, 6) = 0', () => {
    expect(trueCount(0, 6)).toBe(0);
  });

  it('trueCount(3, 0.25) = 6 (clamps decks to min 0.5)', () => {
    expect(trueCount(3, 0.25)).toBe(6);
  });
});
