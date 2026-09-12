import type { Rank } from './cards';

/**
 * Returns the Hi-Lo tag for a card rank.
 * - 2-6: +1 (low cards favor the player)
 * - 7-9: 0 (neutral)
 * - 10/J/Q/K/A: -1 (high cards favor the dealer)
 */
export function hiLoTag(rank: Rank): -1 | 0 | 1 {
  if (rank === '2' || rank === '3' || rank === '4' || rank === '5' || rank === '6') {
    return 1;
  }
  if (rank === '7' || rank === '8' || rank === '9') {
    return 0;
  }
  return -1;
}

/**
 * How the leftover in a true-count division is resolved (V5-4).
 *
 * This is a property of the COUNTER'S SYSTEM, not of the casino's rules, which
 * is why it lives on the profile rather than the ruleset. Different systems and
 * different authors specify different rules, and the reference training tool
 * (Casino Vérité) makes it a per-strategy setting for exactly that reason.
 *
 * It matters more than it looks. Floor and truncate agree on every POSITIVE
 * quotient and disagree on every negative one -- `floor(-1.5) = -2` against
 * `trunc(-1.5) = -1` -- and a good part of the Hi-Lo index set lives at or
 * below zero (12 v 4, 13 v 2, 12 v 6). Straddling an index of -1 is the
 * difference between taking a deviation and not, so a learner whose book says
 * truncate was being marked wrong at the table on precisely the deviations
 * that are hardest to get right.
 */
export type TcRounding = 'floor' | 'truncate' | 'round';

/** The app's historical behaviour, and still the default everywhere. */
export const DEFAULT_TC_ROUNDING: TcRounding = 'floor';

/**
 * Converts a running count to a true count by dividing by decks remaining.
 * Clamps decksRemaining to minimum 0.5.
 *
 * Defaults to flooring toward -∞, which is what this function did
 * unconditionally before V5-4 -- so every caller that does not pass a rounding
 * is byte-identical to before.
 */
export function trueCount(
  runningCount: number,
  decksRemaining: number,
  rounding: TcRounding = DEFAULT_TC_ROUNDING,
): number {
  const clampedDecks = Math.max(0.5, decksRemaining);
  const exact = runningCount / clampedDecks;
  // Normalise -0 to 0. Math.trunc(-0.4) and Math.round(-0.4) both give -0,
  // which prints as "0" and compares equal with ==, but is a DIFFERENT value
  // to Object.is -- so it survives into snapshots, Map keys and toBe()
  // assertions as a phantom distinction. Found by a test that asserted
  // truncate === floor + 1 and got "expected -0 to be +0".
  const norm = (n: number) => (n === 0 ? 0 : n);
  if (rounding === 'truncate') return norm(Math.trunc(exact));
  // NOTE: Math.round breaks ties toward +Infinity, so -1.5 becomes -1, not -2.
  // On exact half-counts 'round' therefore agrees with 'truncate' rather than
  // with 'floor'. Left as the platform rule rather than silently swapped for
  // round-half-away-from-zero, because which one a counter's book means is
  // the same open question as the convention itself -- pinned in count.test.ts
  // so changing it has to be deliberate.
  if (rounding === 'round') return norm(Math.round(exact));
  return norm(Math.floor(exact));
}

/* ---------------------------------------------------------------- */
/* BY-EYE TRUE COUNT                                                 */
/* ---------------------------------------------------------------- */

/**
 * How far off a person's read of the discard tray can reasonably be.
 *
 * Half a deck, which is the granularity a tray is read at in the first place
 * -- nobody looks at a stack of plastic and thinks "2.3 decks". It is also the
 * granularity the shoe itself reports (`decksRemaining` snaps to the nearest
 * half), so this is one half-step either side of the truth.
 */
export const EYE_DECK_ERROR = 0.5;

/** The inclusive range of true counts a by-eye depth read can legitimately produce. */
export interface TcBand {
  min: number;
  max: number;
}

/**
 * Every true count a correct counter could arrive at, given a depth estimate
 * off by up to `eyeError` in either direction.
 *
 * WHY A BAND AND NOT A NUMBER. At a table the running count is a fact and the
 * depth is a GUESS, so the true count is a guess too. Grading a single integer
 * marks a perfect count wrong because the discard tray was read as two decks
 * instead of two and a half -- which is not a counting error, it is the
 * irreducible slack in the only depth information a player has.
 *
 * The band is computed by running the real `trueCount` at each end of the
 * depth range rather than by widening the answer by a fixed amount, and that
 * matters: the same half-deck misread is worth several true counts near the
 * end of a shoe and almost nothing at the start. A flat tolerance gets both
 * ends wrong -- far too tight when it counts, and a free pass when it does
 * not. It also absorbs the floor-versus-round dispute for free at the depths
 * where the two disagree, without ever having to legislate it.
 */
export function tcBand(
  runningCount: number,
  decksRemaining: number,
  eyeError: number = EYE_DECK_ERROR,
  rounding: TcRounding = DEFAULT_TC_ROUNDING,
): TcBand {
  // trueCount() clamps depth up to half a deck, so a shallow shoe cannot
  // produce a divide-by-zero here however small the estimate goes.
  const candidates = [
    trueCount(runningCount, decksRemaining - eyeError, rounding),
    trueCount(runningCount, decksRemaining, rounding),
    trueCount(runningCount, decksRemaining + eyeError, rounding),
  ];
  return { min: Math.min(...candidates), max: Math.max(...candidates) };
}

/** True when `guess` is a true count a by-eye depth read could honestly give. */
export function tcWithinEye(
  guess: number,
  runningCount: number,
  decksRemaining: number,
  eyeError: number = EYE_DECK_ERROR,
  rounding: TcRounding = DEFAULT_TC_ROUNDING,
): boolean {
  const { min, max } = tcBand(runningCount, decksRemaining, eyeError, rounding);
  return guess >= min && guess <= max;
}

/**
 * The true counts a correct division can produce from a KNOWN depth.
 *
 * A different question from `tcBand`, and it needs its own answer. When the
 * app states the depth ("two and a half decks remaining") there is no
 * estimation slack to forgive -- but there is still no single right integer,
 * because the convention for the leftover is a real choice and not a mistake:
 * this app floors (`trueCount`), plenty of counters round to nearest, and
 * plenty truncate toward zero to stay conservative on the negative side.
 * RC +7 with two and a half decks left is 2.8, and marking "+3" wrong there
 * teaches nothing except which rounding rule the author preferred.
 *
 * The three conventions never span more than two adjacent integers, so this
 * stays a narrow allowance rather than a shrug.
 */
export function tcRoundings(runningCount: number, decksRemaining: number): number[] {
  const decks = Math.max(0.5, decksRemaining);
  const exact = runningCount / decks;
  return [...new Set([Math.floor(exact), Math.round(exact), Math.trunc(exact)])].sort(
    (a, b) => a - b,
  );
}

/** True when `guess` is the quotient under any of the standard conventions. */
export function tcConversionAccepted(
  guess: number,
  runningCount: number,
  decksRemaining: number,
): boolean {
  return tcRoundings(runningCount, decksRemaining).includes(guess);
}
