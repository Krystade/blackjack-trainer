import { trueCount } from '../count';
import type { TcRounding } from '../count';
import type { Card } from '../cards';
import { RANK_INDEX, SUIT_INDEX } from './comp';
import type { SideCountDef } from './counts';
import { outcomeOf, settleNet } from './settle';
import type { Outcome, PayTable, SideBetId } from './payTables';

/**
 * Wave L: the side bet at the Play table -- what Game needs, kept out of
 * game.ts so the engine's round logic only gains a few calls.
 *
 * The side count is kept from the cards the table has SHOWN, exactly where
 * Hi-Lo is (Game.see): a hole card is counted when it is turned, not when it
 * is dealt.
 */

export interface SidePlanLite {
  always: boolean;
  count: SideCountDef | null;
  trigger: number | null;
  betBelow: boolean;
}

export interface SideBetConfig {
  bet: SideBetId;
  /** "Lucky Ladies", for feedback. */
  name: string;
  pays: PayTable['pays'];
  plan: SidePlanLite;
  /** The stake in dollars. */
  stake: number;
}

export interface SideBetDecision {
  round: number;
  placed: boolean;
  /** Whether the count called for the bet. */
  expected: boolean;
  correct: boolean;
  /** The side count's running and true count before the deal (Hi-Lo's when the plan uses Hi-Lo). */
  rc: number;
  tc: number;
  /** Settled: the outcome (null = lost) and the net in dollars. */
  outcome?: Outcome | null;
  net?: number;
}

export interface SideTally {
  right: number;
  wrong: number;
  placed: number;
  /** Dollars. */
  net: number;
}

export const EMPTY_SIDE_TALLY: SideTally = { right: 0, wrong: 0, placed: 0, net: 0 };

/** The seen cards, by rank and by suit, since the shuffle. */
export class SideCounter {
  readonly ranks = new Int32Array(13);
  readonly suits = new Int32Array(4);

  see(c: Card): void {
    this.ranks[RANK_INDEX[c.rank]]! += 1;
    this.suits[SUIT_INDEX[c.suit]]! += 1;
  }

  reset(): void {
    this.ranks.fill(0);
    this.suits.fill(0);
  }

  /** The running count of `def` over the cards seen. */
  rc(def: SideCountDef): number {
    if (def.kind === 'suit') {
      let hi = -Infinity;
      let lo = Infinity;
      for (const n of this.suits) {
        if (n > hi) hi = n;
        if (n < lo) lo = n;
      }
      return hi - lo;
    }
    let rc = 0;
    for (let r = 0; r < 13; r++) rc += (def.tags?.[r] ?? 0) * this.ranks[r]!;
    return rc;
  }

  tc(def: SideCountDef, decksRemaining: number, rounding: TcRounding | undefined): number {
    return trueCount(this.rc(def), decksRemaining, rounding);
  }
}

/** The count calls for the bet at this true count. */
export function sideExpected(plan: SidePlanLite, tc: number): boolean {
  if (plan.always) return true;
  if (plan.trigger === null) return false;
  return plan.betBelow ? tc <= plan.trigger : tc >= plan.trigger;
}

/** Settle a placed bet from the round's cards. */
export function settleSide(cfg: SideBetConfig, player: readonly [Card, Card], dealer: readonly Card[]): { outcome: Outcome | null; net: number } {
  const outcome = outcomeOf(cfg.bet, { player, up: dealer[0]!, dealer });
  return { outcome, net: settleNet(outcome, cfg.pays) * cfg.stake };
}
