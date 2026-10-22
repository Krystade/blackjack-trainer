import { CasinoSim, mergeAccum, type Accum, type SimSpec } from './casinoSim';
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
 *
 * Wave Q: a run can CONTINUE an earlier one (`prior`). It deals its own rounds
 * from its own seed and reports the two runs' sums added together
 * (mergeAccum); every target, cap and budget is judged on that total, and the
 * clock counts the earlier run's time too. So a game's figures can be worked
 * out in pieces -- a quick first estimate, then more whenever the phone is
 * free -- and land exactly where one run of the same total would.
 */

/** What an earlier run left: its sums, its rounds and its time (all cumulative). */
export interface RunPrior {
  basic: Accum;
  methods: { method: BetMethod; acc: Accum }[] | null;
  basicRounds: number;
  countRounds: number;
  ms: number;
}

export type RunStatus = 'running' | 'done' | 'time' | 'budget';

export interface RunProgress {
  status: RunStatus;
  /** With a `prior`, every figure here is the total of both runs. */
  basic: Accum;
  /** Null for a continuous shuffler: there is nothing to count. */
  methods: { method: BetMethod; acc: Accum }[] | null;
  basicRounds: number;
  countRounds: number;
  ms: number;
  /** 0..1, for a progress bar: the slower of the two targets (or the clock). */
  fraction: number;
  /**
   * Wave Q re-review R1: the seeds that carry on each simulation's stream
   * exactly where this run has dealt it to (CasinoSim `nextSeed`; the count
   * one is passed through untouched for a shuffler, which deals none). A run
   * that continues this one is seeded with them, so it deals no draw this
   * one dealt.
   */
  seeds: { basic: number; count: number };
}

