import { describe, it, expect } from 'vitest';
import { RANKS, Shoe } from './cards';
import {
  hiLoTag,
  trueCount,
  tcBand,
  tcWithinEye,
  tcRoundings,
  tcConversionAccepted,
} from './count';

describe('hiLoTag', () => {
  it('returns +1 for 2-6', () => {
    expect(hiLoTag('2')).toBe(1);
    expect(hiLoTag('3')).toBe(1);
    expect(hiLoTag('4')).toBe(1);
    expect(hiLoTag('5')).toBe(1);
    expect(hiLoTag('6')).toBe(1);
  });

  it('returns 0 for 7-9', () => {
    expect(hiLoTag('7')).toBe(0);
    expect(hiLoTag('8')).toBe(0);
    expect(hiLoTag('9')).toBe(0);
  });

  it('returns -1 for 10/J/Q/K/A', () => {
    expect(hiLoTag('10')).toBe(-1);
    expect(hiLoTag('J')).toBe(-1);
    expect(hiLoTag('Q')).toBe(-1);
    expect(hiLoTag('K')).toBe(-1);
    expect(hiLoTag('A')).toBe(-1);
  });

  it('covers all 13 ranks', () => {
    RANKS.forEach((rank) => {
      const tag = hiLoTag(rank);
      expect(tag).toBeOneOf([-1, 0, 1]);
    });
  });
});

describe('full 6-deck shoe', () => {
  it('all tags sum to 0', () => {
    const shoe = new Shoe({ seed: 1, decks: 6 });
    let sum = 0;
    while (shoe.cardsRemaining > 0) {
      const card = shoe.draw();
      sum += hiLoTag(card.rank);
    }
    expect(sum).toBe(0);
  });
});

describe('trueCount', () => {
  it('trueCount(6, 3) = 2', () => {
    expect(trueCount(6, 3)).toBe(2);
  });

  it('trueCount(-3, 2) = -2 (floor toward -∞)', () => {
    expect(trueCount(-3, 2)).toBe(-2);
  });

  it('trueCount(5, 2) = 2 (2.5 → 2)', () => {
    expect(trueCount(5, 2)).toBe(2);
  });

  it('trueCount(3, 0.5) = 6', () => {
    expect(trueCount(3, 0.5)).toBe(6);
  });

  it('trueCount(0, 6) = 0', () => {
    expect(trueCount(0, 6)).toBe(0);
  });

  it('trueCount(3, 0.25) = 6 (clamps decks to min 0.5)', () => {
    expect(trueCount(3, 0.25)).toBe(6);
  });
});

/* ================================================================== */
/* BY-EYE TRUE COUNT                                                  */
/*                                                                    */
/* At a table the running count is a fact and the depth is a guess,   */
/* so the true count is a guess too. These pin how much slack that    */
/* buys -- and, just as importantly, that it is not a flat amount.    */
/* ================================================================== */

describe('tcBand (a depth read that can be half a deck out)', () => {
  it('spans what the division gives at each end of the depth estimate', () => {
    // RC +6 with two and a half decks left is 2.4 -> 2. Read the tray as two
    // decks and it is 3; as three decks and it is 2.
    expect(tcBand(6, 2.5)).toEqual({ min: 2, max: 3 });
  });

  it('is wide late in the shoe and narrow early, which a constant cannot be', () => {
    const late = tcBand(6, 1); // one deck left: 6, or 4 at 1.5, or 12 at 0.5
    const early = tcBand(6, 5.5);
    expect(late.max - late.min).toBeGreaterThan(early.max - early.min);
    // And the early band is genuinely tight: with five and a half decks left, a
    // half-deck misread barely moves the quotient, so an answer off by one
    // there is a division error and is meant to be marked as one.
    expect(early.max - early.min).toBeLessThanOrEqual(1);
  });

  it('always contains the exact answer', () => {
    for (let rc = -8; rc <= 20; rc++) {
      for (let halves = 1; halves <= 12; halves++) {
        const decks = halves / 2;
        const band = tcBand(rc, decks);
        const exact = trueCount(rc, decks);
        expect(exact).toBeGreaterThanOrEqual(band.min);
        expect(exact).toBeLessThanOrEqual(band.max);
      }
    }
  });

  it('does not divide by zero at the shallow end', () => {
    // trueCount clamps depth up to half a deck, so d - 0.5 = 0 is harmless.
    expect(() => tcBand(6, 0.5)).not.toThrow();
    expect(Number.isFinite(tcBand(6, 0.5).max)).toBe(true);
  });

  it('a zero running count is zero however the tray is read', () => {
    expect(tcBand(0, 3)).toEqual({ min: 0, max: 0 });
  });

  it('works on the negative side too', () => {
    // RC -6 at two and a half decks is -2.4 -> -3 (floored). Two decks gives
    // -3, three decks gives -2.
    expect(tcBand(-6, 2.5)).toEqual({ min: -3, max: -2 });
  });
});

