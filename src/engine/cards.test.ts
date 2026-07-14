import { expect, test, describe } from 'vitest';
import { Card, Rank, Shoe, rankValue, mulberry32, RANKS } from './cards';

describe('rankValue', () => {
  test('A returns 11', () => {
    expect(rankValue('A')).toBe(11);
  });

  test('10, J, Q, K return 10', () => {
    expect(rankValue('10')).toBe(10);
    expect(rankValue('J')).toBe(10);
    expect(rankValue('Q')).toBe(10);
    expect(rankValue('K')).toBe(10);
  });

  test('2-9 return face value', () => {
    expect(rankValue('2')).toBe(2);
    expect(rankValue('3')).toBe(3);
    expect(rankValue('4')).toBe(4);
    expect(rankValue('5')).toBe(5);
    expect(rankValue('6')).toBe(6);
    expect(rankValue('7')).toBe(7);
    expect(rankValue('8')).toBe(8);
    expect(rankValue('9')).toBe(9);
  });
});

describe('mulberry32', () => {
  test('same seed produces identical sequence', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  test('different seed produces different sequence', () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(43);

    const seq1 = Array.from({ length: 20 }, () => rng1());
    const seq2 = Array.from({ length: 20 }, () => rng2());

    expect(seq1).not.toEqual(seq2);
  });

  test('returns values in [0, 1)', () => {
    const rng = mulberry32(100);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

describe('Shoe', () => {
  test('fresh 6-deck shoe has 312 cards remaining', () => {
    const shoe = new Shoe({});
    expect(shoe.cardsRemaining).toBe(312);
  });

  test('drawing a card decreases cardsRemaining and increases cardsDealt', () => {
    const shoe = new Shoe({});
    const initialRemaining = shoe.cardsRemaining;
    const initialDealt = shoe.cardsDealt;

    shoe.draw();

    expect(shoe.cardsRemaining).toBe(initialRemaining - 1);
    expect(shoe.cardsDealt).toBe(initialDealt + 1);
  });

  test('drawing all 312 cards yields exactly 24 of each rank', () => {
    const shoe = new Shoe({ seed: 123 });
    const rankCounts = new Map<Rank, number>();

    // Initialize counts
    for (const rank of RANKS) {
      rankCounts.set(rank, 0);
    }

    // Draw all cards
    for (let i = 0; i < 312; i++) {
      const card = shoe.draw();
      rankCounts.set(card.rank, (rankCounts.get(card.rank) ?? 0) + 1);
    }

    // Each rank should appear exactly 24 times (4 suits × 6 decks)
    for (const rank of RANKS) {
      expect(rankCounts.get(rank)).toBe(24);
    }
  });

  test('throws when drawing from empty shoe', () => {
    const shoe = new Shoe({ decks: 1, penetration: 1 });

    // Draw all 52 cards
    for (let i = 0; i < 52; i++) {
      shoe.draw();
    }

    // Next draw should throw
    expect(() => shoe.draw()).toThrow();
  });

  describe('decksRemaining', () => {
    test('312 cards remaining → 6 decks', () => {
      const shoe = new Shoe({});
      expect(shoe.decksRemaining).toBe(6);
    });

    test('286 cards remaining → 5.5 decks', () => {
      const shoe = new Shoe({});
      // Draw 26 cards to get 286 remaining
      for (let i = 0; i < 26; i++) {
        shoe.draw();
      }
      expect(shoe.decksRemaining).toBe(5.5);
    });

    test('13 cards remaining → 0.5 decks', () => {
      const shoe = new Shoe({});
      // Draw 299 cards to get 13 remaining
      for (let i = 0; i < 299; i++) {
        shoe.draw();
      }
      expect(shoe.decksRemaining).toBe(0.5);
    });

    test('3 cards remaining → 0.5 decks (minimum)', () => {
      const shoe = new Shoe({});
      // Draw 309 cards to get 3 remaining
      for (let i = 0; i < 309; i++) {
        shoe.draw();
      }
      expect(shoe.decksRemaining).toBe(0.5);
    });

    test('1 card remaining → 0.5 decks (minimum)', () => {
      const shoe = new Shoe({});
      // Draw 311 cards to get 1 remaining
      for (let i = 0; i < 311; i++) {
        shoe.draw();
      }
      expect(shoe.decksRemaining).toBe(0.5);
    });
  });

  describe('cutCardReached', () => {
    test('false when dealt < 234 (6*52*0.75)', () => {
      const shoe = new Shoe({});
      // Draw 233 cards
      for (let i = 0; i < 233; i++) {
        shoe.draw();
      }
      expect(shoe.cutCardReached).toBe(false);
    });

    test('true when dealt >= 234', () => {
      const shoe = new Shoe({});
      // Draw 234 cards
      for (let i = 0; i < 234; i++) {
        shoe.draw();
      }
      expect(shoe.cutCardReached).toBe(true);
    });

    test('true when dealt > 234', () => {
      const shoe = new Shoe({});
      // Draw 235 cards
      for (let i = 0; i < 235; i++) {
        shoe.draw();
      }
      expect(shoe.cutCardReached).toBe(true);
    });
  });

  test('shuffle() restores full shoe', () => {
    const shoe = new Shoe({});
    // Draw some cards
    for (let i = 0; i < 50; i++) {
      shoe.draw();
    }
    expect(shoe.cardsRemaining).toBe(262);
    expect(shoe.cardsDealt).toBe(50);

    // Shuffle
    shoe.shuffle();

    expect(shoe.cardsRemaining).toBe(312);
    expect(shoe.cardsDealt).toBe(0);
  });

  test('custom deck count', () => {
    const shoe = new Shoe({ decks: 2 });
    expect(shoe.cardsRemaining).toBe(104); // 2 * 52
  });

  test('custom penetration affects cutCardReached threshold', () => {
    const shoe = new Shoe({ decks: 1, penetration: 0.5 });
    // At 0.5 penetration, cutCardReached at 26 (1*52*0.5)
    for (let i = 0; i < 25; i++) {
      shoe.draw();
    }
    expect(shoe.cutCardReached).toBe(false);

    shoe.draw();
    expect(shoe.cutCardReached).toBe(true);
  });

  test('same seed produces identical shuffle order', () => {
    const shoe1 = new Shoe({ seed: 999 });
    const shoe2 = new Shoe({ seed: 999 });

    const cards1 = [];
    const cards2 = [];

    for (let i = 0; i < 20; i++) {
      cards1.push(shoe1.draw());
      cards2.push(shoe2.draw());
    }

    expect(cards1).toEqual(cards2);
  });

  test('different seed produces different shuffle order', () => {
    const shoe1 = new Shoe({ seed: 999 });
    const shoe2 = new Shoe({ seed: 1000 });

    const cards1 = [];
    const cards2 = [];

    for (let i = 0; i < 20; i++) {
      cards1.push(shoe1.draw());
      cards2.push(shoe2.draw());
    }

    expect(cards1).not.toEqual(cards2);
  });
});
