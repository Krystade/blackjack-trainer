import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { trueCount } from '../engine/count';
import { makeProduceTcRound, gradeProducedTc, PRODUCE_TC_TOLERANCE } from './produceTcDrill';

describe('makeProduceTcRound (V3-2 produce-a-true-count)', () => {
  it('is deterministic for a seed', () => {
    const a = makeProduceTcRound(20, 1, 7);
    const b = makeProduceTcRound(20, 1, 7);
    expect(b.decksRemaining).toBe(a.decksRemaining);
    expect(b.correctTc).toBe(a.correctTc);
    expect(b.round.finalRc).toBe(a.round.finalRc);
    expect(b.round.groups.flat().map((c) => c.rank)).toEqual(a.round.groups.flat().map((c) => c.rank));
  });

  it('finalRc equals the Hi-Lo sum of the flashed cards (the RC to maintain)', () => {
    for (let seed = 0; seed < 100; seed++) {
      const r = makeProduceTcRound(26, 2, seed);
      const sum = r.round.groups.flat().reduce((s, c) => s + hiLoTag(c.rank), 0);
      expect(r.round.finalRc).toBe(sum);
    }
  });

  it('decksRemaining is in 0.5..6 (half-deck steps) and correctTc is the floored quotient', () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = makeProduceTcRound(20, 1, seed);
      expect(r.decksRemaining).toBeGreaterThanOrEqual(0.5);
      expect(r.decksRemaining).toBeLessThanOrEqual(6);
      expect((r.decksRemaining * 2) % 1).toBe(0);
      expect(r.correctTc).toBe(trueCount(r.round.finalRc, r.decksRemaining));
    }
  });

  it('depth does not merely track the card sequence (a different draw than the shoe seed)', () => {
    // Two seeds that give different cards should not lock depth to the RC — just
    // assert the depths vary across seeds (not a constant).
    const depths = new Set<number>();
    for (let seed = 0; seed < 40; seed++) depths.add(makeProduceTcRound(20, 1, seed).decksRemaining);
    expect(depths.size).toBeGreaterThan(1);
  });
});

describe('gradeProducedTc', () => {
  it('accepts an exact answer and anything within the by-eye tolerance', () => {
    expect(gradeProducedTc(3, 3)).toBe(true);
    expect(gradeProducedTc(3 + PRODUCE_TC_TOLERANCE, 3)).toBe(true);
    expect(gradeProducedTc(3 - PRODUCE_TC_TOLERANCE, 3)).toBe(true);
  });

  it('rejects an answer beyond the tolerance', () => {
    expect(gradeProducedTc(3 + PRODUCE_TC_TOLERANCE + 1, 3)).toBe(false);
    expect(gradeProducedTc(-1, 3)).toBe(false);
  });
});
