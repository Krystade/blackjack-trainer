/** Wave B, B6/W12: the per-100 figure and session tags for the report and Stats. */
import type { Stats } from '../store/types';
import { MINUS } from '../drills/signed';

type SessionRow = Stats['sessions'][number];

/** Units lost per 100 hands, or null with no hands. */
export function lossPer100(units: number, hands: number): number | null {
  if (!(hands > 0)) return null;
  return (units / hands) * 100;
}

export function formatLossPer100(loss: number): string {
  const tail = 'u lost to mistakes per 100 hands';
  if (loss <= 0) return `0 ${tail}`;
  if (loss < 0.005) return `Under 0.01 ${tail}`;
  return `${MINUS}${loss.toFixed(2)} ${tail}`;
}

/** Pooled over rows that recorded it (Hot shoe included: skill, not luck). */
export function sessionsLossPer100(rows: readonly SessionRow[]): number | null {
  let units = 0;
  let hands = 0;
  for (const r of rows) {
    if (r.hands === undefined || r.mistakeUnits === undefined) continue;
    units += r.mistakeUnits;
    hands += r.hands;
  }
  return lossPer100(units, hands);
}

export function sessionTag(row: SessionRow): string | null {
  // Task 8 adds `hotShoe` to the row type; read it loosely until then.
  return (row as { hotShoe?: true }).hotShoe ? 'Hot shoe' : null;
}
