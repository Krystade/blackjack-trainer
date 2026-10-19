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
 * The ranges cannot cross: entry >= 0 >= exit. Toggle fix round (review N2):
 * nor can they MEET -- the entry in force is held at least one above the
 * exit (`entryTcOf`), so no count is both a get-out and a get-in and the
 * grading never asks for a flip every round. Toggle fix round (S3): the
 * default is 0, so coming back in at TC 0 is right, consistent with D-R1
 * ("TC 0 is a play"); the stepper can raise it.
 */
export const DEFAULT_WONG_IN_TC = 0;
export const WONG_IN_MIN = 0;
export const WONG_IN_MAX = 5;

/** A stored entry point, clamped to the stepper's range; absent = the default. */
export function wongInTcOf(entry: number | undefined): number {
  if (entry === undefined || !Number.isFinite(entry)) return DEFAULT_WONG_IN_TC;
  return Math.min(WONG_IN_MAX, Math.max(WONG_IN_MIN, Math.round(entry)));
}

/**
 * The entry point in force: the stored one, held at least one above the exit
 * point (review N2). Only an exit of 0 is affected (entry 0 reads as +1).
 */
export function entryTcOf(entry: number | undefined, exit: number | undefined): number {
  return Math.max(wongInTcOf(entry), wongExitTcOf(exit) + 1);
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

/**
 * Wave J toggle rework: "Start each shoe out", read off a stored profile (or
 * a game config). The first cut's `backCount: true` means it.
 */
export function startShoeOutOf(p: { startShoeOut?: boolean; backCount?: boolean }): boolean {
  return p.startShoeOut ?? p.backCount === true;
}

/**
 * Wave J, spreading to two hands: how many hands the row in force calls for
 * (absent = 1). Same row rule as `spreadUnitsFor`: the last row whose minTc
 * <= tc, and the first row below every row. Only meaningful when the seat is
 * set to ONE hand -- a fixed 2- or 3-hand seat ignores it (Game.spreadsHands).
 */
export function spreadHandsFor(tc: number, spread: readonly SpreadRow[]): 1 | 2 {
  let hands: 1 | 2 = spread.length > 0 && spread[0].hands === 2 ? 2 : 1;
  for (const row of spread) {
    if (row.minTc <= tc) hands = row.hands === 2 ? 2 : 1;
  }
  return hands;
}

/** Wave J: does any row of the ramp spread to two hands? */
export function spreadHasTwoHands(spread: readonly SpreadRow[]): boolean {
  return spread.some((row) => row.hands === 2);
}

