import { gameStatsUnsaved, loadGameCache, resultForKey, runSeed, saveGameResult, type GameResult, type ResultStatus } from '../../../store/casinoGameStats';
import { MIN_ROUNDS, type RunPrior, type RunProgress } from '../../../engine/casinoRun';
import {
  AUTO_CAP_MS,
  EXTEND_MS,
  MAX_TIME_CAP_MS,
  QUICK_ROUNDS,
  capOf,
  pickJob,
  shouldPreempt,
  workCounts,
  type AutoCandidate,
  type AutoJob,
  type AutoWork,
} from '../../casinoAutoSim';
import type { SimMessage, SimRequest } from './casinoSim.worker';

/**
 * Wave K: the one simulation running. Module state, not component state, so a
 * run carries on while the Casino tab moves between views.
 *
 * Wave Q: no queue to fill by hand. The Casino screen hands over the plan --
 * every game it could work out, in order (casinoAutoSim.ts `orderCandidates`)
 * -- and which game's card is open, and this runs whatever `pickJob` says
 * next, one game at a time in one worker, until nothing is left to do.
 *
 * WHEN IT RUNS. Only while a Casino screen is mounted and the page is
 * visible: hidden (the phone locked, another app, another tab) or away from
 * Casino -- the car drills, above all -- the worker is stopped. Stopping
 * loses nothing worth keeping: a refining run's progress so far is merged
 * into the stored result (its sums are complete at every chunk), and the next
 * run continues from there with fresh rounds; only a first pass short of the
 * S3 floor is dropped, and starts again. A refining run is also saved every
 * CHECKPOINT_MS, so a page the phone kills outright keeps most of it.
 */

/** How often a long run is saved as it goes. */
export const CHECKPOINT_MS = 15_000;
/** Progress repaints at most this often: the ranking is not redrawn twenty times a second. */
export const PROGRESS_PAINT_MS = 500;

export interface RunnerState {
  running: { gameId: string; key: string; work: AutoWork; progress: RunProgress | null } | null;
  /** Games still to work out (`first`) or to firm up (`refine`), the running one included. */
  todo: { first: number; refine: number };
  /** Nothing runs: no Casino screen, or the page is hidden. */
  paused: boolean;
  /** The last failure's message, and the inputs (keys) that failed: not tried again this session. */
  error: string | null;
  failed: readonly string[];
  /** Review B1: figures worked out this session could not be saved (the phone's storage is full). */
  storageFull: boolean;
  /** The keys whose figures could not be saved: shown, not worked on again this session. */
  unsaved: readonly string[];
}

let state: RunnerState = { running: null, todo: { first: 0, refine: 0 }, paused: true, error: null, failed: [], storageFull: false, unsaved: [] };
const listeners = new Set<() => void>();

interface Running {
  job: AutoJob;
  /** Runs merged into the result once this one is saved. */
  runs: number;
  progress: RunProgress | null;
  savedMs: number;
}

let cands: AutoCandidate[] = [];
let visible: string | null = null;
let attached = 0;
let hidden = false;
let running: Running | null = null;
let worker: Worker | null = null;
/** Keys whose run failed: not tried again this session (it would only fail again). */
const failed = new Set<string>();
/**
 * Review B1: keys whose figures could not be saved. They show this session
 * (store/casinoGameStats.ts keeps them in memory) and are not worked on again:
 * every further run would fail to save too, and a first pass would never see
 * its own result and start over, forever.
 */
const unsavedKeys = new Set<string>();
let error: string | null = null;
let paintTimer: ReturnType<typeof setTimeout> | null = null;
let lastPaint = 0;

type WorkerFactory = () => Worker;
const defaultFactory: WorkerFactory = () => new Worker(new URL('./casinoSim.worker.ts', import.meta.url), { type: 'module' });
let makeWorker: WorkerFactory = defaultFactory;

export function runnerState(): RunnerState {
  return state;
}

