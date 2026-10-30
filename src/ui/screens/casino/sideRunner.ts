import { useEffect, useState } from 'react';
import type { SideRowSpec } from '../../../engine/sideBets/build';
import { saveSideRow, sideSpecKey, subscribeSideRows } from '../../../store/casinoSideRows';
import type { SideWorkerMessage } from './sideBet.worker';

/**
 * Wave L: runs side-bet simulations one at a time in a worker, for the
 * game stats card. A spec already queued or running is not queued twice;
 * a finished row lands in the cache (store/casinoSideRows.ts), whose
 * listeners re-render the card and the ranking.
 *
 * D22: WHEN IT RUNS -- the same policy as the main runner (simRunner.ts).
 * Only while a Casino screen is attached (AutoSim) and the page is visible:
 * away from Casino -- the car drills, above all -- or with the phone locked,
 * the worker is stopped. It used to build one 300,000-round row after another
 * for every side bet in the log (all of them, after a simulator version bump)
 * until the queue ran dry, wherever Jack had gone. A row is all or nothing, so
 * a stopped one goes back to the front of the queue and starts again when
 * Casino is back.
 *
 * And while a casino session is running (the battery matters at the table),
 * only the side bets of a card that is OPEN start: those are figures being
 * looked at. The rest wait for the session's end. A row already running when
 * the session starts is left to finish.
 */

interface Queued {
  spec: SideRowSpec;
  key: string;
  /** Asked for by an open game card: runs even during a session. */
  open: boolean;
}

let queue: Queued[] = [];
let running: Queued | null = null;
let worker: Worker | null = null;
let attached = 0;
let hidden = false;
let holdForSession = false;
const failed = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of [...listeners]) fn();
};

type WorkerFactory = () => Worker;
const defaultFactory: WorkerFactory = () => new Worker(new URL('./sideBet.worker.ts', import.meta.url), { type: 'module' });
let makeWorker: WorkerFactory = defaultFactory;

function stopped(): boolean {
  return attached === 0 || hidden;
}

/** Stop the row in progress and put it back at the front: it starts over. */
function stopRunning(): void {
  if (!running) return;
  worker?.terminate();
  worker = null;
  queue.unshift(running);
  running = null;
  notify();
}

function next(): void {
  if (running !== null || stopped()) return;
  const at = queue.findIndex((q) => !holdForSession || q.open);
  if (at < 0) return;
  const [job] = queue.splice(at, 1);
  const { spec, key } = job;
  running = job;
  notify();
  let w: Worker;
  try {
    w = makeWorker();
  } catch (err) {
    failed.set(key, err instanceof Error ? err.message : 'This browser cannot run the simulator.');
    running = null;
    queue = [];
    notify();
    return;
  }
  worker = w;
  w.onmessage = (e: MessageEvent<SideWorkerMessage>) => {
    if (w !== worker) return;
    w.terminate();
    worker = null;
    if (e.data.type === 'done') saveSideRow(spec, e.data.row);
    else failed.set(key, e.data.message);
    running = null;
    notify();
    next();
  };
  w.onerror = (e) => {
    if (w !== worker) return;
    w.terminate();
    worker = null;
    failed.set(key, e.message || 'The side-bet simulation failed.');
    running = null;
    notify();
    next();
  };
  w.postMessage(spec);
}

/**
 * `forOpenCard`: the game stats card is showing this bet, so it runs even
 * while a session holds the rest (and a queued request from the ranking is
 * moved up to it).
 */
export function requestSideRow(spec: SideRowSpec, opts: { forOpenCard?: boolean } = {}): void {
  const key = sideSpecKey(spec);
  const open = opts.forOpenCard === true;
  if (running?.key === key || failed.has(key)) return;
  const at = queue.findIndex((q) => q.key === key);
  if (at >= 0) {
    if (!open || queue[at].open) return;
    queue.splice(at, 1);
  }
  const job = { spec, key, open };
  if (open) queue.unshift(job);
  else queue.push(job);
  next();
}

/** A casino session is running: only an open card's side bets start until it ends. */
export function setSideHold(sessionRunning: boolean): void {
  holdForSession = sessionRunning;
  next();
}

function setHidden(h: boolean): void {
  hidden = h;
  if (h) stopRunning();
  else next();
}

function onVisibility(): void {
  setHidden(typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

/** A Casino screen is up: side bets run while it is (and the page is visible). Returns the detach. */
export function attachSide(): () => void {
  attached += 1;
  if (attached === 1 && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
    hidden = document.visibilityState === 'hidden';
  }
  next();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    attached -= 1;
    if (attached > 0) return;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    stopRunning();
  };
}

export function sideRunState(spec: SideRowSpec): 'running' | 'queued' | 'failed' | 'idle' {
  const key = sideSpecKey(spec);
  if (running?.key === key) return 'running';
  if (queue.some((q) => q.key === key)) return 'queued';
  if (failed.has(key)) return 'failed';
  return 'idle';
}

/** Re-render on any side-bet run or cache change. */
export function useSideRuns(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    const off = subscribeSideRows(bump);
    return () => {
      listeners.delete(bump);
      off();
    };
  }, []);
  return tick;
}

// ---------------------------------------------------------------- tests

/** Tests only: a fake worker in place of the real one. */
export function _setSideWorkerFactory(f: WorkerFactory | null): void {
  makeWorker = f ?? defaultFactory;
}

/** Tests only: page visibility without a document. */
export function _setSideHidden(h: boolean): void {
  setHidden(h);
}

/** Tests only: back to a fresh module. */
export function _resetSideRunner(): void {
  worker?.terminate();
  worker = null;
  queue = [];
  running = null;
  attached = 0;
  hidden = false;
  holdForSession = false;
  failed.clear();
}
