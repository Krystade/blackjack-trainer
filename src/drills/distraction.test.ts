import { describe, it, expect } from 'vitest';
import { makeDistraction, isDistractionPoint, isDistractionPointEvery, distractionSpeech, type DistractionDifficulty } from './distraction';

/**
 * Anti-drift parsing helper for tests only (mirrors the true-count drill's
 * "grade against the engine" discipline -- here there's no engine to defer
 * to, so the test itself re-derives the answer from the printed prompt
 * string and checks it matches `answer`, catching any drift between the
 * generator's arithmetic and what it prints).
 *
 * Near-count prompts may wrap a negative second operand in parentheses
 * (e.g. "-3 - (-6)") to keep the printed operand near the running count
 * without producing an ambiguous "- -6" double-sign; this parser accepts
 * both the plain and parenthesized forms.
 */
function parsePrompt(prompt: string): { a: number; op: '+' | '-' | '×'; b: number } {
  const m = prompt.match(/^(-?\d+) ([+\-×]) (\(-?\d+\)|\d+)$/);
  if (!m) {
    throw new Error(`prompt did not match expected clean format: "${prompt}"`);
  }
  const a = Number(m[1]);
  const op = m[2] as '+' | '-' | '×';
  const b = Number(m[3]!.replace(/[()]/g, ''));
  return { a, op, b };
}

function evalParsed(p: { a: number; op: '+' | '-' | '×'; b: number }): number {
  if (p.op === '+') return p.a + p.b;
  if (p.op === '-') return p.a - p.b;
  return p.a * p.b;
}

describe('makeDistraction', () => {
  it('is deterministic per seed (near-count)', () => {
    const d1 = makeDistraction(7, 'near-count', 42);
    const d2 = makeDistraction(7, 'near-count', 42);
    expect(d1).toEqual(d2);
  });

  it('is deterministic per seed (generic)', () => {
    const d1 = makeDistraction(7, 'generic', 42);
    const d2 = makeDistraction(7, 'generic', 42);
    expect(d1).toEqual(d2);
  });

  it('produces varied prompts across different seeds (near-count)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add(makeDistraction(7, 'near-count', i).prompt);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('produces varied prompts across different seeds (generic)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add(makeDistraction(7, 'generic', i).prompt);
    }
    expect(seen.size).toBeGreaterThan(5);
  });

  it('tags the kind field to match the requested mode', () => {
    expect(makeDistraction(3, 'near-count', 1).kind).toBe('near-count');
    expect(makeDistraction(3, 'generic', 1).kind).toBe('generic');
  });

  it('answer is always arithmetically correct for its prompt (anti-drift, near-count, sweep of counts x seeds)', () => {
    for (let rc = -20; rc <= 20; rc++) {
      for (let seed = 0; seed < 5; seed++) {
        const d = makeDistraction(rc, 'near-count', rc * 1000 + seed);
        const parsed = parsePrompt(d.prompt);
        expect(evalParsed(parsed)).toBe(d.answer);
      }
    }
  });

  it('answer is always arithmetically correct for its prompt (anti-drift, generic, sweep of counts x seeds)', () => {
    for (let rc = -20; rc <= 20; rc++) {
      for (let seed = 0; seed < 5; seed++) {
        const d = makeDistraction(rc, 'generic', rc * 1000 + seed + 500_000);
        const parsed = parsePrompt(d.prompt);
        expect(evalParsed(parsed)).toBe(d.answer);
      }
    }
  });

  it('near-count operands always land within the confusability window (+/-3) of the running count (sweep)', () => {
    const WINDOW = 3;
    for (let rc = -20; rc <= 20; rc++) {
      for (let seed = 0; seed < 5; seed++) {
        const d = makeDistraction(rc, 'near-count', rc * 2000 + seed);
        const parsed = parsePrompt(d.prompt);
        expect(Math.abs(parsed.a - rc)).toBeLessThanOrEqual(WINDOW);
        expect(Math.abs(parsed.b - rc)).toBeLessThanOrEqual(WINDOW);
      }
    }
  });

  it('near-count prompt strings are clean: no double spaces, always parseable', () => {
    for (let rc = -20; rc <= 20; rc += 4) {
      for (let seed = 0; seed < 5; seed++) {
        const d = makeDistraction(rc, 'near-count', rc * 3000 + seed);
        expect(d.prompt).not.toMatch(/ {2,}/);
        expect(() => parsePrompt(d.prompt)).not.toThrow();
      }
    }
  });

  it('handles a negative running count sanely: no raw double-minus artifacts', () => {
    for (let seed = 0; seed < 20; seed++) {
      const d = makeDistraction(-15, 'near-count', seed);
      expect(d.prompt).not.toMatch(/--/);
      const parsed = parsePrompt(d.prompt);
      expect(evalParsed(parsed)).toBe(d.answer);
    }
  });

  it('generic prompt strings are clean and use only +/x2 operators unrelated to the count', () => {
    for (let seed = 0; seed < 30; seed++) {
      const d = makeDistraction(7, 'generic', seed);
      expect(d.prompt).not.toMatch(/ {2,}/);
      const parsed = parsePrompt(d.prompt);
      expect(['+', '×']).toContain(parsed.op);
    }
  });

  it('generic operands stay within a small fixed range regardless of the running count (table-talk simulacrum, not count-keyed)', () => {
    for (const rc of [-20, -4, 0, 7, 20]) {
      for (let seed = 0; seed < 10; seed++) {
        const d = makeDistraction(rc, 'generic', seed);
        const parsed = parsePrompt(d.prompt);
        expect(parsed.a).toBeGreaterThanOrEqual(2);
        expect(parsed.a).toBeLessThanOrEqual(12);
        expect(parsed.b).toBeGreaterThanOrEqual(2);
        expect(parsed.b).toBeLessThanOrEqual(12);
      }
    }
  });
});

