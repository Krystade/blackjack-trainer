/** Wave B, B6/W12: the per-100 figure and session tags for the report and Stats. */
import type { Stats } from '../store/types';
import { MINUS } from '../drills/signed';

type SessionRow = Stats['sessions'][number];

/** Units lost per 100 hands, or null with no hands. */
export function lossPer100(units: number, hands: number): number | null {
  if (!(hands > 0)) return null;
  return (units / hands) * 100;
}

/** The amount alone: "−0.42", "0", "Under 0.01". */
function lossAmount(loss: number): string {
  if (loss <= 0) return '0';
  if (loss < 0.005) return 'Under 0.01';
  return `${MINUS}${loss.toFixed(2)}`;
}

/**
 * The report's headline. B2, R3: it prices PLAY decisions only and says so --
 * "lost to mistakes" read as a clean session above a list of bet misses.
 */
export function formatLossPer100(loss: number): string {
  return `${lossAmount(loss)} u lost to playing mistakes per 100 hands`;
}

/** B2 #50: the Stats value under its "Lost to playing mistakes" label. */
export function formatLossValue(loss: number): string {
  return `${lossAmount(loss)} u per 100 hands`;
}

/** B2, R3: bet and play-or-sit decisions graded wrong, said beside the figure. */
export function betMissText(n: number): string | null {
  if (!(n > 0)) return null;
  return `${n} bet ${n === 1 ? 'decision' : 'decisions'} off`;
}

/** Bet misses over the rows that recorded them (B2 and later). */
export function sessionsBetMisses(rows: readonly SessionRow[]): number {
  return rows.reduce((n, r) => n + (typeof r.betMisses === 'number' && Number.isFinite(r.betMisses) ? r.betMisses : 0), 0);
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
  return row.hotShoe ? 'Hot shoe' : null;
}
