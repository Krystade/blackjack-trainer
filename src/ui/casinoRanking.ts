import type { Casino, CasinoGame, CasinoLog, GeoPoint } from '../store/casinoLog';
import { DEFAULT_EXIT_FIND_MINUTES, DEFAULT_EXIT_WAIT_MINUTES, DEFAULT_ROUNDS_PER_HOUR, DEFAULT_SESSION_HOURS } from '../store/casinoLog';
import type { Profile } from '../store/types';
import { resultState, simInputFor, type GameResult, type ResultState, type SimInput } from '../store/casinoGameStats';
import { EV_REL_TARGET, hourly, houseEdge, summarize, type HourlyStats, type RoundStats } from '../engine/casinoStats';
import { describeMethod, type BetMethod } from '../engine/betMethods';
import { evHourText } from './casinoStatsText';
import { bestSideEvHour, gameSideFigures } from './casinoSideFigures';
import { distanceMinutes, distanceOf, evPerTripHour, standing, tripMinutesOf, warnBadges, type Distance } from './casinoFigures';

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
  /** Half-width of the 95% interval on evHour. */
  evHourCi: number;
  n0Hours: number | null;
  /** Review S3: the run stopped before both targets were met (Cancel, the time cap, a test budget). */
  partial: boolean;
  /** The minutes each exit was charged. */
  exitMinutes: number;
}

export function roundsPerHourOf(g: CasinoGame): number {
  return g.roundsPerHour && g.roundsPerHour > 0 ? g.roundsPerHour : DEFAULT_ROUNDS_PER_HOUR;
}

export function sessionHoursOf(log: CasinoLog): number {
  return log.settings.sessionHours && log.settings.sessionHours > 0 ? log.settings.sessionHours : DEFAULT_SESSION_HOURS;
}

/**
 * Review B1: the minutes one exit (a wong-out, or a back-counter leaving at
 * its exit count) costs at this game -- finding another table where mid-shoe
 * entry is allowed or unknown, waiting for a fresh shoe where it is barred.
 * Casino settings, with the defaults when unset.
 */
export function exitMinutesOf(log: CasinoLog, g: CasinoGame): number {
  const s = log.settings;
  if (g.midShoeEntry === 'no') return s.exitWaitMinutes ?? DEFAULT_EXIT_WAIT_MINUTES;
  return s.exitFindMinutes ?? DEFAULT_EXIT_FIND_MINUTES;
}

/**
 * Every figure the stats card and the ranking show, from a stored result.
 * `exitMinutes` is charged per exit, in rounds at this game's rounds per hour.
 */
export function gameFigures(result: GameResult, roundsPerHour: number, bankroll: number | null, exitMinutes = 0): GameFigures {
  const { edge, ci } = houseEdge(result.basic, result.unit);
  const partial = result.status !== 'done';
  if (!result.methods) {
    return {
      edge,
      edgeCi: ci,
      methods: null,
      best: null,
      evHour: -edge * result.unit * roundsPerHour,
      evHourCi: ci * result.unit * roundsPerHour,
      n0Hours: null,
      partial,
      exitMinutes,
    };
  }
  const exitRounds = (roundsPerHour * exitMinutes) / 60;
  const methods = result.methods.map(({ method, acc }) => {
    const stats = summarize(acc, exitRounds);
    return { method, stats, hours: hourly(stats, roundsPerHour, bankroll) };
  });
  let best: MethodFigures | null = null;
  for (const m of methods) if (m.stats.time > 0 && (!best || m.hours.evHour > best.hours.evHour)) best = m;
  return {
    edge,
    edgeCi: ci,
    methods,
    best,
    evHour: best?.hours.evHour ?? 0,
    evHourCi: best?.hours.evHourCi ?? Infinity,
    n0Hours: best?.hours.n0Hours ?? null,
    partial,
    exitMinutes,
  };
}

/**
 * Review S1: a method that is SEATED for every round of the shoe -- no
 * back-count entry, no wong-out exit. Only such a method can make a counted
 * side bet whenever its trigger comes up: the side figures are per 100
 * rounds DEALT, and a method that leaves the table (Under 13's trigger is a
 * crushingly negative count, exactly where a wonger has gone) is not there
 * for many of them. Its side-bet rounds were never simulated on its sat-in
 * rounds, so no side EV is added to it.
 */
