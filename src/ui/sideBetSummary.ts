import { describeTags } from '../engine/sideBets/counts';
import type { SidePlan } from '../engine/sideBets/plan';
import { triggerText } from './sideBetFeedback';

/**
 * Wave L: one side bet at one game, in words -- for the profile editor, the
 * reference page and the casino card. Every figure is read from the plan
 * (generated.ts); nothing here is a strategy number of its own.
 */

export interface SideSummary {
  /** "House edge 24.70%" (a negative edge is the player's: "Player edge 0.95%"). */
  edge: string;
  /** "Ten count (Jacobson)", "Suit spread", "no count needed", "not countable". */
  count: string;
  /** "+1: 2–9 · −2: 10–K", or null for a suit or absent count. */
  tags: string | null;
  /** "from +8", "every hand", "never …". */
  trigger: string;
  /** Rounds bet, as a percentage, e.g. "4.1% of rounds"; null when never or always. */
  freq: string | null;
  /** Expected win per 100 rounds counted, in dollars at the stake ("+$12.40 per 100 rounds"). */
  per100: string;
  per100Dollars: number;
}

export const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;

export function sideSummary(plan: SidePlan, stake: number): SideSummary {
  const edge = plan.row.edge;
  const c = plan.candidate;
  const per100Units = plan.always ? -edge * 100 : (c?.per100 ?? 0);
  const per100Dollars = per100Units * stake;
  return {
    edge: edge >= 0 ? `House edge ${pct(edge)}` : `Player edge ${pct(-edge)}`,
    count: plan.always ? 'no count needed' : c ? c.name : 'not countable',
    tags: c && c.kind === 'tags' && c.id !== 'hilo' && c.tags ? describeTags(c.tags) : null,
    trigger: triggerText({ always: plan.always, count: plan.count, trigger: plan.trigger, betBelow: plan.betBelow }),
    freq: !plan.always && c ? `${pct(c.freq, 1)} of rounds` : null,
    per100: `${per100Dollars >= 0 ? '+' : '−'}$${Math.abs(per100Dollars).toFixed(2)} per 100 rounds`,
    per100Dollars,
  };
}
