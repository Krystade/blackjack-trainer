import { useEffect, useState } from 'react';
import type { VariantRules } from '../../../engine/variants/rules';
import { variantRulesKey } from '../../casinoVariant';
import type { VariantEdgeMessage } from './variantEdge.worker';

/**
 * C22 follow-up: works out variant house edges for logged rules one at a
 * time in a worker, as sideRunner.ts does side bets. A rule set already
 * worked out, queued or running is not asked for twice; a failure is kept
 * and said rather than retried. Figures are kept for the session only: each
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

let queue: { key: string; rules: VariantRules }[] = [];
let running: string | null = null;
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
  const finish = (fn: () => void) => {
    worker.terminate();
    fn();
    running = null;
    notify();
    next();
  };
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
  queue = [];
  running = null;
  edges.clear();
  failed.clear();
}
