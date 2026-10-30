import type { TableRound } from '../drills/countTable';
import { DEALER_SEAT, casinoRoundSteps, stepHoldMs, type DealStep, type StepPace } from './dealSequence';

/**
 * Wave X (item 8): the count drill's Table mode, dealt. "Cards dealt out at
 * the selected speed (or instant if instant is selected), and then a set
 * post-round payout stage that gives a little extra time at the end of the
 * round before the cards are collected. Animated in the same order a casino
 * actually deals and collects."
 *
 * A round used to appear whole and vanish whole. Now it is a run of steps
 * (dealSequence.ts, shared with Play's rounds Out): the deal, one card per
 * "Time per card"; the payout, a fixed beat; the collect, a quick sweep from
 * third base to first and the dealer's own cards last. "Instant" lays the
 * cards down at once and leaves them up as long as they would have taken to
 * deal, as Table mode always did, then pays and collects the same way.
 *
 * On tap, the deal and the collect run on their own and the round waits at
 * the payout for the tap that collects it.
 */

/** The payout: a set extra beat once the round is played, before the collect. */
export const PAYOUT_MS = 1500;
/** The collect: one seat's cards (or the dealer's) per beat. */
export const COLLECT_MS = 250;

export type TableDeal = 'dealt' | 'instant';

export function tableDealOf(setting: string | undefined): TableDeal {
  return setting === 'instant' ? 'instant' : 'dealt';
}

export interface TableRoundPlan {
  steps: DealStep[];
  /** The payout step's index. */
  payoutAt: number;
  pace: StepPace;
  /** Steps on the felt as the round starts. */
  first: number;
  deal: TableDeal;
  manual: boolean;
  /** Every card the round shows. */
  cards: number;
  intervalMs: number;
}

export function tableRoundPlan(round: TableRound, intervalMs: number, deal: TableDeal, manual: boolean): TableRoundPlan {
  const steps = casinoRoundSteps(
    round.players.map((h) => h.length),
    round.dealer.length,
    { collect: true },
  );
  const payoutAt = steps.findIndex((s) => s.kind === 'payout');
  const cards = round.players.reduce((n, h) => n + h.length, 0) + round.dealer.length;
  // Instant: every card and the turned hole at once -- and, on tap, straight to the payout's wait.
  const first = deal === 'dealt' ? 1 : manual ? payoutAt + 1 : payoutAt;
  return {
    steps,
    payoutAt,
    pace: { cardMs: intervalMs, revealMs: intervalMs, payoutMs: PAYOUT_MS, collectMs: COLLECT_MS },
    first,
    deal,
    manual,
    cards,
    intervalMs,
  };
}

/**
 * How long the felt holds with `shown` steps on it before the next lands --
 * or, with all of them on, before the round is over. Null: it waits for a tap.
 */
export function tableHoldMs(plan: TableRoundPlan, shown: number): number | null {
  if (plan.manual && shown === plan.payoutAt + 1) return null;
  // Instant: the whole round stays up as long as dealing it would have taken.
  if (plan.deal === 'instant' && shown === plan.payoutAt) return plan.intervalMs * plan.cards;
  return stepHoldMs(plan.steps, shown - 1, plan.pace);
}

export type TableStage = 'deal' | 'payout' | 'collect';

export interface TableView {
  /** Cards on the felt per seat, first base first. */
  seatCards: number[];
  dealerCards: number;
  holeDown: boolean;
  stage: TableStage;
  /** Seats whose cards the dealer has taken (DEALER_SEAT for the dealer's own). */
  collected: Set<number>;
}

export function tableView(plan: TableRoundPlan, seats: number, shown: number): TableView {
  const on = plan.steps.slice(0, Math.max(0, shown));
  const seatCards = new Array<number>(seats).fill(0);
  let dealerCards = 0;
  let holeDown = true;
  const collected = new Set<number>();
  for (const s of on) {
    if (s.kind === 'card') {
      if (s.seat === DEALER_SEAT) dealerCards += 1;
      else seatCards[s.seat] = (seatCards[s.seat] ?? 0) + 1;
    } else if (s.kind === 'reveal') holeDown = false;
    else if (s.kind === 'collect') collected.add(s.seat);
  }
  const stage: TableStage = shown > plan.payoutAt + 1 ? 'collect' : shown === plan.payoutAt + 1 ? 'payout' : 'deal';
  return { seatCards, dealerCards, holeDown, stage, collected };
}
