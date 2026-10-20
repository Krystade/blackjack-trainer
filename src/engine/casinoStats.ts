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
 * Hours: a played round's EV and SD scale by the rounds PLAYED per hour,
 * which is the rounds the table deals per hour times the share of observed
 * rounds a method plays -- a back-counter's watched rounds take time and win
 * nothing. Rounds are taken as independent for SD per hour (the usual
 * approximation); the CONFIDENCE INTERVALS are not, see `summarize`.
 */

/** z for a two-sided 95% interval. */
export const Z95 = 1.96;

export interface RoundStats {
  observed: number;
  played: number;
  /** Share of observed rounds played (1 unless back-counting). */
  playedShare: number;
  twoHandShare: number;
  /** Dollars per played round. */
  ev: number;
  sd: number;
  /** Initial dollars on the table per played round. */
  avgBet: number;
  /** Dollars per OBSERVED round, and its standard error over shoes. */
  evObserved: number;
  seObserved: number;
}

/**
 * Means and errors from the sums. The error of the mean is the ratio
 * estimator's over shoes (sum over shoes of (y - R x)^2, / (sum x)^2), not
 * SD / sqrt(rounds): the bet follows the count, so rounds in one shoe move
 * together and a per-round error would claim more precision than there is.
 */
export function summarize(a: Accum): RoundStats {
  const ev = a.played > 0 ? a.net / a.played : 0;
  const variance = a.played > 0 ? Math.max(0, a.net2 / a.played - ev * ev) : 0;
  const r = a.observed > 0 ? a.net / a.observed : 0;
  const resid = Math.max(0, a.sy2 - 2 * r * a.sxy + r * r * a.sx2);
  // Small-sample correction k / (k - 1) over k shoes.
  const corr = a.shoes > 1 ? a.shoes / (a.shoes - 1) : 1;
  const se = a.observed > 0 ? Math.sqrt(resid * corr) / a.observed : Infinity;
  return {
    observed: a.observed,
    played: a.played,
    playedShare: a.observed > 0 ? a.played / a.observed : 0,
    twoHandShare: a.played > 0 ? a.twoHands / a.played : 0,
    ev,
    sd: Math.sqrt(variance),
    avgBet: a.played > 0 ? a.wagered / a.played : 0,
    evObserved: r,
    seObserved: a.shoes > 1 ? se : Infinity,
  };
}

export interface HourlyStats {
  evHour: number;
  /** Half-width of the 95% interval on evHour. */
  evHourCi: number;
  sdHour: number;
  playedPerHour: number;
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
  const playedPerHour = roundsPerHour * s.playedShare;
  const evHour = roundsPerHour * s.evObserved;
  const sdHour = s.sd * Math.sqrt(playedPerHour);
  const positive = s.ev > 0 && s.sd > 0;
  const n0Rounds = positive ? (s.sd / s.ev) ** 2 : null;
  return {
    evHour,
    evHourCi: Z95 * roundsPerHour * s.seObserved,
    sdHour,
    playedPerHour,
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
  return { edge: -s.evObserved / unit, ci: (Z95 * s.seObserved) / unit };
}

/** The precision the run stops at: house edge within +/-0.05%, the best EV/hour within +/-10%. */
export const EDGE_TARGET = 0.0005;
export const EV_REL_TARGET = 0.1;

export function edgePrecise(a: Accum, unit: number): boolean {
  return houseEdge(a, unit).ci <= EDGE_TARGET;
}

/** Relative precision is scale-free, so rounds per hour do not enter it. */
export function evPrecise(a: Accum): boolean {
  const s = summarize(a);
  return s.evObserved !== 0 && Z95 * s.seObserved <= EV_REL_TARGET * Math.abs(s.evObserved);
}

/** The method with the highest EV per observed round (= per hour at any rounds/hour). */
export function bestIndex(accs: readonly Accum[]): number {
  let best = -1;
  let bestEv = -Infinity;
  accs.forEach((a, i) => {
    const r = a.observed > 0 ? a.net / a.observed : -Infinity;
    if (r > bestEv) {
      bestEv = r;
      best = i;
    }
  });
  return best;
}