export function seatedThroughout(m: BetMethod): boolean {
  return m.entryTc === null && m.exitTc === null;
}

/** The best method by EV per hour among those seated throughout; null with none (or at a shuffler). */
export function bestSeated(f: GameFigures): MethodFigures | null {
  let seated: MethodFigures | null = null;
  for (const m of f.methods ?? []) {
    if (m.stats.time > 0 && seatedThroughout(m.method) && (!seated || m.hours.evHour > seated.hours.evHour)) seated = m;
  }
  return seated;
}

/**
 * The stats card's "Best with a side bet" line, by the ranking's own rule
 * (withSideBet): "$41/h (Profile ramp, play all $30/h + Lucky Ladies $11/h)",
 * or why the side bet is left out.
 */
export function sideCombinedText(f: GameFigures, betName: string | null, sideEvHour: number): string {
  if (!betName || !(sideEvHour > 0)) return `${evHourText(f.evHour)} — no side bet here is worth making`;
  const ws = withSideBet(f, sideEvHour);
  if (ws) {
    const base = ws.method ? `${describeMethod(ws.method.method)} ${evHourText(ws.method.hours.evHour)}` : evHourText(f.evHour);
    return `${evHourText(ws.evHour)} (${base} + ${betName} ${evHourText(sideEvHour)})`;
  }
  // The best method leaves the table for rounds the side figure counts.
  const seated = bestSeated(f);
  const leaves = f.best?.method.entryTc != null ? 'back-counts' : 'wongs out';
  const why = `none — the best method ${leaves} (${evHourText(f.evHour)}), so ${betName} is not added to it`;
  return seated ? `${why}. Seated with ${betName}: ${evHourText(seated.hours.evHour + sideEvHour)}` : why;
}

/** What the game is worth with its best side bet counted, when that beats the game alone. */
export interface WithSide {
  /** EV per hour: the seated method's (or a shuffler's flat bet) plus the side bet's. */
  evHour: number;
  sideEvHour: number;
  /** The method the side bet rides on; null at a continuous shuffler (no methods). */
  method: MethodFigures | null;
}

/**
 * Review S1: the game's EV per hour with a side bet, or null when adding it
 * does not beat the game's best method alone. The side bet rides on the best
 * SEATED method (seatedThroughout), so a game whose best method backs off
 * ranks on max(best method alone, best seated method + side bet). A
 * continuous shuffler is played every round, so its side bet always adds.
 */
export function withSideBet(f: GameFigures, sideEvHour: number): WithSide | null {
  if (!(sideEvHour > 0)) return null;
  if (!f.methods) return { evHour: f.evHour + sideEvHour, sideEvHour, method: null };
  const seated = bestSeated(f);
  if (!seated) return null;
  const evHour = seated.hours.evHour + sideEvHour;
  return evHour > f.evHour ? { evHour, sideEvHour, method: seated } : null;
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
  /** Review S4: the best method back-counts, at a game where mid-shoe entry is not known to be allowed. */
  midShoeUnknown: boolean;
  /** Rounds one exit costs at this game now: rounds/hour x exit minutes / 60. */
  exitRounds: number;
  /**
   * Wave L: the game's best side bet's counted EV per hour, present only when
   * the ranking includes it (review S1: on a seated method, and only when
   * that beats the best method alone -- `withSide`).
   */
  sideEvHour?: number;
  /** Review S1: the figure with the side bet, when the ranking uses it. */
  withSide?: WithSide;
  /** Wave L: a variant game; the simulator does not model it, so it is never computed. */
  notModelled?: boolean;
}

/** Wave L: the EV per hour a row is ranked on -- the game's, or with its side bet where that is better (withSideBet). */
export function rankedEvHour(r: RankRow): number | null {
  return r.figures ? (r.withSide?.evHour ?? r.figures.evHour) : null;
}

/** A row with no result, a stale one, or a partial one: what "Compute all" runs. */
export function needsCompute(r: RankRow): boolean {
  if (r.notModelled) return false;
  return r.state.kind !== 'current' || r.state.result.status !== 'done';
}