export function subscribeRunner(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Test hook (e2e only): `window.__bjCasinoSimBudget = 4000` caps each game at
 * that many rounds per simulation, so a spec finishes in a second, the same
 * every time. Never set by the app.
 */
function budget(): number | undefined {
  const w = globalThis as { __bjCasinoSimBudget?: unknown };
  return typeof w.__bjCasinoSimBudget === 'number' && w.__bjCasinoSimBudget > 0 ? w.__bjCasinoSimBudget : undefined;
}

function lookupFn(): (c: AutoCandidate) => GameResult | undefined {
  const { results, archive } = loadGameCache();
  return (c) => resultForKey(results, archive, c.gameId, c.input.key);
}

function publish(): void {
  if (paintTimer !== null) {
    clearTimeout(paintTimer);
    paintTimer = null;
  }
  lastPaint = Date.now();
  const lookup = lookupFn();
  state = {
    running: running
      ? { gameId: running.job.cand.gameId, key: running.job.cand.input.key, work: running.job.work, progress: running.progress }
      : null,
    todo: workCounts(cands, lookup, skipped()),
    paused: attached === 0 || hidden,
    error,
    failed: [...failed],
    storageFull: unsavedKeys.size > 0 || gameStatsUnsaved(),
    unsaved: [...unsavedKeys],
  };
  for (const fn of [...listeners]) fn();
}

/** A progress tick: painted at most every PROGRESS_PAINT_MS. */
function publishSoon(): void {
  if (paintTimer !== null) return;
  const wait = Math.max(0, PROGRESS_PAINT_MS - (Date.now() - lastPaint));
  if (wait === 0) publish();
  else paintTimer = setTimeout(publish, wait);
}

function toPrior(r: GameResult): RunPrior {
  return { basic: r.basic, methods: r.methods, basicRounds: r.basicRounds, countRounds: r.countRounds, ms: r.ms };
}

/** Whether `p` reached the test budget (as opposed to the quick pass's own round count). */
function atTestBudget(p: RunProgress): boolean {
  const b = budget();
  return b !== undefined && (p.basicRounds >= b || p.countRounds >= b);
}

function save(run: Running, p: RunProgress, status: ResultStatus): void {
  const { cand, prior } = run.job;
  const capMs = prior?.capMs;
  const r: GameResult = {
    key: cand.input.key,
    computedAt: new Date().toISOString(),
    profileName: cand.profileName,
    status,
    ms: Math.round(p.ms),
    basicRounds: p.basicRounds,
    countRounds: p.countRounds,
    unit: cand.input.spec.unit,
    basic: p.basic,
    methods: p.methods,
    runs: run.runs,
    ...(capMs !== undefined ? { capMs } : {}),
  };
  // A paused or checkpointed run that has used its time is finished.
  if (r.status === 'partial' && r.ms >= capOf(r)) r.status = 'time';
  if (!saveGameResult(cand.gameId, r)) unsavedKeys.add(cand.input.key);
}

/** Keys not to schedule: a failed run, or figures that could not be saved. */
function skipped(): Set<string> {
  return new Set([...failed, ...unsavedKeys]);
}

function finalStatus(p: RunProgress): ResultStatus {
  // The quick pass ends on its own round count: an estimate, with more to come.
  if (p.status === 'budget') return atTestBudget(p) ? 'budget' : 'partial';
  return p.status === 'running' ? 'partial' : p.status;
}

/** Whether a run's progress is worth keeping: a refine always; a first pass only past the S3 floor. */
function keepable(run: Running, p: RunProgress | null): p is RunProgress {
  if (!p) return false;
  if (run.job.work === 'refine') return true;
  const csm = run.job.cand.input.spec.csm;
  return p.basicRounds >= MIN_ROUNDS && (csm || p.countRounds >= MIN_ROUNDS);
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

/** Stop the run in progress, keeping what it has (see the header). */
function pause(): void {
  const run = running;
  dropWorker();
  running = null;
  if (run && keepable(run, run.progress)) save(run, run.progress, 'partial');
}

/** Stop the run in progress and throw it away: its inputs are not any game's now. */
function abort(): void {
  dropWorker();
  running = null;
}

function start(job: AutoJob): void {
  if (!worker) {
    try {
      worker = makeWorker();
    } catch (err) {
      error = err instanceof Error ? err.message : 'This browser cannot run the simulator.';
      failed.add(job.cand.input.key);
      return;
    }
    const w = worker;
    w.onmessage = (e: MessageEvent<SimMessage>) => {
      if (w !== worker) return;
      onMessage(e.data);
    };
    w.onerror = (e: ErrorEvent) => {
      if (w !== worker) return;
      onMessage({ type: 'error', message: e.message || 'The simulation failed.' });
    };
  }
  const prior = job.prior;
  const n = prior ? (prior.runs ?? 1) : 0;
  const req: SimRequest = {
    spec: job.cand.input.spec,
    seed: runSeed(job.cand.input, n),
    timeCapMs: prior ? capOf(prior) : AUTO_CAP_MS,
    exitRounds: job.cand.exitRounds,
  };
  if (prior) req.prior = toPrior(prior);
  const b = budget();
  if (job.work === 'first') req.maxRounds = Math.min(QUICK_ROUNDS, b ?? QUICK_ROUNDS);
  else if (b !== undefined) req.maxRounds = b;
  running = { job, runs: n + 1, progress: null, savedMs: prior?.ms ?? 0 };
  worker.postMessage(req);
}

function onMessage(msg: SimMessage): void {
  const run = running;
  if (!run) return;
  if (msg.type === 'error') {
    dropWorker();
    running = null;
    error = msg.message;
    failed.add(run.job.cand.input.key);
    kick();
    return;
  }
  run.progress = msg.progress;
  if (msg.type === 'progress') {
    if (run.job.work === 'refine' && msg.progress.ms - run.savedMs >= CHECKPOINT_MS) {
      run.savedMs = msg.progress.ms;
      save(run, msg.progress, 'partial');
    }
    publishSoon();
    return;
  }
  running = null;
  save(run, msg.progress, finalStatus(msg.progress));
  kick();
}

/** Decide what runs now. Called on every change: the plan, the card, visibility, a run ending. */
function kick(): void {
  if (attached === 0 || hidden) {
    if (running) pause();
    dropWorker();
    publish();
    return;
  }
  if (running && !cands.some((c) => c.input.key === running!.job.cand.input.key)) abort();
  const pick = pickJob(cands, lookupFn(), visible, skipped());
  if (running) {
    const r = running.job;
    if (pick && shouldPreempt({ gameId: r.cand.gameId, key: r.cand.input.key, work: r.work }, pick, visible)) {
      pause();
      start(pick);
    }
  } else if (pick) {
    start(pick);
  }
  publish();
}

/** The Casino screen's plan: every game it could work out, in order, and the game whose card is open. */
export function setAutoPlan(next: AutoCandidate[], openGame: string | null): void {
  cands = next;
  visible = openGame;
  kick();
}

function onVisibility(): void {
  hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  kick();
}

/** A Casino screen is up: run while it is (and the page is visible). Returns the detach. */
export function attachAuto(): () => void {
  attached += 1;
  if (attached === 1 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    hidden = document.visibilityState === 'hidden';
  }
  kick();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    attached -= 1;
    if (attached === 0 && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    kick();
  };
}

/**
 * "Run another minute": one game's cap goes up a minute (to MAX_TIME_CAP_MS at
 * most) and it is worked on again -- first, if its card is open. Review S3:
 * the same seed would deal the same rounds, so the continuation deals fresh
 * ones (runSeed) and adds them to what is there.
 */
export function runAnotherMinute(gameId: string, result: GameResult): void {
  const capMs = Math.min(MAX_TIME_CAP_MS, Math.max(capOf(result), result.ms) + EXTEND_MS);
  if (capMs <= result.ms) return;
  saveGameResult(gameId, { ...result, status: 'partial', capMs });
  kick();
}

/** Whether "Run another minute" can do anything for this result. */
export function canRunLonger(result: GameResult): boolean {
  return result.ms < MAX_TIME_CAP_MS && (result.status === 'time' || result.status === 'done');
}

// ---------------------------------------------------------------- tests

/** Tests only: a fake worker in place of the real one. */
export function _setWorkerFactory(f: WorkerFactory | null): void {
  makeWorker = f ?? defaultFactory;
}

/** Tests only: page visibility without a document. */
export function _setHidden(h: boolean): void {
  hidden = h;
  kick();
}

/** Tests only: back to a fresh module. */
export function _resetRunner(): void {
  dropWorker();
  running = null;
  cands = [];
  visible = null;
  attached = 0;
  hidden = false;
  error = null;
  failed.clear();
  unsavedKeys.clear();
  if (paintTimer !== null) clearTimeout(paintTimer);
  paintTimer = null;
  lastPaint = 0;
  state = { running: null, todo: { first: 0, refine: 0 }, paused: true, error: null, failed: [], storageFull: false, unsaved: [] };
}
