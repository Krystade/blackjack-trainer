import type { SpreadRow } from './game';

/**
 * The play-or-sit line, ONE rule for Play and the Bet sizing drill.
 *
 * Wave D, D-R1 (owner ruling): sitting out is right only at or below the
 * player's Wong exit point (true count <= `wongExitTc`, default -2). Above it
 * playing is right, even where the ramp bets its minimum -- TC 0 is a play.
 * The exit point is a profile setting (`Profile.wongExitTc`, -5..0), so the
 * line is the player's own, not a count asserted as strategy truth. An empty
 * spread never sits (nothing to grade by).
 */

/** The exit point when a profile sets none. */
export const DEFAULT_WONG_EXIT_TC = -2;
export const WONG_EXIT_MIN = -5;
export const WONG_EXIT_MAX = 0;

/** A stored exit point, clamped to the stepper's range; absent = the default. */
export function wongExitTcOf(exit: number | undefined): number {
  if (exit === undefined || !Number.isFinite(exit)) return DEFAULT_WONG_EXIT_TC;
  return Math.min(WONG_EXIT_MAX, Math.max(WONG_EXIT_MIN, Math.round(exit)));
}

/** The bet the spread calls for: the last row (sorted asc by minTc) whose minTc <= tc. */
export function spreadUnitsFor(tc: number, spread: readonly SpreadRow[]): number {
  let units = spread.length > 0 ? spread[0].units : 1;
  for (const row of spread) {
    if (row.minTc <= tc) units = row.units;
  }
  return units;
}

export function sitOutIsCorrect(tc: number, spread: readonly SpreadRow[], wongExitTc?: number): boolean {
  if (spread.length === 0) return false;
  return tc <= wongExitTcOf(wongExitTc);
}

/**
 * The lowest true count at which the spread bets above its minimum, or null
 * when it never does. Only for explaining the ramp ("your ramp raises from
 * +1"); the play-or-sit line is `sitOutIsCorrect`.
 */
export function firstRaiseTc(spread: readonly SpreadRow[]): number | null {
  if (spread.length === 0) return null;
  const minUnits = Math.min(...spread.map((r) => r.units));
  const raised = [...spread].sort((a, b) => a.minTc - b.minTc).find((r) => r.units > minUnits);
  return raised ? raised.minTc : null;
}

/**
 * Wave J, back-counting ("Wonging in"): the ENTRY point. Standing behind the
 * table, the player sits in only at true count >= this; below it, watching
 * is right. A profile setting (`Profile.wongInTc`, 0..+5, default +1), the
 * mirror of the exit point above.
 *
 * The ranges cannot cross: entry >= 0 >= exit. They can MEET, at 0 -- enter at
 * >= 0 and leave at <= 0. The overlap is ruled one way per state: while
 * WATCHING the entry wins (TC 0 is a sit-in), while SEATED the exit wins (TC 0
 * is a leave). So a counter set to 0/0 who sits in at a fresh shoe is told to
 * leave on the next round if the count has not moved -- which is what those
 * two numbers say.
 */
export const DEFAULT_WONG_IN_TC = 1;
export const WONG_IN_MIN = 0;
export const WONG_IN_MAX = 5;

/** A stored entry point, clamped to the stepper's range; absent = the default. */
export function wongInTcOf(entry: number | undefined): number {
  if (entry === undefined || !Number.isFinite(entry)) return DEFAULT_WONG_IN_TC;
  return Math.min(WONG_IN_MAX, Math.max(WONG_IN_MIN, Math.round(entry)));
}

/** While watching: is sitting in right at this true count? */
export function sitInIsCorrect(tc: number, wongInTc?: number): boolean {
  return tc >= wongInTcOf(wongInTc);
}

/**
 * The bots a back-counter watches when the profile seats none. A back-counter
 * stands behind a table WITH players; a dealer dealing to nobody is not a
 * thing, and it would give the watcher two cards a round to count.
 */
export const BACK_COUNT_BOTS = 3;

