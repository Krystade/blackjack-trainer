import type { Casino, CasinoGame, CasinoLog, GeoPoint } from '../store/casinoLog';
import { DEFAULT_ROUNDS_PER_HOUR, DEFAULT_SESSION_HOURS } from '../store/casinoLog';
import type { Profile } from '../store/types';
import { resultState, simInputFor, type GameResult, type ResultState, type SimInput } from '../store/casinoGameStats';
import { hourly, houseEdge, summarize, type HourlyStats, type RoundStats } from '../engine/casinoStats';
import type { BetMethod } from '../engine/betMethods';
import { distanceOf, evPerTripHour, standing, warnBadges, type Distance } from './casinoFigures';

/**
 * Wave K: the "Games ranked" list -- every logged game, its figures from the
 * cached simulation (store/casinoGameStats.ts), in the order chosen. Pure.
 */

export interface MethodFigures {
  method: BetMethod;
  stats: RoundStats;
  hours: HourlyStats;
}

export interface GameFigures {
  /** House edge as a fraction of the bet (positive = the house's) and its 95% half-width. */
  edge: number;
  edgeCi: number;
  /** Null for a continuous shuffler. */
  methods: MethodFigures[] | null;
  /** The best method by EV per hour; null for a CSM. */
  best: MethodFigures | null;
  /** What the game is worth per hour: the best method's EV, or a CSM's flat-bet EV. */
  evHour: number;
  n0Hours: number | null;
}

export function roundsPerHourOf(g: CasinoGame): number {
  return g.roundsPerHour && g.roundsPerHour > 0 ? g.roundsPerHour : DEFAULT_ROUNDS_PER_HOUR;
}

export function sessionHoursOf(log: CasinoLog): number {
  return log.settings.sessionHours && log.settings.sessionHours > 0 ? log.settings.sessionHours : DEFAULT_SESSION_HOURS;
}

/** Every figure the stats card and the ranking show, from a stored result. */
export function gameFigures(result: GameResult, roundsPerHour: number, bankroll: number | null): GameFigures {
  const { edge, ci } = houseEdge(result.basic, result.unit);
  if (!result.methods) {
    return { edge, edgeCi: ci, methods: null, best: null, evHour: -edge * result.unit * roundsPerHour, n0Hours: null };
  }
  const methods = result.methods.map(({ method, acc }) => {
    const stats = summarize(acc);
    return { method, stats, hours: hourly(stats, roundsPerHour, bankroll) };
  });
  let best: MethodFigures | null = null;
  for (const m of methods) if (m.stats.observed > 0 && (!best || m.hours.evHour > best.hours.evHour)) best = m;
  return { edge, edgeCi: ci, methods, best, evHour: best?.hours.evHour ?? 0, n0Hours: best?.hours.n0Hours ?? null };
}

export type RankSort = 'ev' | 'distance' | 'trip';

export interface RankRow {
  casino: Casino;
  game: CasinoGame;
  input: SimInput;
  state: ResultState;
  figures: GameFigures | null;
  /** The casino is marked Avoid: listed, greyed. */
  greyed: boolean;
  warns: string[];
  distance: Distance | null;
  /** EV per trip hour; null without a drive time or a result. */
  tripEv: number | null;
}

/**
 * The rows, sorted. Burned casinos are left out until their cool-off is over;
 * Avoid casinos stay in, greyed. Games not yet computed sort after every
 * computed one (in log order) under the EV sorts; under Distance, live miles
 * come first, then drive times, then games with neither.
 */
export function buildRanking(
  log: CasinoLog,
  profile: Profile,
  results: Record<string, GameResult>,
  now: number,
  here: GeoPoint | null,
  sort: RankSort,
): RankRow[] {
  const bankroll = log.settings.startingBankroll;
  const custom = log.settings.methods ?? [];
  const session = sessionHoursOf(log);
  const rows: RankRow[] = [];
  for (const casino of log.casinos) {
    const { group } = standing(casino, now);
    if (group === 'burned') continue;
    const distance = distanceOf(casino, here);
    for (const game of casino.games) {
      const input = simInputFor(game, profile, custom);
      const state = resultState(results[game.id], input.key);
      const figures = state.kind === 'none' ? null : gameFigures(state.result, roundsPerHourOf(game), bankroll);
      rows.push({
        casino,
        game,
        input,
        state,
        figures,
        greyed: group === 'avoid',
        warns: warnBadges(game),
        distance,
        tripEv: figures ? evPerTripHour(figures.evHour, session, casino.driveMinutes) : null,
      });
    }
  }
  const order = new Map(rows.map((r, i) => [r, i]));
  const byIndex = (a: RankRow, b: RankRow) => order.get(a)! - order.get(b)!;
  const desc = (pick: (r: RankRow) => number | null) => (a: RankRow, b: RankRow) => {
    const x = pick(a);
    const y = pick(b);
    if (x === null && y === null) return byIndex(a, b);
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || byIndex(a, b);
  };
  if (sort === 'ev') return rows.sort(desc((r) => r.figures?.evHour ?? null));
  if (sort === 'trip') {
    // Computed games with a drive time first, by EV per trip hour; then
    // computed games with no drive time (marked), by EV per hour; then the rest.
    return rows.sort((a, b) => {
      const tier = (r: RankRow) => (r.figures === null ? 2 : r.tripEv === null ? 1 : 0);
      const t = tier(a) - tier(b);
      if (t !== 0) return t;
      if (tier(a) === 0) return desc((r) => r.tripEv)(a, b);
      return desc((r) => r.figures?.evHour ?? null)(a, b);
    });
  }
  return rows.sort((a, b) => {
    const tier = (r: RankRow) => (r.distance === null ? 2 : r.distance.kind === 'miles' ? 0 : 1);
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const v = (r: RankRow) => (r.distance === null ? 0 : r.distance.kind === 'miles' ? r.distance.miles : r.distance.minutes);
    return v(a) - v(b) || desc((r) => r.figures?.evHour ?? null)(a, b);
  });
}

/** A casino's best game by EV per hour among computed ones, else its first. */
export function bestGameOf(casino: Casino, rows: readonly RankRow[]): CasinoGame {
  let best: RankRow | null = null;
  for (const r of rows) {
    if (r.casino.id !== casino.id || !r.figures) continue;
    if (!best || r.figures.evHour > best.figures!.evHour) best = r;
  }
  return best?.game ?? casino.games[0]!;
}
