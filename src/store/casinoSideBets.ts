import { isSideBetId, payTableOf } from '../engine/sideBets/payTables';
import type { SideBetId } from '../engine/sideBets/payTables';

/**
 * Wave L: a side bet a casino game offers -- which bet, on which of the
 * preset pay tables, and its own limits. Stored on the game (casino log v2,
 * an optional field), repaired here like every other field: an unknown bet
 * or pay table is dropped rather than guessed at.
 */
export interface CasinoSideBet {
  bet: SideBetId;
  payTable: string;
  minBet?: number | null;
  maxBet?: number | null;
}

const money = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(1_000_000, Math.round(x * 100) / 100) : null);

export const MAX_SIDE_BETS_PER_GAME = 7;

export function normSideBets(x: unknown): CasinoSideBet[] {
  if (!Array.isArray(x)) return [];
  const out: CasinoSideBet[] = [];
  for (const raw of x) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.bet !== 'string' || !isSideBetId(r.bet) || typeof r.payTable !== 'string' || !payTableOf(r.bet, r.payTable)) continue;
    if (out.some((s) => s.bet === r.bet)) continue;
    out.push({ bet: r.bet, payTable: r.payTable, minBet: money(r.minBet), maxBet: money(r.maxBet) });
    if (out.length >= MAX_SIDE_BETS_PER_GAME) break;
  }
  return out;
}
