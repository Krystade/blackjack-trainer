import { describe, it, expect } from 'vitest';
import { makeDistraction, isDistractionPoint } from './distraction';

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

  it('occasional fires every 7th card shown (index 6, 13, 20, ...)', () => {
    const fired = Array.from({ length: 21 }, (_, i) => i).filter((i) => isDistractionPoint(i, 'occasional'));
    expect(fired).toEqual([6, 13, 20]);
  });

  it('relentless fires every 3rd card shown (index 2, 5, 8, ...)', () => {
    const fired = Array.from({ length: 10 }, (_, i) => i).filter((i) => isDistractionPoint(i, 'relentless'));
    expect(fired).toEqual([2, 5, 8]);
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
