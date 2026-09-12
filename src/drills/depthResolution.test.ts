import { describe, it, expect } from 'vitest';
import {
  depthStep,
  depthTolerance,
  depthOptions,
  isLastDeckTightened,
  formatDepthSlack,
  DEFAULT_DEPTH_RESOLUTION,
  LAST_DECK_DECKS,
} from './depthResolution';
import type { DepthResolution } from './depthResolution';

const ALL: DepthResolution[] = ['half', 'last-deck', 'quarter'];
const SHOES = [1, 2, 4, 6, 8];

describe('depthStep', () => {
  it('defaults to the app\'s historical half deck', () => {
    expect(DEFAULT_DEPTH_RESOLUTION).toBe('half');
    for (let d = 0; d <= 8; d += 0.25) expect(depthStep(d, 'half')).toBe(0.5);
  });

  it('quarter is a quarter at every depth', () => {
    for (let d = 0; d <= 8; d += 0.25) expect(depthStep(d, 'quarter')).toBe(0.25);
  });

  it('last-deck tightens inside the last deck and nowhere else', () => {
    for (let d = 0; d <= 8; d += 0.25) {
      expect(depthStep(d, 'last-deck')).toBe(d <= LAST_DECK_DECKS ? 0.25 : 0.5);
    }
  });

  it('the boundary is inclusive -- exactly one deck left IS the last deck', () => {
    // A mutant that writes `< LAST_DECK_DECKS` passes every other test here.
    expect(depthStep(1, 'last-deck')).toBe(0.25);
    expect(depthStep(1.25, 'last-deck')).toBe(0.5);
  });

  it('at quarter resolution the last-deck rule has nothing left to tighten', () => {
    // The reason this is one three-way setting and not a resolution plus a
    // toggle: the fourth combination does not exist.
    for (let d = 0; d <= LAST_DECK_DECKS; d += 0.25) {
      expect(depthStep(d, 'quarter')).toBe(depthStep(d, 'last-deck'));
    }
  });

  it('the tolerance is the step', () => {
    for (const r of ALL) {
      for (let d = 0; d <= 8; d += 0.25) expect(depthTolerance(d, r)).toBe(depthStep(d, r));
    }
  });
});

describe('depthOptions', () => {
  it('half is byte-identical to the half-deck grid this drill always had', () => {
    expect(depthOptions(6, 'half')).toEqual([0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6]);
    expect(depthOptions(2, 'half')).toEqual([0.5, 1, 1.5, 2]);
  });

  it('last-deck runs in quarters to one deck and halves above it', () => {
    expect(depthOptions(2, 'last-deck')).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2]);
    // 14 buttons in a 6-deck shoe, not the 24 a flat quarter grid would give.
    expect(depthOptions(6, 'last-deck')).toHaveLength(14);
    expect(depthOptions(6, 'last-deck')).not.toContain(1.25);
    expect(depthOptions(6, 'last-deck')).toContain(0.75);
  });

  it('quarter runs in quarters throughout', () => {
    expect(depthOptions(2, 'quarter')).toEqual([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
    expect(depthOptions(6, 'quarter')).toHaveLength(24);
  });

  it('is strictly ascending, inside the shoe, and free of float noise', () => {
    for (const total of SHOES) {
      for (const r of ALL) {
        const opts = depthOptions(total, r);
        expect(opts.length).toBeGreaterThan(0);
        for (let i = 0; i < opts.length; i++) {
          expect(opts[i]!).toBeGreaterThan(0);
          expect(opts[i]!).toBeLessThanOrEqual(total);
          // Every option is an exact multiple of a quarter -- no 0.7500000001
          // reaching a button label or an === comparison against a typed guess.
          expect(Number.isInteger(opts[i]! * 4)).toBe(true);
          if (i > 0) expect(opts[i]!).toBeGreaterThan(opts[i - 1]!);
        }
        expect(opts[opts.length - 1]).toBe(total);
      }
    }
  });

  it('a bigger shoe is a superset of a smaller one at the same resolution', () => {
    for (const r of ALL) {
      const small = depthOptions(2, r);
      const big = depthOptions(6, r);
      for (const v of small) expect(big).toContain(v);
    }
  });
});

