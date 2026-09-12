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

describe('the shoe size is the profile\'s (V4-3)', () => {
  const SHOES = [1, 2, 6, 8];

  it('a round never claims more decks remain than the shoe holds', () => {
    for (const totalDecks of SHOES) {
      for (let seed = 0; seed < 200; seed++) {
        const r = makeProduceTcRound(20, 1, seed, totalDecks);
        expect(r.decksRemaining, `${totalDecks}-deck seed ${seed}`).toBeGreaterThanOrEqual(0.5);
        expect(r.decksRemaining, `${totalDecks}-deck seed ${seed}`).toBeLessThanOrEqual(totalDecks);
        expect((r.decksRemaining * 2) % 1).toBe(0);
      }
    }
  });

  it('a small shoe actually reaches its own top end, so the range is not just clipped', () => {
    // Vacuity guard on the test above: passing it by only ever emitting 0.5
    // would be useless. Each shoe must span its whole depth range.
    for (const totalDecks of SHOES) {
      const seen = new Set<number>();
      for (let seed = 0; seed < 400; seed++) seen.add(makeProduceTcRound(20, 1, seed, totalDecks).decksRemaining);
      expect(seen.has(0.5), `${totalDecks}-deck floor`).toBe(true);
      expect(seen.has(totalDecks), `${totalDecks}-deck ceiling`).toBe(true);
      expect(seen.size, `${totalDecks}-deck spread`).toBe(totalDecks * 2);
    }
  });

  it('a double-deck player is never asked to divide by more than two decks', () => {
    // The whole point of V4-3: the divisor range a 2-deck player faces is
    // 0.5-2, and every question they used to see ran to 6.
    const deep = [];
    for (let seed = 0; seed < 400; seed++) {
      const r = makeProduceTcRound(20, 1, seed, 2);
      if (r.decksRemaining > 2) deep.push(seed);
    }
    expect(deep).toEqual([]);
  });

  it('omitting the shoe size is byte-identical to the old hardcoded six', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(makeProduceTcRound(20, 1, seed)).toEqual(makeProduceTcRound(20, 1, seed, 6));
    }
    // ...and the parameter is genuinely read, not ignored.
    const differs = [];
    for (let seed = 0; seed < 100; seed++) {
      if (makeProduceTcRound(20, 1, seed).decksRemaining !== makeProduceTcRound(20, 1, seed, 2).decksRemaining) {
        differs.push(seed);
      }
    }
    expect(differs.length).toBeGreaterThan(50);
  });

  it('the cards dealt are the same whatever the shoe; only the depth moves', () => {
    // Depth is a separate draw from the card sequence, and stays that way.
    const a = makeProduceTcRound(20, 1, 7, 2);
    const b = makeProduceTcRound(20, 1, 7, 8);
    expect(a.round.groups).toEqual(b.round.groups);
    expect(a.round.finalRc).toBe(b.round.finalRc);
    expect(a.correctTc).toBe(trueCount(a.round.finalRc, a.decksRemaining));
    expect(b.correctTc).toBe(trueCount(b.round.finalRc, b.decksRemaining));
  });
});
