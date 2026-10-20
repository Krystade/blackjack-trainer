import type { Accum } from './casinoSim';

/**
 * Wave K: the figures a counter ranks games by, from the simulator's running
 * sums (casinoSim.ts). Pure; every one is a DEFINITION, not a strategy value:
 *
 *   EV, SD        mean and standard deviation of a played round's result.
 *   N0            rounds (here also hours) for the expected win to equal one
 *                 standard deviation: N0 = (SD / EV)^2 (Don Schlesinger,
 *                 Blackjack Attack).
 *   DI            the desirability index, 1000 x EV / SD per round played
 *                 (Schlesinger, ibid.; equivalently 1000 / sqrt(N0)).
 *   Risk of ruin  the diffusion (Brownian-motion) approximation
 *                 exp(-2 x EV x B / SD^2) for a bankroll B with no
 *                 replenishment -- an APPROXIMATION, labelled as one.
 *
 * TIME. A method's time is measured in rounds of table time: the rounds it
 * observes (plays, or watches while back-counting) plus, for every exit, the
 * minutes it takes to find another table (or wait for a shuffle) converted
 * at the game's rounds per hour -- `exitRounds` = rounds/hour x minutes / 60.
 * EV per hour is rounds/hour x net / time; a played round's SD scales by the
 * rounds PLAYED per hour. Rounds are taken as independent for SD per hour
 * (the usual approximation); the CONFIDENCE INTERVALS are not, see `summarize`.
 */

/** z for a two-sided 95% interval. */
export const Z95 = 1.96;

export interface RoundStats {
  observed: number;
  played: number;
  exits: number;
  /** Table time in rounds: observed + exits x exitRounds. */
  time: number;
  /** Share of the rounds DEALT that the method played: back-counting watches, an exit skips the rest of a shoe. */
  playedShare: number;
  /** Rounds played per round of table time (1 for play-all with no exits). */
  playedPerTime: number;
  /** Exits per round of table time. */
  exitsPerTime: number;
  twoHandShare: number;
  /** Dollars per played round. */
  ev: number;
  sd: number;
  /** Initial dollars on the table per played round. */
  avgBet: number;
  /** Dollars per round of table time, and its standard error over shoes. */
  evTime: number;
  seTime: number;
}

/**
 * Means and errors from the sums. The error of the mean is the ratio
 * estimator's over shoes (sum over shoes of (y - R t)^2, / (sum t)^2, with t
 * a shoe's time = x observed rounds + k e exits), not SD / sqrt(rounds): the
 * bet follows the count, so rounds in one shoe move together, and the number
 * of exits is itself random; a per-round error would claim more precision
 * than there is. `exitRounds` (k) is the time one exit costs, in rounds.
 *
 * Results stored by an earlier simulator have no exit sums; they read as no
 * exits (they are marked stale by the cache key).
 */
export function summarize(a: Accum, exitRounds = 0): RoundStats {
  const k = Math.max(0, exitRounds);
  const exits = a.exits ?? 0;
  const se2 = a.se2 ?? 0;
  const sey = a.sey ?? 0;
  const sxe = a.sxe ?? 0;
  const time = a.observed + k * exits;
  const ev = a.played > 0 ? a.net / a.played : 0;
  const variance = a.played > 0 ? Math.max(0, a.net2 / a.played - ev * ev) : 0;
  const r = time > 0 ? a.net / time : 0;
  const st2 = a.sx2 + 2 * k * sxe + k * k * se2;
  const sty = a.sxy + k * sey;
  const resid = Math.max(0, a.sy2 - 2 * r * sty + r * r * st2);
  // Small-sample correction k / (k - 1) over the shoes.
  const corr = a.shoes > 1 ? a.shoes / (a.shoes - 1) : 1;
  const se = time > 0 ? Math.sqrt(resid * corr) / time : Infinity;
  const dealt = a.dealt ?? a.observed;
  return {
    observed: a.observed,
    played: a.played,
    exits,
    time,
    playedShare: dealt > 0 ? a.played / dealt : 0,
    playedPerTime: time > 0 ? a.played / time : 0,
    exitsPerTime: time > 0 ? exits / time : 0,
    twoHandShare: a.played > 0 ? a.twoHands / a.played : 0,
    ev,
    sd: Math.sqrt(variance),
    avgBet: a.played > 0 ? a.wagered / a.played : 0,
    evTime: r,
    seTime: a.shoes > 1 ? se : Infinity,
  };
}

