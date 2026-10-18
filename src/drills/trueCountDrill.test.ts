import { describe, it, expect } from 'vitest';
import { trueCount } from '../engine/count';
import { mulberry32 } from '../engine/cards';
import { makeDefaultProfile } from '../store/profiles';
import { trayFloorDecks } from './betSizing';
import { makeTrueCountQuestion, trueCountDrillDepths } from './trueCountDrill';

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

describe('runningCount range (#54)', () => {
  it('is symmetric -15..+15 and reaches both ends', () => {
    let min = Infinity;
    let max = -Infinity;
    let neg = 0;
    for (let i = 0; i < 2000; i++) {
      const rc = makeTrueCountQuestion(700000 + i).runningCount;
      min = Math.min(min, rc);
      max = Math.max(max, rc);
      if (rc < 0) neg++;
    }
    expect(min).toBe(-15);
    expect(max).toBe(15);
    expect(neg / 2000).toBeGreaterThan(0.4);
  });
});

/**
 * Wave E E3 (W2-12): trays the profile's table can actually show, and more of
 * the depths missed lately.
 */
describe('reachable depths, weighted to misses (E3)', () => {
  const profile = makeDefaultProfile();

  /** The pre-E3 generator, verbatim: the seed-identity baseline. */
  function legacy(seed: number, maxDecks = 6) {
    const rng = mulberry32(seed);
    const runningCount = -15 + Math.floor(rng() * 31);
    const decksRemaining = (Math.floor(rng() * Math.round(maxDecks * 2)) + 1) * 0.5;
    return { runningCount, decksRemaining, correctTc: trueCount(runningCount, decksRemaining) };
  }

  it('10k questions on the default 6D 75% profile never go below its cut floor, and reach it', () => {
    const floor = trayFloorDecks(profile);
    expect(floor).toBe(1.5);
    const opts = trueCountDrillDepths(profile, profile.rules.decks);
    const seen = new Set<number>();
    for (let seed = 0; seed < 10_000; seed++) {
      const q = makeTrueCountQuestion(seed, opts);
      expect(q.decksRemaining).toBeGreaterThanOrEqual(floor);
      expect(q.decksRemaining).toBeLessThanOrEqual(6);
      expect(Number.isInteger(q.decksRemaining * 2)).toBe(true);
      expect(q.correctTc).toBe(trueCount(q.runningCount, q.decksRemaining));
      seen.add(q.decksRemaining);
    }
    // Every half deck from the floor to the full shoe still comes up.
    expect([...seen].sort((a, b) => a - b)).toEqual([1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
  });

  it('every miss at 2.5 decks: P(2.5) is at least twice its uniform share', () => {
    const opts = trueCountDrillDepths(profile, 6);
    // 50 rows: one miss, every other answer right and spread over the shoe.
    const history = [
      ...Array.from({ length: 49 }, (_, i) => ({ decksRemaining: 1.5 + 0.5 * (i % 10), correct: true })),
      { decksRemaining: 2.5, correct: false },
    ];
    const n = 10_000;
    let at = 0;
    let atPlain = 0;
    for (let seed = 0; seed < n; seed++) {
      if (makeTrueCountQuestion(seed, { ...opts, history }).decksRemaining === 2.5) at++;
      if (makeTrueCountQuestion(seed, opts).decksRemaining === 2.5) atPlain++;
    }
    const uniform = 1 / 10;
    expect(at / n).toBeGreaterThanOrEqual(2 * uniform);
    // The control: without the history the same seeds land near uniform.
    expect(atPlain / n).toBeLessThan(1.3 * uniform);
  });

  it('only the last 50 rows count: a miss older than that is forgotten', () => {
    const opts = trueCountDrillDepths(profile, 6);
    const old = [{ decksRemaining: 2.5, correct: false }];
    const recent = Array.from({ length: 50 }, () => ({ decksRemaining: 4, correct: true }));
    for (let seed = 0; seed < 300; seed++) {
      expect(makeTrueCountQuestion(seed, { ...opts, history: [...old, ...recent] })).toEqual(
        makeTrueCountQuestion(seed, opts),
      );
    }
  });

  it('with no history and the floor at 0.5, the output is seed-identical to the old generator', () => {
    for (let seed = 0; seed < 2000; seed++) {
      expect(makeTrueCountQuestion(seed, { minDecks: 0.5, history: [] })).toEqual(legacy(seed));
      expect(makeTrueCountQuestion(seed, { maxDecks: 2 })).toEqual(legacy(seed, 2));
    }
  });

  it('a Max decks stepper at or below the floor asks for shallow trays, and gets them', () => {
    expect(trueCountDrillDepths(profile, 1)).toEqual({ minDecks: 0.5, maxDecks: 1 });
    expect(trueCountDrillDepths(profile, 8)).toEqual({ minDecks: 1.5, maxDecks: 8 });
  });
});
