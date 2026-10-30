import type { DealSlot } from '../engine/game';

/**
 * Wave X (items 1 and 8): the order a casino puts cards on the felt, and takes
 * them off it, as a list of steps one beat apart. Pure: no clock, no DOM. Two
 * screens pace their tables by it --
 *
 *  - Play, with the player Out (`sitOutSteps`): the round used to be on the
 *    felt in one go, so a back-counter had nothing to count as it came.
 *  - The count drill's Table mode (`casinoRoundSteps`): a whole round
 *    appeared at once, and vanished at once.
 *
 * A seat is numbered from FIRST BASE, the dealer's left -- which is the
 * screen's right, since both tables lay their seats out row-reverse. The
 * dealer is seat -1.
 */
export const DEALER_SEAT = -1;

export type DealStep =
  /** A card lands: `card` is its index in that hand. */
  | { kind: 'card'; seat: number; hand: number; card: number }
  /** A player's turn that took no card (stand, surrender, the split itself). */
  | { kind: 'act'; seat: number; hand: number }
  /** The dealer turns the hole card. */
  | { kind: 'reveal' }
  /** The dealer settles the bets: a held beat with nothing new on the felt. */
  | { kind: 'payout' }
  /** The dealer takes a seat's cards (the dealer's own last). */
  | { kind: 'collect'; seat: number };

/**
 * One round, every seat playing one hand, in casino order:
 *
 *  1. one card to each seat from first base to third, then the dealer's
 *     up-card;
 *  2. the second card the same way, then the dealer's hole card (face down);
 *  3. each seat's draws, first base first, all of a seat's before the next;
 *  4. the dealer turns the hole card and draws;
 *  5. with `collect`: the payout beat, then the cards come up from third base
 *     back to first, and the dealer's own last.
 *
 * `seatCards[s]` is how many cards seat s ends with (at least 2), and
 * `dealerCards` the dealer's (at least 2).
 */
export function casinoRoundSteps(
  seatCards: readonly number[],
  dealerCards: number,
  opts: { collect: boolean },
): DealStep[] {
  const steps: DealStep[] = [];
  for (const pass of [0, 1]) {
    seatCards.forEach((_, seat) => steps.push({ kind: 'card', seat, hand: 0, card: pass }));
    steps.push({ kind: 'card', seat: DEALER_SEAT, hand: 0, card: pass });
  }
  seatCards.forEach((n, seat) => {
    for (let card = 2; card < n; card++) steps.push({ kind: 'card', seat, hand: 0, card });
  });
  steps.push({ kind: 'reveal' });
  for (let card = 2; card < dealerCards; card++) steps.push({ kind: 'card', seat: DEALER_SEAT, hand: 0, card });
  if (opts.collect) {
    steps.push({ kind: 'payout' });
    for (let seat = seatCards.length - 1; seat >= 0; seat--) steps.push({ kind: 'collect', seat });
    steps.push({ kind: 'collect', seat: DEALER_SEAT });
  }
  return steps;
}

/**
 * A round Play dealt with the player Out, as the engine already settled it:
 * the opening two passes exactly as `Game.dealOrder` recorded them, then each
 * bot's turn in the order the bots took them (`Game.botActionLog`, first base
 * first, a split's hands as they were played), then the hole card -- when the
 * round turned it -- and the dealer's draws.
 */
export function sitOutSteps(
  dealOrder: readonly DealSlot[],
  botLog: readonly { seat: number; handIndex: number; card?: unknown }[],
  dealerCards: number,
  holeRevealed: boolean,
): DealStep[] {
  const steps: DealStep[] = [];
  for (const slot of dealOrder) {
    if (slot.kind === 'dealer') steps.push({ kind: 'card', seat: DEALER_SEAT, hand: 0, card: slot.cardIndex });
    else if (slot.kind === 'bot') steps.push({ kind: 'card', seat: slot.seatIndex, hand: slot.handIndex, card: slot.cardIndex });
  }
  const drawn = new Map<string, number>();
  for (const entry of botLog) {
    if (entry.card === undefined) {
      steps.push({ kind: 'act', seat: entry.seat, hand: entry.handIndex });
      continue;
    }
    const key = `${entry.seat}:${entry.handIndex}`;
    const card = 2 + (drawn.get(key) ?? 0);
    drawn.set(key, card - 1);
    steps.push({ kind: 'card', seat: entry.seat, hand: entry.handIndex, card });
  }
  if (holeRevealed) steps.push({ kind: 'reveal' });
  for (let card = 2; card < dealerCards; card++) steps.push({ kind: 'card', seat: DEALER_SEAT, hand: 0, card });
  return steps;
}

/** How long each kind of step holds before the next one starts. */
export interface StepPace {
  cardMs: number;
  actMs?: number;
  revealMs?: number;
  payoutMs?: number;
  collectMs?: number;
}

function holdOf(step: DealStep, pace: StepPace): number {
  switch (step.kind) {
    case 'card':
      return pace.cardMs;
    case 'act':
      return pace.actMs ?? pace.cardMs;
    case 'reveal':
      return pace.revealMs ?? pace.cardMs;
    case 'payout':
      return pace.payoutMs ?? pace.cardMs;
    case 'collect':
      return pace.collectMs ?? pace.cardMs;
  }
}

/** When each step starts, from the round's first card at 0. */
export function stepStarts(steps: readonly DealStep[], pace: StepPace): number[] {
  const out: number[] = [];
  let t = 0;
  for (const s of steps) {
    out.push(t);
    t += holdOf(s, pace);
  }
  return out;
}

/** When the last step is over: the round's whole time on the felt. */
export function roundMs(steps: readonly DealStep[], pace: StepPace): number {
  return steps.reduce((t, s) => t + holdOf(s, pace), 0);
}

/** How long step `i` holds. */
export function stepHoldMs(steps: readonly DealStep[], i: number, pace: StepPace): number {
  const s = steps[i];
  return s ? holdOf(s, pace) : 0;
}