/**
 * The rows, sorted. Burned casinos are left out until their cool-off is over;
 * Avoid casinos stay in, greyed. Under the EV sorts, games whose run finished
 * come first, then partial runs (review S3: their figure is shakier), then
 * games not yet computed (in log order). Under Distance, every game with a
 * distance, nearest first -- live miles and drive minutes on one scale
 * (`distanceMinutes`, review N3) -- then games with neither.
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
      const input = simInputFor(game, profile, custom, casino.kind);
      // Wave L: a variant game is never simulated (it would be scored as standard blackjack).
      const notModelled = game.variant !== undefined;
      const state: ResultState = notModelled ? { kind: 'none' } : resultState(results[game.id], input.key);
      const figures = state.kind === 'none' ? null : gameFigures(state.result, roundsPerHourOf(game), bankroll, exitMinutesOf(log, game));
      // Wave L merge (review S7): a variant game's side bets are not modelled either, so they add nothing.
      const sideEvHour = notModelled ? 0 : bestSideEvHour(gameSideFigures(game, roundsPerHourOf(game))).evHour;
      const withSide = figures ? withSideBet(figures, sideEvHour) : null;
      rows.push({
        casino,
        game,
        input,
        state,
        figures,
        greyed: group === 'avoid',
        warns: warnBadges(game),
        distance,
        tripEv: figures ? evPerTripHour(withSide?.evHour ?? figures.evHour, session, tripMinutesOf(casino)) : null,
        midShoeUnknown: game.midShoeEntry === 'unknown' && (withSide ? withSide.method?.method : figures?.best?.method)?.entryTc != null,
        exitRounds: (roundsPerHourOf(game) * exitMinutesOf(log, game)) / 60,
        ...(withSide ? { sideEvHour, withSide } : {}),
        ...(notModelled ? { notModelled } : {}),
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
  // Finished runs, then partial ones, then none.
  const done = (r: RankRow) => (r.figures === null ? 2 : r.figures.partial ? 1 : 0);
  if (sort === 'ev') {
    return rows.sort((a, b) => done(a) - done(b) || desc(rankedEvHour)(a, b));
  }
  if (sort === 'trip') {
    // Within finished and within partial runs: games with a drive time
    // first, by EV per trip hour; then games with no drive time (marked),
    // by EV per hour.
    return rows.sort((a, b) => {
      const d = done(a) - done(b);
      if (d !== 0) return d;
      const tier = (r: RankRow) => (r.tripEv === null ? 1 : 0);
      const t = tier(a) - tier(b);
      if (t !== 0) return t;
      if (a.figures && tier(a) === 0) return desc((r) => r.tripEv)(a, b);
      return desc(rankedEvHour)(a, b);
    });
  }
  return rows.sort((a, b) => {
    const tier = (r: RankRow) => (r.distance === null ? 1 : 0);
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    const v = (r: RankRow) => (r.distance === null ? 0 : distanceMinutes(r.distance));
    return v(a) - v(b) || desc(rankedEvHour)(a, b);
  });
}

/** A casino's best game by EV per hour among computed ones, else its first. */
export function bestGameOf(casino: Casino, rows: readonly RankRow[]): CasinoGame {
  let best: RankRow | null = null;
  for (const r of rows) {
    if (r.casino.id !== casino.id || !r.figures) continue;
    if (!best || rankedEvHour(r)! > rankedEvHour(best)!) best = r;
  }
  return best?.game ?? casino.games[0]!;
}

/**
 * Re-review R2: whether the best method's EV/hour meets the run's +/-10%
 * target at the exit minutes the figures were drawn at. A run stops when it
 * meets it at the minutes in force THEN; after the minutes change, the same
 * rounds can fall short, and the card must not say "met". True with no
 * methods (a shuffler: only the house-edge target applies).
 */
export function evTargetMet(f: Pick<GameFigures, 'best'>): boolean {
  if (!f.best) return true;
  const { evHour, evHourCi } = f.best.hours;
  return evHour !== 0 && evHourCi <= EV_REL_TARGET * Math.abs(evHour);
}