/**
 * D1 part 2 (docs/BACKLOG.md, distraction training): WHEN a card advance
 * should be interrupted by a distraction. Deliberately a fixed cadence (no
 * RNG) rather than a probabilistic roll -- the operator's ~15%/~7-cards
 * ("occasional") and ~33%/~3-cards ("relentless") ballparks map cleanly onto
 * concrete "every Nth card" intervals, and a fixed cadence is fully
 * deterministic given only (shownIndex, freq) -- no seed required to predict
 * WHEN one fires (unlike WHAT it asks, which still comes from the seeded
 * makeDistraction above). CountDrillView is the caller; it checks this once
 * per card-advance decision across all three of its advance mechanisms
 * (fixed-interval, eyes-free speech loop, manual tap), and skips the check
 * entirely for countdownMode/timedChallenge runs (out of scope for D1 v1).
 */
describe('isDistractionPoint', () => {
  it('never fires when freq is off, at any index', () => {
    for (let i = 0; i < 50; i++) {
      expect(isDistractionPoint(i, 'off')).toBe(false);
    }
  });

  // RV5: the cadence is jittered — exactly one distraction per window of
  // `interval` cards, but on a pseudo-random position within the window, so
  // the learner can't pre-buffer for a fixed every-Nth interruption.
  const firedIn = (freq: 'occasional' | 'relentless', n: number) =>
    Array.from({ length: n }, (_, i) => i).filter((i) => isDistractionPoint(i, freq));

  it('occasional fires exactly once per 7-card window (avg rate 1/7)', () => {
    const interval = 7;
    for (let w = 0; w < 6; w++) {
      const inWindow = firedIn('occasional', 6 * interval).filter(
        (i) => Math.floor(i / interval) === w,
      );
      expect(inWindow).toHaveLength(1);
    }
  });

  it('relentless fires exactly once per 3-card window (avg rate 1/3)', () => {
    const interval = 3;
    for (let w = 0; w < 8; w++) {
      const inWindow = firedIn('relentless', 8 * interval).filter(
        (i) => Math.floor(i / interval) === w,
      );
      expect(inWindow).toHaveLength(1);
    }
  });

  it('is jittered, not a fixed every-Nth cadence: the fire position varies across windows', () => {
    const interval = 7;
    const positions = new Set(firedIn('occasional', 20 * interval).map((i) => i % interval));
    // A fixed cadence would put every fire at the same within-window slot.
    expect(positions.size).toBeGreaterThan(1);
  });

  it('is deterministic per index (same index+freq always gives the same answer)', () => {
    for (let i = 0; i < 40; i++) {
      expect(isDistractionPoint(i, 'occasional')).toBe(isDistractionPoint(i, 'occasional'));
      expect(isDistractionPoint(i, 'relentless')).toBe(isDistractionPoint(i, 'relentless'));
    }
  });

  it('relentless fires strictly more often than occasional (sanity check on the two ballparks)', () => {
    const N = 100;
    const occasionalCount = Array.from({ length: N }, (_, i) => i).filter((i) =>
      isDistractionPoint(i, 'occasional'),
    ).length;
    const relentlessCount = Array.from({ length: N }, (_, i) => i).filter((i) =>
      isDistractionPoint(i, 'relentless'),
    ).length;
    expect(relentlessCount).toBeGreaterThan(occasionalCount);
  });

  it('never fires on the very first card (index 0) for either active frequency', () => {
    expect(isDistractionPoint(0, 'occasional')).toBe(false);
    expect(isDistractionPoint(0, 'relentless')).toBe(false);
  });
});

