import { describe, it, expect } from 'vitest';
import { trueCount } from '../engine/count';
import { makeTrueCountQuestion } from './trueCountDrill';

describe('makeTrueCountQuestion', () => {
  it('should be deterministic per seed', () => {
    const q1 = makeTrueCountQuestion(42);
    const q2 = makeTrueCountQuestion(42);
    expect(q1).toEqual(q2);
  });

  it('should produce different results for different seeds', () => {
    const q1 = makeTrueCountQuestion(1);
    const q2 = makeTrueCountQuestion(2);
    expect(q1).not.toEqual(q2);
  });

  it('correctTc should always equal engine trueCount(runningCount, decksRemaining) (anti-drift, 500 seeded questions)', () => {
    for (let i = 0; i < 500; i++) {
      const q = makeTrueCountQuestion(100000 + i);
      expect(q.correctTc).toBe(trueCount(q.runningCount, q.decksRemaining));
    }
  });

  it('decksRemaining should always be a valid half-deck >= 0.5 across 500 seeded questions', () => {
    for (let i = 0; i < 500; i++) {
      const q = makeTrueCountQuestion(200000 + i);
      expect(q.decksRemaining).toBeGreaterThanOrEqual(0.5);
      // half-deck granularity: doubled value must be an integer
      expect(Number.isInteger(q.decksRemaining * 2)).toBe(true);
    }
  });

  it('decksRemaining should never exceed the default maxDecks (6) across 500 seeded questions', () => {
    for (let i = 0; i < 500; i++) {
      const q = makeTrueCountQuestion(300000 + i);
      expect(q.decksRemaining).toBeLessThanOrEqual(6);
    }
  });

  it('decksRemaining should respect a custom maxDecks option', () => {
    for (let i = 0; i < 200; i++) {
      const q = makeTrueCountQuestion(400000 + i, { maxDecks: 2 });
      expect(q.decksRemaining).toBeGreaterThanOrEqual(0.5);
      expect(q.decksRemaining).toBeLessThanOrEqual(2);
    }
  });

  it('the distribution of runningCount should actually vary (not constant) over 100 seeded draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      seen.add(makeTrueCountQuestion(500000 + i).runningCount);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('the distribution of decksRemaining should actually vary (not constant) over 100 seeded draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      seen.add(makeTrueCountQuestion(600000 + i).decksRemaining);
    }
    expect(seen.size).toBeGreaterThan(3);
  });
});
