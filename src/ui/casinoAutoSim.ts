import { MIN_ROUNDS } from '../engine/casinoRun';
import type { GameResult, SimInput } from '../store/casinoGameStats';
import type { RankRow } from './casinoRanking';

/**
 * Wave Q: FIGURES THAT FOLLOW THE RULES. Every logged game's figures are
 * worked out on their own -- no Compute button -- whenever what they depend on
 * changes: a rule, the cut, the bets, the Play profile's counting setup, the
 * betting methods, an import, or SIM_VERSION. All of that is the cache key
 * (store/casinoGameStats.ts `simInputFor`), so "needs working out" is exactly
 * "no result for its key".
 *
 * The plan for the one worker, pure so it is pinned by casinoAutoSim.test.ts
 * (simRunner.ts runs it):
 *
 *  1. FIRST, AN ESTIMATE FOR EVERY GAME. A quick run of QUICK_ROUNDS per
 *     simulation (the review S3 floor below which no figure is ever shown):
 *     about a tenth of a second on a desktop, a few on a slow phone, so every
 *     game has an EV/hour within seconds of an import. It is the simulator's
 *     own figure with its own interval, marked "Estimate" -- not a second,
 *     analytic model that would disagree with it (an infinite-deck edge is
 *     0.1% off a six-deck shoe and 0.3% off a double deck, and has no EV/hour
 *     for a counter at all).
 *  2. THEN THE FULL RUN, best first: each game continues from its estimate
 *     (casinoRun.ts `prior`) until both targets are met or its total time
 *     reaches AUTO_CAP_MS -- the per-game minute the manual button always had.
 *     "Run another minute" on the stats card raises one game's cap, up to
 *     MAX_TIME_CAP_MS, and the same machinery does the rest.
 *
 * ORDER. The game whose stats card is open goes first (its card shows the run
 * live); then games whose inputs changed most recently (the rule just edited);
 * then the ranking's order, top first -- the figures that decide where to
 * play. Avoid casinos come after playable ones; burned casinos and variant
 * games are not in the plan at all (the ranking leaves out the one and the
 * simulator does not model the other).
 *
 * Two games dealt alike share a key, and are worked out once (resultForKey).
 */

/** The quick first pass, per simulation: the floor below which no figure is shown (review S3). */
export const QUICK_ROUNDS = MIN_ROUNDS;
/** A game's total time, every run together, unless "Run another minute" raised it. */
export const AUTO_CAP_MS = 60_000;
/** What "Run another minute" adds, and the most it can reach (review S3's ceiling). */
export const EXTEND_MS = 60_000;
export const MAX_TIME_CAP_MS = 5 * 60_000;

export type AutoWork = 'first' | 'refine';

export interface AutoCandidate {
  gameId: string;
  input: SimInput;
  /** Rounds one exit costs at this game, for the stopping rule (casinoRun.ts). */
  exitRounds: number;
  profileName: string;
}

export interface AutoJob {
  cand: AutoCandidate;
  work: AutoWork;
  /** The result being continued (`refine`); undefined for a first pass. */
  prior: GameResult | undefined;
}

/** The total time a result may take. */
export function capOf(r: Pick<GameResult, 'capMs'>): number {
  return r.capMs ?? AUTO_CAP_MS;
}

/**
 * What a game still needs, given its result for its inputs as they are now:
 * a first estimate with none, more rounds while it is unfinished and under its
 * cap, else nothing. A result stopped by hand in a build before Wave Q
 * ('cancelled') is continued like a paused one.
 */
export function workFor(r: GameResult | undefined): AutoWork | null {
  if (!r) return 'first';
  const open = r.status === 'partial' || r.status === 'cancelled' || r.status === 'running';
  return open && r.ms < capOf(r) ? 'refine' : null;
}

/**
 * The next job: the open card's game if it needs anything, else the first
 * game still without an estimate, else the first to refine -- each in the
 * candidates' order (`orderCandidates`). Keys in `skip` (a run that failed,
 * or one that could not be saved) are passed over. With `refines` false (a
 * casino session is running: the phone is on at the table, and its battery
 * matters), only first estimates are made, and the open card's game is still
 * firmed up: he opened it at the table to decide on it (re-review ruling).
 */
