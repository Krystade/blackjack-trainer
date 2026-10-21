import { useEffect, useState } from 'react';
import type { SideRowSpec } from '../../../engine/sideBets/build';
import { saveSideRow, sideSpecKey, subscribeSideRows } from '../../../store/casinoSideRows';
import type { SideWorkerMessage } from './sideBet.worker';

/**
 * Wave L: runs side-bet simulations one at a time in a worker, for the
 * game stats card. A spec already queued or running is not queued twice;
 * a finished row lands in the cache (store/casinoSideRows.ts), whose
 * listeners re-render the card and the ranking.
 */

let queue: SideRowSpec[] = [];
let running: string | null = null;
const failed = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const fn of [...listeners]) fn();
};

function next(): void {
  if (running !== null) return;
  const spec = queue.shift();
  if (!spec) return;
  const key = sideSpecKey(spec);
  running = key;
  notify();
  let worker: Worker;
  try {
    worker = new Worker(new URL('./sideBet.worker.ts', import.meta.url), { type: 'module' });
  } catch (err) {
    failed.set(key, err instanceof Error ? err.message : 'This browser cannot run the simulator.');
    running = null;
    queue = [];
    notify();
    return;
  }
  worker.onmessage = (e: MessageEvent<SideWorkerMessage>) => {
    worker.terminate();
    if (e.data.type === 'done') saveSideRow(spec, e.data.row);
    else failed.set(key, e.data.message);
    running = null;
    notify();
    next();
  };
  worker.onerror = (e) => {
    worker.terminate();
    failed.set(key, e.message || 'The side-bet simulation failed.');
    running = null;
    notify();
    next();
  };
  worker.postMessage(spec);
}

export function requestSideRow(spec: SideRowSpec): void {
  const key = sideSpecKey(spec);
  if (running === key || queue.some((s) => sideSpecKey(s) === key) || failed.has(key)) return;
  queue.push(spec);
  next();
}

export function sideRunState(spec: SideRowSpec): 'running' | 'queued' | 'failed' | 'idle' {
  const key = sideSpecKey(spec);
  if (running === key) return 'running';
  if (queue.some((s) => sideSpecKey(s) === key)) return 'queued';
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
