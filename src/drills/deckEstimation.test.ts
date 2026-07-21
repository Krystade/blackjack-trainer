import { describe, it, expect } from 'vitest';
import { makeDeckEstimationQuestion, gradeDeckEstimate } from './deckEstimation';

describe('makeDeckEstimationQuestion', () => {
  it('should be deterministic per seed', () => {
    const q1 = makeDeckEstimationQuestion(42);
    const q2 = makeDeckEstimationQuestion(42);
    expect(q1).toEqual(q2);
  });

  it('should produce different results for different seeds', () => {
    const q1 = makeDeckEstimationQuestion(1);
    const q2 = makeDeckEstimationQuestion(2);
    expect(q1).not.toEqual(q2);
  });

  it('decksRemaining should always equal (totalDecks*52 - cardsDealt)/52 across 500 seeded questions', () => {
    for (let i = 0; i < 500; i++) {
      const q = makeDeckEstimationQuestion(100000 + i);
      expect(q.decksRemaining).toBeCloseTo((q.totalDecks * 52 - q.cardsDealt) / 52, 10);
    }
  });

  it('defaults totalDecks to 6 when no opts given', () => {
    const q = makeDeckEstimationQuestion(7);
    expect(q.totalDecks).toBe(6);
  });

  it('respects a custom totalDecks option', () => {
    for (let i = 0; i < 200; i++) {
      const q = makeDeckEstimationQuestion(400000 + i, { totalDecks: 4 });
      expect(q.totalDecks).toBe(4);
      expect(q.cardsDealt).toBeGreaterThanOrEqual(0);
      expect(q.cardsDealt).toBeLessThanOrEqual(4 * 52);
    }
  });

  it('cardsDealt should never be degenerate (near-empty or near-full tray) across 500 seeded questions', () => {
    for (let i = 0; i < 500; i++) {
      const q = makeDeckEstimationQuestion(200000 + i);
      const totalCards = q.totalDecks * 52;
      // Not "~0" and not "the entire shoe" -- a realistic mid-shoe amount.
      expect(q.cardsDealt).toBeGreaterThan(totalCards * 0.05);
      expect(q.cardsDealt).toBeLessThan(totalCards * 0.95);
    }
  });

  it('the distribution of cardsDealt should actually vary (not constant) over 100 seeded draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      seen.add(makeDeckEstimationQuestion(500000 + i).cardsDealt);
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe('gradeDeckEstimate', () => {
  it('is correct with zero error when guess equals actual exactly', () => {
    const result = gradeDeckEstimate(3, 3);
    expect(result.correct).toBe(true);
    expect(result.errorDecks).toBe(0);
  });

  it('is correct exactly at the default 0.5-deck tolerance boundary (guess above actual)', () => {
    const result = gradeDeckEstimate(3.5, 3, 0.5);
    expect(result.correct).toBe(true);
    expect(result.errorDecks).toBeCloseTo(0.5, 10);
  });

  it('is correct exactly at the default 0.5-deck tolerance boundary (guess below actual)', () => {
    const result = gradeDeckEstimate(2.5, 3, 0.5);
    expect(result.correct).toBe(true);
    expect(result.errorDecks).toBeCloseTo(0.5, 10);
  });

  it('is correct just inside the tolerance boundary', () => {
    const result = gradeDeckEstimate(3.49, 3, 0.5);
    expect(result.correct).toBe(true);
    expect(result.errorDecks).toBeCloseTo(0.49, 10);
  });

  it('is wrong just outside the tolerance boundary', () => {
    const result = gradeDeckEstimate(3.51, 3, 0.5);
    expect(result.correct).toBe(false);
    expect(result.errorDecks).toBeCloseTo(0.51, 10);
  });

  it('uses a default tolerance of 0.5 decks when none is passed', () => {
    const withinDefault = gradeDeckEstimate(2.5, 2);
    const outsideDefault = gradeDeckEstimate(2.51, 2);
    expect(withinDefault.correct).toBe(true);
    expect(outsideDefault.correct).toBe(false);
  });

  it('respects a custom tolerance', () => {
    const withinCustom = gradeDeckEstimate(2.9, 2, 1);
    const outsideCustom = gradeDeckEstimate(1.05, 3, 1);
    expect(withinCustom.correct).toBe(true);
    expect(outsideCustom.correct).toBe(false);
  });

  it('errorDecks is the absolute difference regardless of guess direction', () => {
    const over = gradeDeckEstimate(4, 3);
    const under = gradeDeckEstimate(2, 3);
    expect(over.errorDecks).toBe(1);
    expect(under.errorDecks).toBe(1);
  });
});
