import { useEffect, useState } from 'react';
import type { VariantRules } from '../../../engine/variants/rules';
import { variantRulesKey } from '../../casinoVariant';
import type { VariantEdgeMessage } from './variantEdge.worker';

/**
 * C22 follow-up: works out variant house edges for logged rules one at a
 * time in a worker, as sideRunner.ts does side bets. A rule set already
 * worked out, queued or running is not asked for twice; a failure is kept
 * and said, and retried only when asked (retryVariantEdge). R6: a worker
 * that does not answer within VARIANT_EDGE_TIMEOUT_MS (longer for Switch,
 * whose two-hand choice is the slowest) is stopped and its job failed, so
 * one stuck job cannot hold the queue. Figures are kept for the session only: each
 * is quick, and exact, so there is nothing to refine or to store.
 */

export type VariantEdgeState =
  | { state: 'idle' }
  | { state: 'queued' }
  | { state: 'running' }
  | { state: 'done'; edge: number }
  | { state: 'failed'; message: string };

type WorkerFactory = () => Worker;
const defaultFactory: WorkerFactory = () => new Worker(new URL('./variantEdge.worker.ts', import.meta.url), { type: 'module' });
let makeWorker: WorkerFactory = defaultFactory;

/** R6: per job; a Switch job gets SWITCH_TIMEOUT_FACTOR times this. */
export const VARIANT_EDGE_TIMEOUT_MS = 30_000;
const SWITCH_TIMEOUT_FACTOR = 3;
const TIMEOUT_MESSAGE = 'The house-edge calculation took too long and was stopped.';

let queue: { key: string; rules: VariantRules }[] = [];
let running: string | null = null;
let current: { worker: Worker; timer: ReturnType<typeof setTimeout> } | null = null;
/** Bumped by a reset: a closure from before it does nothing. */
let generation = 0;
const edges = new Map<string, number>();
const failed = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of [...listeners]) fn();
};

function next(): void {
  if (running !== null) return;
  const job = queue.shift();
  if (!job) return;
  running = job.key;
  notify();
  let worker: Worker;
  try {
    worker = makeWorker();
  } catch (err) {
    failed.set(job.key, err instanceof Error ? err.message : 'This browser cannot run the calculation.');
    running = null;
    notify();
    next();
    return;
  }
  const gen = generation;
  const timer = setTimeout(
    () => finish(() => failed.set(job.key, TIMEOUT_MESSAGE)),
    VARIANT_EDGE_TIMEOUT_MS * (job.rules.variant === 'switch' ? SWITCH_TIMEOUT_FACTOR : 1),
  );
  current = { worker, timer };
  let settled = false;
  function finish(fn: () => void): void {
    if (settled || gen !== generation) return;
    settled = true;
    clearTimeout(timer);
    worker.terminate();
    current = null;
    fn();
    running = null;
    notify();
    next();
  }
  worker.onmessage = (e: MessageEvent<VariantEdgeMessage>) =>
    finish(() => {
      if (e.data.type === 'done') edges.set(job.key, e.data.edge);
      else failed.set(job.key, e.data.message);
    });
  worker.onerror = (e) => finish(() => failed.set(job.key, e.message || 'The house-edge calculation failed.'));
  worker.postMessage(job.rules);
}

export function requestVariantEdge(rules: VariantRules): void {
  const key = variantRulesKey(rules);
  if (edges.has(key) || failed.has(key) || running === key || queue.some((j) => j.key === key)) return;
  queue.push({ key, rules });
  next();
}

/** R6: forget a failure and work the edge out again. Does nothing unless it failed. */
export function retryVariantEdge(rules: VariantRules): void {
  const key = variantRulesKey(rules);
  if (!failed.delete(key)) return;
  requestVariantEdge(rules);
  notify();
}

export function variantEdgeState(rules: VariantRules): VariantEdgeState {
  const key = variantRulesKey(rules);
  const edge = edges.get(key);
  if (edge !== undefined) return { state: 'done', edge };
  const message = failed.get(key);
  if (message !== undefined) return { state: 'failed', message };
  if (running === key) return { state: 'running' };
  if (queue.some((j) => j.key === key)) return { state: 'queued' };
  return { state: 'idle' };
}

/** Re-render on any change here. */
export function useVariantEdges(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);
  return tick;
}

/** Test hook: a stand-in worker, or null for the real one. */
export function _setVariantEdgeWorkerFactory(f: WorkerFactory | null): void {
  makeWorker = f ?? defaultFactory;
}

/** Test hook: forget every figure, failure and job. */
export function _resetVariantEdges(): void {
  generation += 1;
  if (current) {
    clearTimeout(current.timer);
    current.worker.terminate();
    current = null;
  }
  queue = [];
  running = null;
  edges.clear();
  failed.clear();
}