describe('the grid is always answerable', () => {
  /**
   * THE LOAD-BEARING PROPERTY. Every depth the drill can generate has at least
   * one grid option within the tolerance that applies at that depth.
   *
   * Without it the feature is a trap: tighten the tolerance without refining the
   * grid and there are depths where every button on screen is graded wrong. That
   * is precisely what a "last deck resolution" option built the obvious way does
   * to a 1-deck shoe -- the grid starts at 0.5, the shallowest questions sit near
   * 0.15, and a 0.25 tolerance admits nothing at all.
   *
   * Swept over EVERY integer card count, which is a strict superset of the
   * depths makeDeckEstimationQuestion can produce, so it cannot go stale if that
   * generator's bounds are ever widened.
   */
  it('for every shoe, resolution and card count, some option is within tolerance', () => {
    for (const total of SHOES) {
      for (const r of ALL) {
        const opts = depthOptions(total, r);
        for (let dealt = 0; dealt <= total * 52; dealt++) {
          const remaining = (total * 52 - dealt) / 52;
          const tol = depthTolerance(remaining, r);
          const reachable = opts.some((o) => Math.abs(o - remaining) <= tol);
          expect(
            reachable,
            `${total}-deck ${r}: ${remaining} decks left, tolerance ${tol}, no legal answer`,
          ).toBe(true);
        }
      }
    }
  });

  it('and the tolerance is not so loose that everything is accepted', () => {
    // Vacuity guard. The property above is satisfiable by a tolerance of
    // infinity, which would make the drill meaningless. So: somewhere in every
    // shoe, at every resolution, the tolerance has to REJECT an option.
    //
    // Swept over real card counts and not over the grid points themselves. An
    // earlier version of this test sampled only depths that ARE options, and on
    // a 1-deck half-resolution grid -- [0.5, 1] with a 0.5 tolerance -- both
    // options sit within tolerance of both grid points. It looked like proof
    // that the drill could not mark anything wrong in a single-deck shoe. It
    // is not: at 0.48 decks left the 1.0 button is 0.52 out and is rejected.
    // The grid points are the least discriminating depths there are, which is
    // exactly the wrong place to sample.
    for (const total of SHOES) {
      for (const r of ALL) {
        const opts = depthOptions(total, r);
        const rejected: string[] = [];
        for (let dealt = 0; dealt <= total * 52; dealt++) {
          const remaining = (total * 52 - dealt) / 52;
          const tol = depthTolerance(remaining, r);
          if (opts.some((o) => Math.abs(o - remaining) > tol)) rejected.push(String(remaining));
        }
        expect(
          rejected.length,
          `${total}-deck ${r}: no option is ever rejected at any depth`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('quarter and last-deck genuinely grade harder in the last deck than half does', () => {
    // Otherwise the whole setting is decoration.
    const remaining = 0.6;
    expect(depthTolerance(remaining, 'half')).toBe(0.5);
    expect(depthTolerance(remaining, 'last-deck')).toBe(0.25);
    expect(depthTolerance(remaining, 'quarter')).toBe(0.25);
    // A guess that half accepts and the other two reject -- the setting has to
    // change at least one verdict or it is not doing anything.
    const guess = 1;
    expect(Math.abs(guess - remaining) <= depthTolerance(remaining, 'half')).toBe(true);
    expect(Math.abs(guess - remaining) <= depthTolerance(remaining, 'last-deck')).toBe(false);
  });
});

describe('explaining the grade', () => {
  it('isLastDeckTightened names only the case the last-deck rule created', () => {
    expect(isLastDeckTightened(0.5, 'last-deck')).toBe(true);
    expect(isLastDeckTightened(1, 'last-deck')).toBe(true);
    expect(isLastDeckTightened(1.5, 'last-deck')).toBe(false);
    // Quarter is tight everywhere, so nothing about the last deck explains it.
    expect(isLastDeckTightened(0.5, 'quarter')).toBe(false);
    expect(isLastDeckTightened(0.5, 'half')).toBe(false);
  });

  it('formatDepthSlack says it the way the drill says it', () => {
    expect(formatDepthSlack(0.5)).toBe('half a deck');
    expect(formatDepthSlack(0.25)).toBe('a quarter deck');
    expect(formatDepthSlack(1.5)).toBe('1.5 decks');
  });
});