/**
 * Wave A (s04 medium): the stops were seeded by the window index alone, so
 * every run stopped on the same cards (5, 10, 18, 25, 32, 41, 47) and a
 * regular learned the rhythm -- under a setup note that promises
 * "unpredictable moments". The run's seed now picks the slots too.
 */
describe('isDistractionPoint per run', () => {
  const stops = (seed: number, n = 52) =>
    Array.from({ length: n }, (_, i) => i).filter((i) => isDistractionPoint(i, 'occasional', seed));

  it('different runs stop on different cards', () => {
    const patterns = new Set([1, 2, 3, 77, 123_456, 987_654_321].map((s) => stops(s).join(',')));
    expect(patterns.size).toBeGreaterThan(3);
  });

  it('one run is reproducible, and still fires exactly once per window and never on card 0', () => {
    for (const seed of [1, 42, 999_999_999]) {
      expect(stops(seed)).toEqual(stops(seed));
      expect(isDistractionPoint(0, 'occasional', seed)).toBe(false);
      expect(isDistractionPoint(0, 'relentless', seed)).toBe(false);
      const s = stops(seed, 49);
      for (let w = 0; w < 7; w++) expect(s.filter((i) => Math.floor(i / 7) === w)).toHaveLength(1);
    }
  });

  it('a seed of 0 keeps the old positions', () => {
    for (let i = 0; i < 60; i++) {
      expect(isDistractionPoint(i, 'occasional', 0)).toBe(isDistractionPoint(i, 'occasional'));
    }
  });
});

