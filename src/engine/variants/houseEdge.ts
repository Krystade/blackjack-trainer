/**
 * C22 follow-up: a variant's house edge for any rules, in percent, by the
 * same infinite-deck engine (ev.ts) that made every preset's figure in
 * generated.json (chartGen.ts generatePreset). Exact for its model: no
 * sampling, so no estimate to firm up. Free Bet and Spanish 21 take a few
 * tens of milliseconds, Switch about a second and a half, so the app runs
 * it in a worker (ui/screens/casino/variantEdge.worker.ts).
 */

import { roundReturn, switchReturn } from './ev';
import type { VariantRules } from './rules';

export function houseEdgePct(rules: VariantRules): number {
  return -(rules.variant === 'switch' ? switchReturn(rules) : roundReturn(rules)) * 100;
}
