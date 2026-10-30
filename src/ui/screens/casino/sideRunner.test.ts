import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SideRowSpec } from '../../../engine/sideBets/build';
import {
  _resetSideRunner,
  _setSideHidden,
  _setSideWorkerFactory,
  attachSide,
  requestSideRow,
  setSideHold,
  sideRunState,
} from './sideRunner';
import type { SideWorkerMessage } from './sideBet.worker';

/**
 * D22: the side-bet runner keeps the main runner's hours (simRunner.ts) --
 * nothing runs away from Casino or with the page hidden, a stopped row starts
 * again when Casino is back, and a running casino session holds every row
 * but the open card's.
 */

class FakeWorker {
  posted: SideRowSpec[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<SideWorkerMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(spec: SideRowSpec): void {
    this.posted.push(spec);
  }
  terminate(): void {
    this.terminated = true;
  }
  fail(message: string): void {
    this.onmessage?.({ data: { type: 'error', message } } as MessageEvent<SideWorkerMessage>);
  }
}

let workers: FakeWorker[] = [];
const live = () => workers.filter((w) => !w.terminated);

const spec = (payTable: string): SideRowSpec => ({
  bet: 'perfectPairs',
  payTable,
  decks: 6,
  s17: null,
  cutDecks: 1.5,
  rounds: 300_000,
  seed: 1,
});
const A = spec('a');
const B = spec('b');
const C = spec('c');

beforeEach(() => {
  _resetSideRunner();
  workers = [];
  _setSideWorkerFactory(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
});

afterEach(() => {
  _resetSideRunner();
  _setSideWorkerFactory(null);
});

describe('sideRunner -- when it runs (D22)', () => {
  it('starts nothing until a Casino screen attaches', () => {
    requestSideRow(A);
    expect(workers).toHaveLength(0);
    expect(sideRunState(A)).toBe('queued');
    const detach = attachSide();
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([A]);
    expect(sideRunState(A)).toBe('running');
    detach();
  });

  it('leaving Casino stops the worker, and the row starts again on return', () => {
    const detach = attachSide();
    requestSideRow(A);
    requestSideRow(B);
    const first = live()[0];
    detach();
    expect(first.terminated).toBe(true);
    expect(live()).toHaveLength(0);
    // Not lost: back at the front of the queue.
    expect(sideRunState(A)).toBe('queued');

    const again = attachSide();
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([A]);
    again();
  });

  it('a hidden page stops the worker; visible again resumes', () => {
    const detach = attachSide();
    requestSideRow(A);
    _setSideHidden(true);
    expect(live()).toHaveLength(0);
    requestSideRow(B);
    expect(live()).toHaveLength(0);
    _setSideHidden(false);
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([A]);
    detach();
  });

  it('does not stop while another Casino screen is still attached', () => {
    const one = attachSide();
    const two = attachSide();
    requestSideRow(A);
    one();
    expect(live()).toHaveLength(1);
    two();
    expect(live()).toHaveLength(0);
  });

  it('a running session holds every row but an open card\'s', () => {
    setSideHold(true);
    const detach = attachSide();
    requestSideRow(A);
    requestSideRow(B);
    expect(workers).toHaveLength(0);

    requestSideRow(C, { forOpenCard: true });
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([C]);
    live()[0].fail('x');
    // C done (failed); A and B still held.
    expect(live()).toHaveLength(0);

    setSideHold(false);
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([A]);
    detach();
  });

  it('an open card moves a held ranking request up and lets it run', () => {
    setSideHold(true);
    const detach = attachSide();
    requestSideRow(A);
    requestSideRow(B);
    requestSideRow(B, { forOpenCard: true });
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([B]);
    detach();
  });

  it('runs one row at a time, the next when the last ends', () => {
    const detach = attachSide();
    requestSideRow(A);
    requestSideRow(B);
    expect(live()).toHaveLength(1);
    live()[0].fail('x');
    expect(live()).toHaveLength(1);
    expect(live()[0].posted).toEqual([B]);
    expect(sideRunState(A)).toBe('failed');
    detach();
  });
});
