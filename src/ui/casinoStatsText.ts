import { MINUS } from '../drills/signed';
import { money, signedMoney } from './casinoFigures';
import type { AssumedField } from '../store/casinoGameStats';

/**
 * Wave K: how the ranking and the stats card write the simulator's figures.
 * Pure, pinned by casinoStatsText.test.ts.
 */

/** "+$42/h", "−$9/h". */
export function evHourText(ev: number): string {
  return `${signedMoney(Math.round(ev))}/h`;
}

/** "±$4" (rounded up to a whole dollar, never "±$0" for a real interval). */
export function ciText(ci: number): string {
  if (!Number.isFinite(ci)) return '±?';
  return `±$${Math.max(1, Math.ceil(ci))}`;
}

/** "0.62%", "−0.18%" (a player edge reads negative). */
export function pctText(fraction: number, digits = 2): string {
  const v = fraction * 100;
  const s = Math.abs(v).toFixed(digits);
  return `${v < 0 && Number(s) !== 0 ? MINUS : ''}${s}%`;
}

/** The house edge with its interval: "0.62% ±0.05%". */
export function edgeText(edge: number, ci: number): string {
  return `${pctText(edge)} ±${Number.isFinite(ci) ? (ci * 100).toFixed(2) : '?'}%`;
}

/** N0 in hours: "120 h", "1.5 h", or "never" with no edge. */
export function n0Text(hours: number | null): string {
  if (hours === null) return 'never';
  if (hours >= 10) return `${Math.round(hours).toLocaleString('en-US')} h`;
  return `${hours.toFixed(1)} h`;
}

/** Risk of ruin: "—" with no bankroll set, "<0.1%", "100%" with no edge. */
export function rorText(ror: number | null): string {
  if (ror === null) return '—';
  if (ror >= 0.9995) return '100%';
  if (ror < 0.001) return '<0.1%';
  return `${(ror * 100).toFixed(ror < 0.1 ? 1 : 0)}%`;
}

export function sdHourText(sd: number): string {
  return `${money(Math.round(sd))}/h`;
}

/** "1.2M", "850k", "4,000". */
export function roundsText(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

export const ASSUMED_TEXT: Record<AssumedField, string> = {
  decks: '6 decks',
  s17: 'dealer hits soft 17',
  das: 'no double after split',
  surrender: 'no surrender',
  payout: 'blackjack pays 6:5',
  cut: 'cut 1.5 decks from the end',
  minBet: 'min bet = your profile unit',
};
