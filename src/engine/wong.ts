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
