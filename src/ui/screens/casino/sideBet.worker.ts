import { buildSideRow, type SideRowSpec } from '../../../engine/sideBets/build';
import type { SideBetRow } from '../../../engine/sideBets/plan';

/**
 * Wave L: one casino game's side bet, simulated at the game's own cut, off
 * the main thread. One message in, one out.
 */

export type SideWorkerMessage = { type: 'done'; row: SideBetRow } | { type: 'error'; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SideRowSpec>) => void) | null;
  postMessage: (msg: SideWorkerMessage) => void;
};

ctx.onmessage = (e: MessageEvent<SideRowSpec>) => {
  try {
    ctx.postMessage({ type: 'done', row: buildSideRow(e.data) } satisfies SideWorkerMessage);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies SideWorkerMessage);
  }
};