export function pickJob(
  cands: readonly AutoCandidate[],
  lookup: (c: AutoCandidate) => GameResult | undefined,
  visible: string | null,
  skip: ReadonlySet<string> = new Set(),
  refines = true,
): AutoJob | null {
  const jobs: AutoJob[] = [];
  for (const cand of cands) {
    if (skip.has(cand.input.key)) continue;
    const prior = lookup(cand);
    const work = workFor(prior);
    if (work === 'refine' && !refines && cand.gameId !== visible) continue;
    if (work) jobs.push({ cand, work, prior: work === 'refine' ? prior : undefined });
  }
  return jobs.find((j) => j.cand.gameId === visible) ?? jobs.find((j) => j.work === 'first') ?? jobs[0] ?? null;
}

/**
 * Whether `next` should stop the run in progress (which keeps what it has:
 * simRunner.ts merges it into the stored result). Only for something more
 * urgent: the open card's game, or a game with no estimate at all while
 * another is being refined. Never for the same key -- that run is the job.
 */
export function shouldPreempt(running: { gameId: string; key: string; work: AutoWork }, next: AutoJob, visible: string | null): boolean {
  if (next.cand.input.key === running.key) return false;
  if (visible !== null && next.cand.gameId === visible) return true;
  return next.work === 'first' && running.work === 'refine';
}

/**
 * The plan's order from the ranking (sorted by EV/hour, games without figures
 * last in log order): playable before Avoid, then the most recently changed
 * inputs first, then the ranking's order. Variant games are left out.
 */
export function orderCandidates(rows: readonly RankRow[], editedAt: ReadonlyMap<string, number>, profileName: string): AutoCandidate[] {
  return rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => !r.notModelled)
    .sort(
      (a, b) =>
        (a.r.greyed ? 1 : 0) - (b.r.greyed ? 1 : 0) ||
        (editedAt.get(b.r.game.id) ?? 0) - (editedAt.get(a.r.game.id) ?? 0) ||
        a.i - b.i,
    )
    .map(({ r }) => ({ gameId: r.game.id, input: r.input, exitRounds: r.exitRounds, profileName }));
}

/**
 * Which games' inputs just changed, for the order above: a game whose key
 * differs from the one last seen, or a game that appears after the first
 * look (added, imported). The first look itself marks nothing.
 */
export interface EditTracker {
  seen: Map<string, string>;
  editedAt: Map<string, number>;
  primed: boolean;
  stamp: number;
}

export function newEditTracker(): EditTracker {
  return { seen: new Map(), editedAt: new Map(), primed: false, stamp: 0 };
}

export function noteKeys(t: EditTracker, games: readonly { id: string; key: string }[]): void {
  let changed = false;
  const stamp = t.stamp + 1;
  for (const g of games) {
    const prev = t.seen.get(g.id);
    if (t.primed && prev !== g.key) {
      t.editedAt.set(g.id, stamp);
      changed = true;
    }
    t.seen.set(g.id, g.key);
  }
  if (changed) t.stamp = stamp;
  t.primed = true;
}

/**
 * Runs still to make, by kind, the running one included: by key, as two games
 * dealt alike are worked out once (review N5). Keys in `skip` will not be
 * worked on, so are not counted.
 */
export function workCounts(
  cands: readonly AutoCandidate[],
  lookup: (c: AutoCandidate) => GameResult | undefined,
  skip: ReadonlySet<string> = new Set(),
): { first: number; refine: number } {
  let first = 0;
  let refine = 0;
  const seen = new Set<string>();
  for (const c of cands) {
    if (skip.has(c.input.key) || seen.has(c.input.key)) continue;
    seen.add(c.input.key);
    const w = workFor(lookup(c));
    if (w === 'first') first += 1;
    else if (w === 'refine') refine += 1;
  }
  return { first, refine };
}
