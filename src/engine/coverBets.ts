// Type-only, so this is erased at compile time and creates no runtime cycle
// with game.ts (which imports the functions below).
import type { SpreadRow } from './game';

/**
 * COVER: BET GRADING THAT DOES NOT TRAIN THE TELL (RT#11, docs/BACKLOG.md).
 *
 * Bets were graded `bet === expectedUnits`, every round, exactly. That is not
 * a neutral measurement -- it is hundreds of reps of the single behaviour
 * casino surveillance is looking for. A player who resizes in perfect
 * lockstep with the count is not playing well; they are advertising, and the
 * app rewarded it with a green tick each time.
 *
 * Two pieces here, and they are deliberately independent:
 *
 *   1. `betWithinStep` -- an OPT-IN tolerance. Grade a bet correct if it sits
 *      on the expected rung of the spread or on either neighbouring rung, so
 *      a deliberate over- or under-bet for cover is not scored as an error.
 *      Neighbouring RUNG, not plus-or-minus one unit: a spread's steps are
 *      what a real ramp moves in, and one unit means something different at
 *      the bottom of a 1-12 spread than at the top.
 *
 *   2. `lockstepTell` -- a read on the session that is worth having even at
 *      exact grading, because the tolerance alone cannot tell you whether you
 *      USED it. Perfect conformity is the tell; the report should say so.
 *
 * Neither piece asserts a count threshold or a "correct" amount of cover.
 * Both work entirely off the profile's own spread, in the same spirit as the
 * wong grading: the app measures against what the user configured, and does
 * not smuggle in a strategy opinion of its own.
 */

/** The distinct bet sizes a spread can call for, ascending. */
export function spreadSteps(spread: readonly SpreadRow[]): number[] {
  return [...new Set(spread.map((r) => r.units))].sort((a, b) => a - b);
}

/**
 * Is `bet` on the expected rung, or on the one immediately above or below it?
 *
 * An expected size that is not itself a rung of the spread (which should not
 * happen, but a hand-edited profile can produce it) falls back to exact
 * matching rather than guessing which rungs are adjacent to it -- a tolerance
 * computed from a position that does not exist would be arbitrary.
 */
export function betWithinStep(
  bet: number,
  expected: number,
  spread: readonly SpreadRow[],
): boolean {
  if (bet === expected) return true;
  const steps = spreadSteps(spread);
  const at = steps.indexOf(expected);
  if (at === -1) return false;
  return bet === steps[at - 1] || bet === steps[at + 1];
}

/** One round's bet, as the grader saw it. */
export interface BetRound {
  taken: number;
  expected: number;
}

export interface LockstepTell {
  rounds: number;
  /** Rounds bet at EXACTLY the spread's number. */
  exact: number;
  /** exact / rounds, or 0 with nothing to judge. */
  ratio: number;
  /** Enough rounds to say anything, and conformity above the threshold. */
  isTell: boolean;
}

/**
 * Below this many rounds the ratio is noise -- three exact bets out of three
 * is a short session, not a pattern.
 */
export const TELL_MIN_ROUNDS = 8;

/**
 * The conformity above which a session reads as mechanical. Not a claim about
 * any particular casino's threshold, which nobody publishes: it is the point
 * at which a human watching would stop seeing a bettor and start seeing a
 * function of the count.
 */
export const TELL_RATIO = 0.9;

export function lockstepTell(rounds: readonly BetRound[]): LockstepTell {
  const exact = rounds.filter((r) => r.taken === r.expected).length;
  const ratio = rounds.length === 0 ? 0 : exact / rounds.length;
  return {
    rounds: rounds.length,
    exact,
    ratio,
    isTell: rounds.length >= TELL_MIN_ROUNDS && ratio >= TELL_RATIO,
  };
}