describe('difficulty (owner 2026-11-09)', () => {
  const counts = [-15, -7, -2, 0, 1, 3, 7, 12, 20];
  const all = (mode: 'near-count' | 'generic', diff: DistractionDifficulty) =>
    counts.flatMap((rc) => Array.from({ length: 200 }, (_, seed) => makeDistraction(rc, mode, seed, diff)));

  it('normal is the default and draws exactly what it drew before', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(makeDistraction(5, 'near-count', seed, 'normal')).toEqual(makeDistraction(5, 'near-count', seed));
      expect(makeDistraction(5, 'generic', seed, 'normal')).toEqual(makeDistraction(5, 'generic', seed));
    }
  });

  it.each(['easy', 'normal', 'hard'] as const)('%s: every answer matches its printed prompt, in the parsers shape', (diff) => {
    for (const mode of ['near-count', 'generic'] as const) {
      for (const d of all(mode, diff)) {
        expect(evalParsed(parsePrompt(d.prompt)), d.prompt).toBe(d.answer);
        expect(d.kind).toBe(mode);
      }
    }
  });

  it('easy generic is a single-digit sum', () => {
    for (const d of all('generic', 'easy')) {
      const p = parsePrompt(d.prompt);
      expect(p.op).toBe('+');
      expect(p.a).toBeLessThan(10);
      expect(p.b).toBeLessThan(10);
    }
  });

  it('easy near-count steps 1..4 from an operand within 2 of the count', () => {
    for (const rc of counts) {
      for (let seed = 0; seed < 100; seed++) {
        const p = parsePrompt(makeDistraction(rc, 'near-count', seed, 'easy').prompt);
        expect(Math.abs(p.a - rc)).toBeLessThanOrEqual(2);
        expect(p.b).toBeGreaterThanOrEqual(1);
        expect(p.b).toBeLessThanOrEqual(4);
        expect(p.op).not.toBe('×');
      }
    }
  });

  it('hard generic always has a two-digit operand, and all three ops appear', () => {
    const ops = new Set<string>();
    for (const d of all('generic', 'hard')) {
      const p = parsePrompt(d.prompt);
      ops.add(p.op);
      expect(Math.max(Math.abs(p.a), Math.abs(p.b))).toBeGreaterThanOrEqual(12);
      if (p.op === '-') expect(d.answer).toBeGreaterThan(0);
    }
    expect([...ops].sort()).toEqual(['+', '-', '×']);
  });

  it('hard near-count keeps an operand near the count, and uses both shapes', () => {
    const ops = new Set<string>();
    for (const rc of counts) {
      for (let seed = 0; seed < 100; seed++) {
        const p = parsePrompt(makeDistraction(rc, 'near-count', seed, 'hard').prompt);
        ops.add(p.op);
        expect(Math.abs(p.a - rc)).toBeLessThanOrEqual(3);
        if (p.op === '×') expect(p.b).toBeGreaterThanOrEqual(3);
        else expect(p.b).toBeGreaterThanOrEqual(11);
      }
    }
    expect(ops.has('×')).toBe(true);
    expect(ops.has('+') || ops.has('-')).toBe(true);
  });

  it('hard answers stay within 99, so a spoken answer is one the voice parser accepts', () => {
    for (const mode of ['near-count', 'generic'] as const) {
      for (const d of all(mode, 'hard')) expect(Math.abs(d.answer), d.prompt).toBeLessThanOrEqual(99);
    }
  });
});

describe('distractionSpeech', () => {
  it('says signs and the times sign as words', () => {
    expect(distractionSpeech('8 + 6')).toBe('8 plus 6');
    expect(distractionSpeech('-3 - (-6)')).toBe('minus 3 minus negative 6');
    expect(distractionSpeech('17 × 5')).toBe('17 times 5');
    expect(distractionSpeech('-5 × 7')).toBe('minus 5 times 7');
    expect(distractionSpeech('84 - 37')).toBe('84 minus 37');
  });

  it('every generated prompt, at every difficulty, comes out as words with no symbol left', () => {
    for (const diff of ['easy', 'normal', 'hard'] as const) {
      for (const mode of ['near-count', 'generic'] as const) {
        for (let seed = 0; seed < 200; seed++) {
          const said = distractionSpeech(makeDistraction(-4, mode, seed, diff).prompt);
          expect(said, said).toMatch(/^(minus )?\d+ (plus|minus|times) (negative )?\d+$/);
        }
      }
    }
  });
});

describe('isDistractionPointEvery', () => {
  it('matches isDistractionPoint at its own intervals', () => {
    for (let i = 0; i < 80; i++) {
      expect(isDistractionPointEvery(i, 7, 99)).toBe(isDistractionPoint(i, 'occasional', 99));
      expect(isDistractionPointEvery(i, 3, 99)).toBe(isDistractionPoint(i, 'relentless', 99));
    }
  });
});