describe('tcWithinEye', () => {
  it('accepts every count inside the band and rejects the ones outside', () => {
    expect(tcWithinEye(2, 6, 2.5)).toBe(true);
    expect(tcWithinEye(3, 6, 2.5)).toBe(true);
    expect(tcWithinEye(1, 6, 2.5)).toBe(false);
    expect(tcWithinEye(4, 6, 2.5)).toBe(false);
  });

  it('a tighter eyeError narrows it, so the slack is a parameter and not a guess', () => {
    expect(tcWithinEye(3, 6, 2.5, 0.5)).toBe(true);
    expect(tcWithinEye(3, 6, 2.5, 0)).toBe(false);
  });
});

describe('tcRoundings (the depth is known; only the leftover is in dispute)', () => {
  it('accepts both the floor and the round of a quotient that lands between', () => {
    // 7 / 2.5 = 2.8. This app floors to 2; a counter who rounds says 3.
    expect(tcRoundings(7, 2.5)).toEqual([2, 3]);
    expect(tcConversionAccepted(2, 7, 2.5)).toBe(true);
    expect(tcConversionAccepted(3, 7, 2.5)).toBe(true);
    expect(tcConversionAccepted(4, 7, 2.5)).toBe(false);
  });

  it('an exact quotient has exactly one answer', () => {
    expect(tcRoundings(6, 2)).toEqual([3]);
    expect(tcConversionAccepted(2, 6, 2)).toBe(false);
  });

  it('the negative side allows truncation toward zero, which is the other convention', () => {
    // -7 / 4 = -1.75. Floor AND round both give -2; only truncation gives -1,
    // so this case is the one that proves the third convention is really
    // there. (-1.5 would not: round and truncate agree at -1 by coincidence.)
    expect(tcRoundings(-7, 4)).toEqual([-2, -1]);
    expect(tcConversionAccepted(-1, -7, 4)).toBe(true);
    expect(tcConversionAccepted(-2, -7, 4)).toBe(true);
    expect(tcConversionAccepted(-3, -7, 4)).toBe(false);
  });

  it('never spans more than two adjacent integers', () => {
    for (let rc = -20; rc <= 20; rc++) {
      for (let halves = 1; halves <= 12; halves++) {
        const r = tcRoundings(rc, halves / 2);
        expect(r.length).toBeLessThanOrEqual(2);
        if (r.length === 2) expect(r[1]! - r[0]!).toBe(1);
      }
    }
  });
});