export interface RunOptions {
  seed: number;
  /** The counted simulation's seed; absent = `seed` salted (a game's first run). */
  countSeed?: number;
  /** The phone-scale time cap, on the total time (the prior run's included). */
  timeCapMs: number;
  /** A round budget per simulation, on the total rounds (tests, the e2e hook, the quick first pass); absent = none. */
  maxRounds?: number;
  /** Wave Q: an earlier run of the same spec to continue (see the header). */
  prior?: RunPrior;
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

/**
 * Review S1: whether continuing a result would deal any rounds at all -- a
 * target still open below its round ceiling. The same tests runGame stops on:
 * the house edge until it is precise or MAX_BASIC_ROUNDS, the best method's
 * EV/hour (counted games) until it is precise or MAX_COUNT_ROUNDS. A count
 * whose EV sits near zero can miss the ±10% target at the ceiling; continuing
 * it adds nothing.
 */
export function wouldContinue(
  r: { basic: Accum; basicRounds: number; methods: { method: BetMethod; acc: Accum }[] | null; countRounds: number },
  spec: Pick<SimSpec, 'unit' | 'csm'>,
  exitRounds = 0,
): boolean {
  if (r.basicRounds < MAX_BASIC_ROUNDS && !edgePrecise(r.basic, spec.unit)) return true;
  if (spec.csm || !r.methods || r.methods.length === 0) return false;
  if (r.countRounds >= MAX_COUNT_ROUNDS) return false;
  const accs = r.methods.map((m) => m.acc);
  const best = bestIndex(accs, exitRounds);
  return !(best >= 0 && evPrecise(accs[best]!, exitRounds));
}

export function* runGame(spec: SimSpec, opts: RunOptions): Generator<RunProgress, RunProgress> {
  const start = opts.now();
  const basic = new CasinoSim(spec, 'basic', opts.seed >>> 0);
  const countSeed = (opts.countSeed ?? opts.seed ^ SALT_COUNT) >>> 0;
  const count = spec.csm ? null : new CasinoSim(spec, 'count', countSeed);
  const prior = priorFor(spec, opts.prior);
  const budget = opts.maxRounds;
  const minRounds = budget !== undefined ? Math.min(MIN_ROUNDS, budget) : MIN_ROUNDS;
  const basicCap = Math.min(budget ?? Infinity, MAX_BASIC_ROUNDS);
  const countCap = Math.min(budget ?? Infinity, MAX_COUNT_ROUNDS);
  const basicChunk = opts.basicChunk ?? 50_000;
  const countChunk = opts.countChunk ?? 25_000;
  const exitRounds = opts.exitRounds ?? 0;

  // The totals: this run's rounds and sums plus the prior run's.
  const basicRounds = () => basic.rounds + (prior?.basicRounds ?? 0);
  const countRounds = () => (count ? count.rounds + (prior?.countRounds ?? 0) : 0);
  const basicAcc = () => (prior ? mergeAccum(prior.basic, basic.basicAccum()) : basic.basicAccum());
  const methodAccs = (): { method: BetMethod; acc: Accum }[] | null => {
    if (!count) return null;
    const own = count.methodAccums();
    const before = prior?.methods;
    return before ? own.map((m, i) => ({ method: m.method, acc: mergeAccum(before[i]!.acc, m.acc) })) : own;
  };
  const elapsed = () => opts.now() - start + (prior?.ms ?? 0);

  const basicDone = () => basicRounds() >= basicCap || (basicRounds() >= minRounds && edgePrecise(basicAcc(), spec.unit));
  const countDone = () => {
    if (!count) return true;
    if (countRounds() >= countCap) return true;
    if (countRounds() < minRounds) return false;
    const accs = methodAccs()!.map((m) => m.acc);
    const best = bestIndex(accs, exitRounds);
    return best >= 0 && evPrecise(accs[best]!, exitRounds);
  };

  const snapshot = (status: RunStatus): RunProgress => {
    const ms = elapsed();
    const b = basicAcc();
    const methods = methodAccs();
    // Progress toward the round counts the targets need, never past 99% while running.
    const bFrac = basicDone() ? 1 : Math.min(0.99, basicRounds() / Math.max(minRounds, roundsForEdge(b, spec.unit)));
    const cFrac = countDone() ? 1 : Math.min(0.99, methods ? countRounds() / Math.max(minRounds, roundsForEv(methods, countRounds(), exitRounds)) : 1);
    const clock = ms / opts.timeCapMs;
    return {
      status,
      basic: b,
      methods,
      basicRounds: basicRounds(),
      countRounds: countRounds(),
      ms,
      fraction: status === 'running' ? Math.min(0.99, Math.max(Math.min(bFrac, cFrac), clock)) : 1,
      seeds: { basic: basic.nextSeed(), count: count ? count.nextSeed() : countSeed },
    };
  };

  for (;;) {
    const bd = basicDone();
    const cd = countDone();
    if (bd && cd) {
      const hitBudget = (budget !== undefined && basicRounds() >= budget) || (count !== null && budget !== undefined && countRounds() >= budget);
      return snapshot(hitBudget ? 'budget' : 'done');
    }
    const floorMet = basicRounds() >= minRounds && (!count || countRounds() >= minRounds);
    if (floorMet && elapsed() >= opts.timeCapMs) return snapshot('time');
    if (!bd) basic.run(Math.min(basicChunk, basicCap - basicRounds()));
    if (!cd && count) count.run(Math.min(countChunk, countCap - countRounds()));
    yield snapshot('running');
  }
}

/**
 * The prior run, if it is one of this spec: the same methods in the same
 * order (the cache key guarantees it; this is the belt to that brace), and
 * methods exactly when the game is countable. Anything else is not continued.
 */
function priorFor(spec: SimSpec, prior: RunPrior | undefined): RunPrior | null {
  if (!prior) return null;
  if (spec.csm) return prior.methods === null ? prior : null;
  const m = prior.methods;
  if (!m || m.length !== spec.methods.length || m.some((x, i) => x.method.id !== spec.methods[i]!.id)) return null;
  return prior;
}

/** Rounds the house edge needs at its current spread, for the progress bar. */
function roundsForEdge(a: Accum, unit: number): number {
  if (a.played < 2) return MIN_ROUNDS;
  const mean = a.net / a.played;
  const sd = Math.sqrt(Math.max(0, a.net2 / a.played - mean * mean)) / unit;
  return ((1.96 * sd) / 0.0005) ** 2;
}

/** Rounds the best method's EV needs for +/-10%, for the progress bar. */
function roundsForEv(methods: { acc: Accum }[], simRounds: number, exitRounds: number): number {
  const accs = methods.map((m) => m.acc);
  const best = bestIndex(accs, exitRounds);
  const a = accs[best];
  if (!a || a.observed < 2 || a.net <= 0) return MAX_COUNT_ROUNDS;
  const time = a.observed + exitRounds * a.exits;
  const mean = a.net / time;
  const sd = Math.sqrt(Math.max(0, a.net2 / time - mean * mean));
  // Rounds of table time per simulated round, so the estimate is in simulated rounds.
  return ((1.96 * sd) / (0.1 * mean)) ** 2 * (simRounds / time);
}
