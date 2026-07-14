import { describe, it, expect } from 'vitest';
import type { Card } from './cards';
import { handValue, isBust, isBlackjack, isPair, pairRank } from './hand';

describe('handValue', () => {
  it('A+K = {21, soft} and blackjack', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'h' },
    ];
    expect(handValue(cards)).toEqual({ total: 21, soft: true });
  });

  it('A+A = {12, soft}', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
    ];
    expect(handValue(cards)).toEqual({ total: 12, soft: true });
  });

  it('A+A+9 = {21, soft}', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
      { rank: '9', suit: 'd' },
    ];
    expect(handValue(cards)).toEqual({ total: 21, soft: true });
  });

  it('A+9+9 = {19, hard}', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: '9', suit: 'h' },
      { rank: '9', suit: 'd' },
    ];
    expect(handValue(cards)).toEqual({ total: 19, soft: false });
  });

  it('5+5 = {10, hard}', () => {
    const cards: Card[] = [
      { rank: '5', suit: 's' },
      { rank: '5', suit: 'h' },
    ];
    expect(handValue(cards)).toEqual({ total: 10, soft: false });
  });

  it('A+6+9 = {16, hard} (ace demoted, soft flag off)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: '6', suit: 'h' },
      { rank: '9', suit: 'd' },
    ];
    expect(handValue(cards)).toEqual({ total: 16, soft: false });
  });
});

describe('isBust', () => {
  it('10+J+Q = bust (total > 21)', () => {
    const cards: Card[] = [
      { rank: '10', suit: 's' },
      { rank: 'J', suit: 'h' },
      { rank: 'Q', suit: 'd' },
    ];
    expect(isBust(cards)).toBe(true);
  });

  it('A+K is not bust', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'h' },
    ];
    expect(isBust(cards)).toBe(false);
  });
});

describe('isBlackjack', () => {
  it('A+K = blackjack (exactly 2 cards totaling 21)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'K', suit: 'h' },
    ];
    expect(isBlackjack(cards)).toBe(true);
  });

  it('A+A+9 is not blackjack (not exactly 2 cards)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
      { rank: '9', suit: 'd' },
    ];
    expect(isBlackjack(cards)).toBe(false);
  });

  it('A+9 is not blackjack (total 20, not 21)', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: '9', suit: 'h' },
    ];
    expect(isBlackjack(cards)).toBe(false);
  });
});

describe('isPair', () => {
  it('5+5 is a pair', () => {
    const cards: Card[] = [
      { rank: '5', suit: 's' },
      { rank: '5', suit: 'h' },
    ];
    expect(isPair(cards)).toBe(true);
  });

  it('K+Q is a pair (10-value pair)', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 's' },
      { rank: 'Q', suit: 'h' },
    ];
    expect(isPair(cards)).toBe(true);
  });

  it('A+A is a pair', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
    ];
    expect(isPair(cards)).toBe(true);
  });

  it('7+8 is not a pair', () => {
    const cards: Card[] = [
      { rank: '7', suit: 's' },
      { rank: '8', suit: 'h' },
    ];
    expect(isPair(cards)).toBe(false);
  });

  it('10+J is a pair (both ten-values)', () => {
    const cards: Card[] = [
      { rank: '10', suit: 's' },
      { rank: 'J', suit: 'h' },
    ];
    expect(isPair(cards)).toBe(true);
  });

  it('must have exactly 2 cards to be a pair', () => {
    const cards: Card[] = [
      { rank: '5', suit: 's' },
      { rank: '5', suit: 'h' },
      { rank: '5', suit: 'd' },
    ];
    expect(isPair(cards)).toBe(false);
  });
});

describe('pairRank', () => {
  it('5+5 pairRank = "5"', () => {
    const cards: Card[] = [
      { rank: '5', suit: 's' },
      { rank: '5', suit: 'h' },
    ];
    expect(pairRank(cards)).toBe('5');
  });

  it('K+Q pairRank = "10" (normalized ten-value pair)', () => {
    const cards: Card[] = [
      { rank: 'K', suit: 's' },
      { rank: 'Q', suit: 'h' },
    ];
    expect(pairRank(cards)).toBe('10');
  });

  it('A+A pairRank = "A"', () => {
    const cards: Card[] = [
      { rank: 'A', suit: 's' },
      { rank: 'A', suit: 'h' },
    ];
    expect(pairRank(cards)).toBe('A');
  });

  it('10+J pairRank = "10" (normalized ten-value pair)', () => {
    const cards: Card[] = [
      { rank: '10', suit: 's' },
      { rank: 'J', suit: 'h' },
    ];
    expect(pairRank(cards)).toBe('10');
  });

  it('7+8 returns null (not a pair)', () => {
    const cards: Card[] = [
      { rank: '7', suit: 's' },
      { rank: '8', suit: 'h' },
    ];
    expect(pairRank(cards)).toBeNull();
  });

  it('not a pair (3 cards) returns null', () => {
    const cards: Card[] = [
      { rank: '5', suit: 's' },
      { rank: '5', suit: 'h' },
      { rank: '5', suit: 'd' },
    ];
    expect(pairRank(cards)).toBeNull();
  });
});
