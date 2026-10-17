import type { SpreadRow } from '../engine/game';
import { plainNumber } from '../drills/signed';

/**
 * Wave A leftover: the bet ramp's first row carries DEFAULT_SPREAD's −99
 * sentinel ("bet this at any count"), and the editor printed it as "TC ≥ -99".
 * A row at or below the floor reads "Any count" and has no TC stepper.
 */
export const SPREAD_FLOOR_TC = -20;
/** The TC stepper never goes below this. */
export const SPREAD_MIN_TC = -10;

export function isFloorRow(row: SpreadRow): boolean {
  return row.minTc <= SPREAD_FLOOR_TC;
}

export function spreadTcText(row: SpreadRow): string {
  return isFloorRow(row) ? 'Any count' : plainNumber(row.minTc);
}

export function stepMinTc(row: SpreadRow, delta: 1 | -1): number {
  if (isFloorRow(row)) return row.minTc;
  return Math.max(SPREAD_MIN_TC, row.minTc + delta);
}
