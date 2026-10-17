import type { SpreadRow } from './game';

/**
 * The play-or-sit line, ONE rule for Play and the Bet or sit drill (Wave A,
 * decision D1: follow the profile's own spread).
 *
 * Sitting out is right exactly when the spread calls only for its minimum bet
 * at this true count: the count gives no edge worth staking above the floor,
 * so back-counting beats playing at the minimum. Grounded entirely in the
 * profile's spread -- no hard-coded count threshold asserted as strategy
 * truth -- so a ramp that raises from TC +1 sits at TC 0 and below, and moving
 * the ramp moves the line. An empty spread never sits (nothing to grade by).
 */

/** The bet the spread calls for: the last row (sorted asc by minTc) whose minTc <= tc. */
export function spreadUnitsFor(tc: number, spread: readonly SpreadRow[]): number {
  let units = spread.length > 0 ? spread[0].units : 1;
  for (const row of spread) {
    if (row.minTc <= tc) units = row.units;
  }
  return units;
}

export function sitOutIsCorrect(tc: number, spread: readonly SpreadRow[]): boolean {
  if (spread.length === 0) return false;
  const minUnits = Math.min(...spread.map((r) => r.units));
  return spreadUnitsFor(tc, spread) <= minUnits;
}

/**
 * The lowest true count at which the spread bets above its minimum, or null
 * when it never does. Only for explaining the line ("your ramp raises from
 * +1"); grading goes through `sitOutIsCorrect`.
 */
export function firstRaiseTc(spread: readonly SpreadRow[]): number | null {
  if (spread.length === 0) return null;
  const minUnits = Math.min(...spread.map((r) => r.units));
  const raised = [...spread].sort((a, b) => a.minTc - b.minTc).find((r) => r.units > minUnits);
  return raised ? raised.minTc : null;
}
