import { loadGameResults, saveGameResult, type SimInput } from '../../../store/casinoGameStats';
import type { RunProgress } from '../../../engine/casinoRun';
import type { SimMessage, SimRequest } from './casinoSim.worker';

/**
 * Wave K: the one simulation running, and the queue behind it ("Compute all"
 * runs games one at a time). Module state, not component state, so a run
 * carries on while the Casino tab moves between views -- or away and back.
 */

/** About a minute on a phone, then it shows what it has, with its interval. */
export const TIME_CAP_MS = 60_000;
/**
 * Review S3: a game whose last run was cut off by the cap is partial, so
 * Compute all runs it again. The same seed deals the same rounds, so a
 * re-run with the same cap would stop in the same place: it gets the last
 * run's time plus another minute, up to this.
 */
export const MAX_TIME_CAP_MS = 5 * 60_000;

export interface QueuedRun {
  gameId: string;
  input: SimInput;
  profileName: string;
  /** Rounds one exit costs at this game (rounds/hour x exit minutes / 60), for the stopping rule. */
  exitRounds?: number;
}

/** The cap for this run: a minute, or more when the last run of the same inputs hit the cap. */
export function timeCapFor(run: QueuedRun): number {
  const prev = loadGameResults()[run.gameId];
  if (!prev || prev.key !== run.input.key || prev.status !== 'time') return TIME_CAP_MS;
  return Math.min(MAX_TIME_CAP_MS, Math.max(TIME_CAP_MS, prev.ms + TIME_CAP_MS));
}

export interface RunnerState {
  running: { gameId: string; progress: RunProgress | null } | null;
  queue: string[];
  error: string | null;
}

let state: RunnerState = { running: null, queue: [], error: null };
let worker: Worker | null = null;
let current: QueuedRun | null = null;
let pending: QueuedRun[] = [];
const listeners = new Set<() => void>();

function set(next: RunnerState): void {
  state = next;
  for (const fn of [...listeners]) fn();
}

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
 * Test hook (e2e only): `window.__bjCasinoSimBudget = 4000` caps each run at
 * that many rounds per simulation, so a spec finishes in a second. Never set
 * by the app.
 */
function budget(): number | undefined {
  const w = globalThis as { __bjCasinoSimBudget?: unknown };
  return typeof w.__bjCasinoSimBudget === 'number' && w.__bjCasinoSimBudget > 0 ? w.__bjCasinoSimBudget : undefined;
}

function store(run: QueuedRun, progress: RunProgress, status: RunProgress['status'] | 'cancelled'): void {
  saveGameResult(run.gameId, {
    key: run.input.key,
    computedAt: new Date().toISOString(),
    profileName: run.profileName,
    status,
    ms: Math.round(progress.ms),
    basicRounds: progress.basicRounds,
    countRounds: progress.countRounds,
    unit: run.input.spec.unit,
    basic: progress.basic,
    methods: progress.methods,
  });
}

function startNext(): void {
  const run = pending.shift();
  if (!run) {
    current = null;
    set({ ...state, running: null, queue: [] });
    return;
  }
  current = run;
  set({ running: { gameId: run.gameId, progress: null }, queue: pending.map((r) => r.gameId), error: null });
  try {
    worker = new Worker(new URL('./casinoSim.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    pending = [];
    current = null;
    set({ running: null, queue: [], error: err instanceof Error ? err.message : 'This browser cannot run the simulator.' });
    return;
  }
  const w = worker;
  w.onmessage = (e: MessageEvent<SimMessage>) => {
    if (w !== worker) return;
    const msg = e.data;
    if (msg.type === 'error') {
      w.terminate();
      worker = null;
      set({ ...state, error: msg.message });
      startNext();
      return;
    }
    if (msg.type === 'progress') {
      set({ ...state, running: { gameId: run.gameId, progress: msg.progress } });
      return;
    }
    store(run, msg.progress, msg.progress.status);
    w.terminate();
    worker = null;
    startNext();
  };
  const req: SimRequest = { spec: run.input.spec, seed: run.input.seed, timeCapMs: timeCapFor(run), exitRounds: run.exitRounds ?? 0 };
  const b = budget();
  if (b !== undefined) req.maxRounds = b;
  w.postMessage(req);
}

/** Queue games (skipping any already queued or running) and start if idle. */
export function enqueue(runs: QueuedRun[]): void {
  const busy = new Set([...pending.map((r) => r.gameId), ...(current ? [current.gameId] : [])]);
  for (const r of runs) {
    if (busy.has(r.gameId)) continue;
    busy.add(r.gameId);
    pending.push(r);
  }
  if (!current) startNext();
  else set({ ...state, queue: pending.map((r) => r.gameId) });
}

/**
 * Stop: the running game keeps what it has so far (marked as stopped, with
 * its interval) if it got far enough to say anything; the queue is dropped.
 */
export function cancelAll(): void {
  const run = current;
  const progress = state.running?.progress ?? null;
  worker?.terminate();
  worker = null;
  pending = [];
  current = null;
  if (run && progress && progress.basicRounds >= 20_000) store(run, progress, 'cancelled');
  set({ running: null, queue: [], error: null });
}
