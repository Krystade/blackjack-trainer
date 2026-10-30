import { describe, expect, it } from 'vitest';
import type { Card } from '../engine/cards';
import { DEALER_SEAT } from './dealSequence';
import { COLLECT_MS, PAYOUT_MS, tableDealOf, tableHoldMs, tableRoundPlan, tableView } from './countTableDeal';

const c = (rank: Card['rank']): Card => ({ rank, suit: 's' });
// First base hits once, second base stands; the dealer draws one.
const ROUND = { players: [[c('5'), c('6'), c('9')], [c('K'), c('Q')]], dealer: [c('7'), c('9'), c('2')] };
const CARDS = 8;

/** Walk a plan from its first step to the end, as the drill's clock does; null holds stop the walk. */
function walk(plan: ReturnType<typeof tableRoundPlan>): { shown: number; hold: number | null }[] {
  const out: { shown: number; hold: number | null }[] = [];
  for (let shown = plan.first; shown <= plan.steps.length; shown++) {
    const hold = tableHoldMs(plan, shown);
    out.push({ shown, hold });
    if (hold === null) break;
  }
  return out;
}

describe('a table round, dealt', () => {
  const plan = tableRoundPlan(ROUND, 800, 'dealt', false);

  it('starts on its first card and lays one card down per time-per-card, then pays, then collects', () => {
    expect(plan.first).toBe(1);
    const holds = walk(plan).map((w) => w.hold);
    // 8 cards and the hole turn at 800ms each, the payout, then three collects (P2, P1, dealer).
    expect(holds).toEqual([...new Array(CARDS + 1).fill(800), PAYOUT_MS, COLLECT_MS, COLLECT_MS, COLLECT_MS]);
  });

  it('the felt step by step: first base and the dealer first, the hole down until it turns, then third base collected first', () => {
    const view = (shown: number) => tableView(plan, 2, shown);
    expect(view(1)).toMatchObject({ seatCards: [1, 0], dealerCards: 0, stage: 'deal' });
    expect(view(3)).toMatchObject({ seatCards: [1, 1], dealerCards: 1 });
    expect(view(6)).toMatchObject({ seatCards: [2, 2], dealerCards: 2, holeDown: true });
    expect(view(7)).toMatchObject({ seatCards: [3, 2], dealerCards: 2, holeDown: true });
    expect(view(8)).toMatchObject({ holeDown: false, dealerCards: 2 });
    expect(view(9)).toMatchObject({ dealerCards: 3, stage: 'deal' });
    expect(view(10).stage).toBe('payout');
    const firstTaken = view(11);
    expect(firstTaken.stage).toBe('collect');
    expect([...firstTaken.collected]).toEqual([1]);
    expect([...view(13).collected]).toEqual([1, 0, DEALER_SEAT]);
  });
});

describe('a table round, instant', () => {
  it('lays every card and the turned hole down at once, holds them as long as dealing would have, then pays and collects', () => {
    const plan = tableRoundPlan(ROUND, 800, 'instant', false);
    const first = tableView(plan, 2, plan.first);
    expect(first).toMatchObject({ seatCards: [3, 2], dealerCards: 3, holeDown: false, stage: 'deal' });
    expect(walk(plan).map((w) => w.hold)).toEqual([800 * CARDS, PAYOUT_MS, COLLECT_MS, COLLECT_MS, COLLECT_MS]);
  });
});

describe('on tap', () => {
  it('dealt: the deal runs by itself, then the payout waits for a tap', () => {
    const plan = tableRoundPlan(ROUND, 800, 'dealt', true);
    const w = walk(plan);
    expect(w.at(-1)).toEqual({ shown: plan.payoutAt + 1, hold: null });
    // Once tapped, the collect runs by itself.
    expect(tableHoldMs(plan, plan.payoutAt + 2)).toBe(COLLECT_MS);
  });

  it('instant: straight to the payout, waiting', () => {
    const plan = tableRoundPlan(ROUND, 800, 'instant', true);
    expect(plan.first).toBe(plan.payoutAt + 1);
    expect(tableHoldMs(plan, plan.first)).toBeNull();
    expect(tableView(plan, 2, plan.first)).toMatchObject({ seatCards: [3, 2], dealerCards: 3, holeDown: false, stage: 'payout' });
  });
});

describe('the setting', () => {
  it('absent or unknown is card by card', () => {
    expect(tableDealOf(undefined)).toBe('dealt');
    expect(tableDealOf('nope')).toBe('dealt');
    expect(tableDealOf('instant')).toBe('instant');
  });
});