describe('V5-4: the true-count rounding convention', () => {
  it('defaults to floor, so every pre-V5-4 caller is unchanged', () => {
    for (let rc = -20; rc <= 20; rc++) {
      for (const decks of [0.5, 1, 1.5, 2, 3, 4.5, 6, 8]) {
        expect(trueCount(rc, decks), `rc ${rc} / ${decks}`).toBe(trueCount(rc, decks, 'floor'));
      }
    }
  });

  it('floor and truncate agree on every POSITIVE quotient', () => {
    // The whole reason this went unnoticed: half the domain is identical.
    for (let rc = 0; rc <= 30; rc++) {
      for (const decks of [0.5, 1, 1.5, 2, 3, 4.5, 6, 8]) {
        expect(trueCount(rc, decks, 'floor'), `rc ${rc} / ${decks}`).toBe(
          trueCount(rc, decks, 'truncate'),
        );
      }
    }
  });

  it('and disagree on the negative ones, which is the bug', () => {
    // -3 / 2 = -1.5. Floor goes to -2, truncate toward zero to -1. An index
    // of -1 sits between them, so this is a deviation taken or not taken.
    expect(trueCount(-3, 2, 'floor')).toBe(-2);
    expect(trueCount(-3, 2, 'truncate')).toBe(-1);
    // JS Math.round breaks ties toward +Infinity, so -1.5 rounds to -1 and
    // NOT to -2. That surprises people (it surprised this test first time),
    // and it means 'round' agrees with truncate on exact half-counts rather
    // than with floor. Pinned deliberately so a future switch to a
    // round-half-away-from-zero helper is a visible decision, not a silent
    // change to how negative indices grade.
    expect(trueCount(-3, 2, 'round')).toBe(-1);
    // Away from the tie, round parts company with truncate as expected.
    expect(trueCount(-7, 4, 'truncate')).toBe(-1); // -1.75
    expect(trueCount(-7, 4, 'round')).toBe(-2);
    expect(trueCount(-7, 4, 'floor')).toBe(-2);

    // At least one disagreement must exist across the realistic domain, or
    // the setting would be decorative.
    const disagreements: string[] = [];
    for (let rc = -20; rc < 0; rc++) {
      for (const decks of [0.5, 1, 1.5, 2, 3, 4.5, 6, 8]) {
        if (trueCount(rc, decks, 'floor') !== trueCount(rc, decks, 'truncate')) {
          disagreements.push(`${rc}/${decks}`);
        }
      }
    }
    expect(disagreements.length).toBeGreaterThan(20);
  });

  it('round differs from both where the fraction is over a half', () => {
    expect(trueCount(7, 2.5, 'floor')).toBe(2); // 2.8
    expect(trueCount(7, 2.5, 'truncate')).toBe(2);
    expect(trueCount(7, 2.5, 'round')).toBe(3);
  });

  it('the three conventions never span more than two adjacent integers', () => {
    // The claim tcRoundings already makes; asserted directly on trueCount so
    // the two cannot drift apart.
    for (let rc = -20; rc <= 20; rc++) {
      for (const decks of [0.5, 1, 1.5, 2, 2.5, 3, 4.5, 6, 8]) {
        const all = (['floor', 'truncate', 'round'] as const).map((r) => trueCount(rc, decks, r));
        expect(Math.max(...all) - Math.min(...all), `rc ${rc} / ${decks}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('never returns -0, which prints as 0 but is a different value to Object.is', () => {
    // -0 survives into snapshots, Map keys and toBe() as a phantom distinction.
    for (const r of ['floor', 'truncate', 'round'] as const) {
      for (let rc = -5; rc <= 5; rc++) {
        for (const decks of [0.5, 1, 1.5, 2, 6, 8]) {
          expect(Object.is(trueCount(rc, decks, r), -0), `${r} ${rc}/${decks}`).toBe(false);
        }
      }
    }
  });

  it('still clamps a shallow shoe, whatever the convention', () => {
    for (const r of ['floor', 'truncate', 'round'] as const) {
      expect(trueCount(6, 0, r), r).toBe(trueCount(6, 0.5, r));
      expect(Number.isFinite(trueCount(6, 0, r)), r).toBe(true);
    }
  });

  it('tcBand follows the same convention as the answer it forgives', () => {
    // A band computed under floor while the answer is stated under truncate
    // would forgive the wrong integers -- the two must move together.
    const floorBand = tcBand(-3, 2, 0.5, 'floor');
    const truncBand = tcBand(-3, 2, 0.5, 'truncate');
    expect(truncBand).not.toEqual(floorBand);
    expect(truncBand.max).toBeGreaterThanOrEqual(trueCount(-3, 2, 'truncate'));
    expect(floorBand.min).toBeLessThanOrEqual(trueCount(-3, 2, 'floor'));
  });
});
