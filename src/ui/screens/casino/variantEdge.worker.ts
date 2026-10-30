import { houseEdgePct } from '../../../engine/variants/houseEdge';
import type { VariantRules } from '../../../engine/variants/rules';

/**
 * C22 follow-up: one variant game's house edge for its logged rules, off the
 * main thread (Switch takes over a second). One message in, one out.
 */

export type VariantEdgeMessage = { type: 'done'; edge: number } | { type: 'error'; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<VariantRules>) => void) | null;
  postMessage: (msg: VariantEdgeMessage) => void;
};

ctx.onmessage = (e: MessageEvent<VariantRules>) => {
  try {
    ctx.postMessage({ type: 'done', edge: houseEdgePct(e.data) } satisfies VariantEdgeMessage);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) } satisfies VariantEdgeMessage);
  }
};
