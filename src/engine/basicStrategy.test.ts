import { describe, it, expect } from 'vitest';
import { HARD, SOFT, PAIRS, upIndex, chartLookup } from './basicStrategy';
import type { Card } from './cards';
import type { ChartAction } from './basicStrategy';

describe('basicStrategy', () => {
  describe('HARD chart', () => {
    const HARD_EXPECT = [
      '4:H H H H H H H H H H', '5:H H H H H H H H H H', '6:H H H H H H H H H H',
      '7:H H H H H H H H H H', '8:H H H H H H H H H H',
      '9:H Dh Dh Dh Dh H H H H H',
      '10:Dh Dh Dh Dh Dh Dh Dh Dh H H',
      '11:Dh Dh Dh Dh Dh Dh Dh Dh Dh Dh',
      '12:H H S S S H H H H H',
      '13:S S S S S H H H H H', '14:S S S S S H H H H H',
      '15:S S S S S H H H Rh Rh',
      '16:S S S S S H H Rh Rh Rh',
      '17:S S S S S S S S S Rs',
      '18:S S S S S S S S S S', '19:S S S S S S S S S S',
      '20:S S S S S S S S S S', '21:S S S S S S S S S S',
    ];

    HARD_EXPECT.forEach((line) => {
      const [total, ...actions] = line.split(':').flatMap((s) => s.trim().split(/\s+/));
      const totalNum = parseInt(total, 10);

      it(`HARD ${total}`, () => {
        const expected = actions.slice(0, 10);
        const actual = HARD[totalNum].map((a) => a);
        expect(actual).toEqual(expected);
      });
    });
  });

  describe('SOFT chart', () => {
    const SOFT_EXPECT = [
      '13:H H H Dh Dh H H H H H', '14:H H H Dh Dh H H H H H',
      '15:H H Dh Dh Dh H H H H H', '16:H H Dh Dh Dh H H H H H',
      '17:H Dh Dh Dh Dh H H H H H',
      '18:Ds Ds Ds Ds Ds S S H H H',
      '19:S S S S Ds S S S S S',
      '20:S S S S S S S S S S', '21:S S S S S S S S S S',
    ];

    SOFT_EXPECT.forEach((line) => {
      const [total, ...actions] = line.split(':').flatMap((s) => s.trim().split(/\s+/));
      const totalNum = parseInt(total, 10);

      it(`SOFT ${total}`, () => {
        const expected = actions.slice(0, 10);
        const actual = SOFT[totalNum].map((a) => a);
        expect(actual).toEqual(expected);
      });
    });
  });

  describe('PAIRS chart', () => {
    const PAIRS_EXPECT = [
      '2:Ph Ph P P P P H H H H', '3:Ph Ph P P P P H H H H',
      '4:H H H Ph Ph H H H H H', '6:Ph P P P P H H H H H',
      '7:P P P P P P H H H H', '8:P P P P P P P P P Rp',
      '9:P P P P P S P P S S', 'A:P P P P P P P P P P',
    ];

    PAIRS_EXPECT.forEach((line) => {
      const parts = line.split(':');
      const rankStr = parts[0].trim();
      const actions = parts[1].trim().split(/\s+/);

      it(`PAIRS ${rankStr}`, () => {
        const expected = actions.slice(0, 10);
        const chartRow = (PAIRS as any)[rankStr];
        expect(chartRow).toBeDefined();
        const actual = chartRow!.map((a: ChartAction) => a);
        expect(actual).toEqual(expected);
      });
    });
  });

  describe('upIndex', () => {
    it('maps numeric ranks correctly', () => {
      expect(upIndex('2')).toBe(0);
      expect(upIndex('3')).toBe(1);
      expect(upIndex('4')).toBe(2);
      expect(upIndex('5')).toBe(3);
      expect(upIndex('6')).toBe(4);
      expect(upIndex('7')).toBe(5);
      expect(upIndex('8')).toBe(6);
      expect(upIndex('9')).toBe(7);
    });

    it('maps 10 and face cards to 8', () => {
      expect(upIndex('10')).toBe(8);
      expect(upIndex('J')).toBe(8);
      expect(upIndex('Q')).toBe(8);
      expect(upIndex('K')).toBe(8);
    });

    it('maps Ace to 9', () => {
      expect(upIndex('A')).toBe(9);
    });
  });

  describe('chartLookup', () => {
    it('(K,6) v 9 → Rh (hard 16)', () => {
      const cards: Card[] = [
        { rank: 'K', suit: 'h' },
        { rank: '6', suit: 's' },
      ];
      expect(chartLookup(cards, '9')).toBe('Rh');
    });

    it('(A,7) v 2 → Ds (soft 18)', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'h' },
        { rank: '7', suit: 's' },
      ];
      expect(chartLookup(cards, '2')).toBe('Ds');
    });

    it('(8,8) v A → Rp (pair of 8s)', () => {
      const cards: Card[] = [
        { rank: '8', suit: 'h' },
        { rank: '8', suit: 's' },
      ];
      expect(chartLookup(cards, 'A')).toBe('Rp');
    });

    it('(K,Q) v 6 → S (hard 20, ten-pair falls through)', () => {
      const cards: Card[] = [
        { rank: 'K', suit: 'h' },
        { rank: 'Q', suit: 's' },
      ];
      expect(chartLookup(cards, '6')).toBe('S');
    });

    it('(5,5) v 6 → Dh (hard 10, five-pair falls through)', () => {
      const cards: Card[] = [
        { rank: '5', suit: 'h' },
        { rank: '5', suit: 's' },
      ];
      expect(chartLookup(cards, '6')).toBe('Dh');
    });

    it('(A,4) v 4 → Dh (soft 15)', () => {
      const cards: Card[] = [
        { rank: 'A', suit: 'h' },
        { rank: '4', suit: 's' },
      ];
      expect(chartLookup(cards, '4')).toBe('Dh');
    });

    it('(2,2) v 2 → Ph (pair of 2s)', () => {
      const cards: Card[] = [
        { rank: '2', suit: 'h' },
        { rank: '2', suit: 's' },
      ];
      expect(chartLookup(cards, '2')).toBe('Ph');
    });

    it('3-card (5,4,7)=16 v 10 → Rh (hard 16, card-count agnostic)', () => {
      const cards: Card[] = [
        { rank: '5', suit: 'h' },
        { rank: '4', suit: 's' },
        { rank: '7', suit: 'd' },
      ];
      expect(chartLookup(cards, '10')).toBe('Rh');
    });
  });
});
