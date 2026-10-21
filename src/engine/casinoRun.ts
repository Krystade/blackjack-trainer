import { CasinoSim, type Accum, type SimSpec } from './casinoSim';
import { bestIndex, edgePrecise, evPrecise } from './casinoStats';
import type { BetMethod } from './betMethods';

/**
 * Wave K: one game's run, in chunks. Two simulations share the clock: the
 * basic-strategy house edge and the counted play that scores every betting
 * method. Each keeps going, a chunk at a time and taking turns, until its
 * target is met -- the house edge within +/-0.05%, the best method's EV per
 * hour within +/-10% (casinoStats.ts) -- or the time cap or round budget
 * ends the run, which then reports what it has, with its interval.
 *
 * A generator, so the worker can post progress between chunks and a test can
 * drive it synchronously with a fake clock.
 */

export type RunStatus = 'running' | 'done' | 'time' | 'budget';

export interface RunProgress {
  status: RunStatus;
  basic: Accum;
  /** Null for a continuous shuffler: there is nothing to count. */
  methods: { method: BetMethod; acc: Accum }[] | null;
  basicRounds: number;
  countRounds: number;
  ms: number;
  /** 0..1, for a progress bar: the slower of the two targets (or the clock). */
  fraction: number;
}

export interface RunOptions {
  seed: number;
  /** The phone-scale time cap. */
  timeCapMs: number;
  /** A round budget per simulation (tests, and the e2e hook); absent = none. */
  maxRounds?: number;
  now: () => number;
  /**
   * Rounds of table time one exit costs (rounds/hour x minutes per exit / 60),
   * for the stopping rule and the progress bar only: the stored sums carry
   * the exits, and the figures charge whatever the setting is when shown.
   */
  exitRounds?: number;
  /** Rounds per chunk; the defaults keep a chunk well under 100 ms on a phone. */
  basicChunk?: number;
  countChunk?: number;
}

/**
 * No stopping on a lucky early streak: both runs go at least this far. Review
 * S3: the time cap does not end a run short of it either, so a busy phone (or
 * a worker suspended while the screen was locked) cannot hand back a figure
 * from a few thousand rounds. Past it, the clock still decides how far a
 * capped run gets, and the figures carry their interval.
 */
export const MIN_ROUNDS = 200_000;
/** Beyond these the targets are out of reach anyway (an EV near zero). */
export const MAX_BASIC_ROUNDS = 60_000_000;
export const MAX_COUNT_ROUNDS = 30_000_000;

const SALT_COUNT = 0x9e3779b9;

export function* runGame(spec: SimSpec, opts: RunOptions): Generator<RunProgress, RunProgress> {
  const start = opts.now();
  const basic = new CasinoSim(spec, 'basic', opts.seed >>> 0);
  const count = spec.csm ? null : new CasinoSim(spec, 'count', (opts.seed ^ SALT_COUNT) >>> 0);
  const budget = opts.maxRounds;
  const minRounds = budget !== undefined ? Math.min(MIN_ROUNDS, budget) : MIN_ROUNDS;
  const basicCap = Math.min(budget ?? Infinity, MAX_BASIC_ROUNDS);
  const countCap = Math.min(budget ?? Infinity, MAX_COUNT_ROUNDS);
  const basicChunk = opts.basicChunk ?? 50_000;
  const countChunk = opts.countChunk ?? 25_000;
  const exitRounds = opts.exitRounds ?? 0;

  const basicDone = () => basic.rounds >= basicCap || (basic.rounds >= minRounds && edgePrecise(basic.basicAccum(), spec.unit));
  const countDone = () => {
    if (!count) return true;
    if (count.rounds >= countCap) return true;
    if (count.rounds < minRounds) return false;
    const accs = count.methodAccums().map((m) => m.acc);
    const best = bestIndex(accs, exitRounds);
    return best >= 0 && evPrecise(accs[best]!, exitRounds);
  };

  const snapshot = (status: RunStatus): RunProgress => {
    const ms = opts.now() - start;
    // Progress toward the round counts the targets need, never past 99% while running.
    const bFrac = basicDone() ? 1 : Math.min(0.99, basic.rounds / Math.max(minRounds, roundsForEdge(basic, spec.unit)));
    const cFrac = countDone() ? 1 : Math.min(0.99, count ? count.rounds / Math.max(minRounds, roundsForEv(count, exitRounds)) : 1);
    const clock = ms / opts.timeCapMs;
    return {
      status,
      basic: basic.basicAccum(),
      methods: count ? count.methodAccums() : null,
      basicRounds: basic.rounds,
      countRounds: count?.rounds ?? 0,
      ms,
      fraction: status === 'running' ? Math.min(0.99, Math.max(Math.min(bFrac, cFrac), clock)) : 1,
    };
  };

  for (;;) {
    const bd = basicDone();
    const cd = countDone();
    if (bd && cd) {
      const hitBudget = (budget !== undefined && basic.rounds >= budget) || (count !== null && budget !== undefined && count.rounds >= budget);
      return snapshot(hitBudget ? 'budget' : 'done');
    }
    const floorMet = basic.rounds >= minRounds && (!count || count.rounds >= minRounds);
    if (floorMet && opts.now() - start >= opts.timeCapMs) return snapshot('time');
    if (!bd) basic.run(Math.min(basicChunk, basicCap - basic.rounds));
    if (!cd && count) count.run(Math.min(countChunk, countCap - count.rounds));
    yield snapshot('running');
  }
}

/** Rounds the house edge needs at its current spread, for the progress bar. */
function roundsForEdge(sim: CasinoSim, unit: number): number {
  const a = sim.basicAccum();
  if (a.played < 2) return MIN_ROUNDS;
  const mean = a.net / a.played;
  const sd = Math.sqrt(Math.max(0, a.net2 / a.played - mean * mean)) / unit;
  return ((1.96 * sd) / 0.0005) ** 2;
}

/** Rounds the best method's EV needs for +/-10%, for the progress bar. */
function roundsForEv(sim: CasinoSim, exitRounds: number): number {
  const accs = sim.methodAccums().map((m) => m.acc);
  const best = bestIndex(accs, exitRounds);
  const a = accs[best];
  if (!a || a.observed < 2 || a.net <= 0) return MAX_COUNT_ROUNDS;
  const time = a.observed + exitRounds * a.exits;
  const mean = a.net / time;
  const sd = Math.sqrt(Math.max(0, a.net2 / time - mean * mean));
  // Rounds of table time per simulated round, so the estimate is in simulated rounds.
  return ((1.96 * sd) / (0.1 * mean)) ** 2 * (sim.rounds / time);
}
