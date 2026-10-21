import type { CasinoGame } from '../store/casinoLog';
import type { CasinoSideBet } from '../store/casinoSideBets';
import { sideRowFor } from '../store/casinoSideRows';
import type { SideBetRow } from '../engine/sideBets/plan';
import { DEFAULT_SIDE_STAKE } from './sideBetConfig';

/**
 * Wave L: a casino game's side bets, in the stats card's terms. Pure, given
 * the rows (sideRowFor). The stake is the side bet's logged minimum (else
 * $25): a counted side bet is a flat bet at its trigger, as the generated
 * figures assume.
 */

export interface SideFigure {
  sb: CasinoSideBet;
  /** Null until the game's own cut has been simulated. */
  row: SideBetRow | null;
  stake: number;
  /** Exact house edge off the top (fraction). */
  edge: number | null;
  /** The count used, or null (not countable / no count needed). */
  countName: string | null;
  trigger: number | null;
  betBelow: boolean;
  always: boolean;
  /** Dollars per hour, counted (betting only at the trigger), or every round when `always`. Null = not computed. */
  evHour: number | null;
}

export function sideStakeOf(sb: CasinoSideBet): number {
  const min = sb.minBet && sb.minBet > 0 ? sb.minBet : DEFAULT_SIDE_STAKE;
  return sb.maxBet && sb.maxBet > 0 ? Math.min(min, sb.maxBet) : min;
}

export function sideFigureOf(sb: CasinoSideBet, row: SideBetRow | null, roundsPerHour: number, csm = false): SideFigure {
  const stake = sideStakeOf(sb);
  if (row && csm) {
    // A continuous shuffler deals every round from a full shoe: no count, and
    // the bet is worth exactly its edge off the top.
    return { sb, row, stake, edge: row.edge, countName: null, trigger: null, betBelow: false, always: row.always, evHour: row.always ? -row.edge * stake * roundsPerHour : 0 };
  }
  if (!row) return { sb, row, stake, edge: null, countName: null, trigger: null, betBelow: false, always: false, evHour: null };
  const c = row.chosen === null ? null : (row.candidates.find((x) => x.id === row.chosen) ?? null);
  const per100 = row.always ? -row.edge * 100 : (c?.per100 ?? 0);
  return {
    sb,
    row,
    stake,
    edge: row.edge,
    countName: c?.name ?? null,
    trigger: c?.trigger ?? null,
    betBelow: c?.betBelow ?? false,
    always: row.always,
    evHour: (per100 / 100) * stake * roundsPerHour,
  };
}

export function gameSideFigures(game: CasinoGame, roundsPerHour: number): SideFigure[] {
  return (game.sideBets ?? []).map((sb) => sideFigureOf(sb, sideRowFor(game, sb), roundsPerHour, game.csm));
}

/**
 * What the side bets add to the game's EV per hour: the best one's counted
 * EV, when positive (a side bet that loses is simply not made). Only one is
 * taken -- keeping two side counts beside Hi-Lo is not a plan the app
 * trains -- and 0 when none is worth it or none has been computed.
 */
export function bestSideEvHour(figs: readonly SideFigure[]): { evHour: number; fig: SideFigure | null } {
  let best: SideFigure | null = null;
  for (const f of figs) if (f.evHour !== null && f.evHour > 0 && (!best || f.evHour > best.evHour!)) best = f;
  return { evHour: best?.evHour ?? 0, fig: best };
}
