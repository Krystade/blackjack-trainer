import { describe, it, expect } from 'vitest';
import { hiLoTag } from '../engine/count';
import { trueCount } from '../engine/count';
import { makeProduceTcRound, gradeProducedTc, producedTcBand } from './produceTcDrill';
import type { ProduceTcRound } from './produceTcDrill';

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

describe('gradeProducedTc (the tolerance is the depth, not a constant)', () => {
  /** A round is only its running count and its depth as far as grading cares. */
  const round = (finalRc: number, decksRemaining: number): ProduceTcRound => ({
    round: { groups: [], finalRc },
    decksRemaining,
    correctTc: trueCount(finalRc, decksRemaining),
  });

  it('accepts the exact answer and anything a half-deck misread would give', () => {
    const r = round(6, 2.5); // 2.4 -> 2; two decks reads 3, three decks reads 2
    expect(gradeProducedTc(2, r)).toBe(true);
    expect(gradeProducedTc(3, r)).toBe(true);
    expect(gradeProducedTc(1, r)).toBe(false);
    expect(gradeProducedTc(4, r)).toBe(false);
  });

  /**
   * The reason the old flat ±1 was the wrong shape. With one deck left a
   * half-deck misread is worth several true counts; with five and a half it is
   * worth almost nothing. A constant is a free pass at one end and a false
   * failure at the other.
   */
  it('is looser late in the shoe than early, for the same misread', () => {
    const late = round(6, 1);
    const early = round(6, 5.5);
    expect(gradeProducedTc(4, late)).toBe(true); // 1.5 decks would read 4
    expect(gradeProducedTc(2, early)).toBe(false); // no honest tray read gives 2
    // Which is also tighter than the ±1 this replaced: it used to accept 0 and 2
    // against an answer of 1 at any depth at all.
    expect(gradeProducedTc(1, early)).toBe(true);
  });

  it('the band it grades against is the one the result screen prints', () => {
    const r = round(6, 2.5);
    const band = producedTcBand(r);
    expect(band).toEqual({ min: 2, max: 3 });
    for (let guess = band.min; guess <= band.max; guess++) {
      expect(gradeProducedTc(guess, r)).toBe(true);
    }
    expect(gradeProducedTc(band.min - 1, r)).toBe(false);
    expect(gradeProducedTc(band.max + 1, r)).toBe(false);
  });
});