export interface HourlyStats {
  evHour: number;
  /** Half-width of the 95% interval on evHour. */
  evHourCi: number;
  sdHour: number;
  playedPerHour: number;
  exitsPerHour: number;
  /** Null when the EV is not positive: the win never catches the swings. */
  n0Hours: number | null;
  n0Rounds: number | null;
  di: number;
  evPer100: number;
  sdPer100: number;
  /** Null without a bankroll; 1 when the EV is not positive. */
  ror: number | null;
}

export function hourly(s: RoundStats, roundsPerHour: number, bankroll: number | null): HourlyStats {
  const playedPerHour = roundsPerHour * s.playedPerTime;
  const evHour = roundsPerHour * s.evTime;
  const sdHour = s.sd * Math.sqrt(playedPerHour);
  const positive = s.ev > 0 && s.sd > 0;
  const n0Rounds = positive ? (s.sd / s.ev) ** 2 : null;
  return {
    evHour,
    evHourCi: Z95 * roundsPerHour * s.seTime,
    sdHour,
    playedPerHour,
    exitsPerHour: roundsPerHour * s.exitsPerTime,
    n0Rounds,
    n0Hours: n0Rounds !== null && playedPerHour > 0 ? n0Rounds / playedPerHour : null,
    di: s.sd > 0 ? (1000 * s.ev) / s.sd : 0,
    evPer100: 100 * s.ev,
    sdPer100: 10 * s.sd,
    ror: riskOfRuin(s.ev, s.sd, bankroll),
  };
}

/** exp(-2 EV B / SD^2), the diffusion approximation; 1 with no edge. */
export function riskOfRuin(ev: number, sd: number, bankroll: number | null): number | null {
  if (bankroll === null || !(bankroll > 0)) return null;
  if (!(ev > 0) || !(sd > 0)) return 1;
  return Math.exp((-2 * ev * bankroll) / (sd * sd));
}

/** The house edge (positive = the house's) and its 95% half-width, as fractions of the bet. */
export function houseEdge(a: Accum, unit: number): { edge: number; ci: number } {
  const s = summarize(a);
  return { edge: -s.evTime / unit, ci: (Z95 * s.seTime) / unit };
}

/** The precision the run stops at: house edge within +/-0.05%, the best EV/hour within +/-10%. */
export const EDGE_TARGET = 0.0005;
export const EV_REL_TARGET = 0.1;

export function edgePrecise(a: Accum, unit: number): boolean {
  return houseEdge(a, unit).ci <= EDGE_TARGET;
}

/**
 * Relative precision of EV per unit of time, exits charged at `exitRounds`.
 * Rounds per hour scale the EV and its error alike, so only the exit cost
 * (in rounds) enters.
 */
export function evPrecise(a: Accum, exitRounds = 0): boolean {
  const s = summarize(a, exitRounds);
  return s.evTime !== 0 && Z95 * s.seTime <= EV_REL_TARGET * Math.abs(s.evTime);
}

/** The method with the highest EV per round of table time (= per hour), exits charged at `exitRounds`. */
export function bestIndex(accs: readonly Accum[], exitRounds = 0): number {
  let best = -1;
  let bestEv = -Infinity;
  accs.forEach((a, i) => {
    const time = a.observed + Math.max(0, exitRounds) * (a.exits ?? 0);
    const r = time > 0 ? a.net / time : -Infinity;
    if (r > bestEv) {
      bestEv = r;
      best = i;
    }
  });
  return best;
}
