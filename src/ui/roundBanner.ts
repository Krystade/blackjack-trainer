import type { Card } from '../engine/cards';
import type { PlayerHand } from '../engine/game';
import { handValue, isBlackjack } from '../engine/hand';
import { signed } from '../drills/signed';

/**
 * B5/W5 (spec 2026-10-16): one settled hand's result, read at a glance.
 *
 * The result line used to say only "Lose -1", so working out WHY meant
 * adding up both hands by eye on a felt that had already moved on. The banner
 * puts the two totals beside the result -- "Lose −1 · You 17 · Dealer 19" --
 * and its net carries a real minus (U+2212), never the short ASCII hyphen.
 *
 * `head` and `totals` are separate so the Table can keep the totals together
 * on a line of their own when the banner wraps at 375px.
 */
export interface RoundBanner {
  /** "Hand 2: Win +1", "Push", "Surrender −0.5". */
  head: string;
  /** "You 17 · Dealer 19", "You 25 (bust) · Dealer shows 10". */
  totals: string;
  /** The hand's net in units (0 when unsettled), for specs to sum. */
  net: number;
}

/** `playNumber` is the hand's place in the order of play, counted from 1. */
export function roundBanner(
  hand: PlayerHand,
  playNumber: number,
  multi: boolean,
  dealerCards: readonly Card[],
  holeRevealed: boolean,
): RoundBanner {
  const net = hand.net ?? 0;
  const prefix = multi ? `Hand ${playNumber}: ` : '';
  return {
    head: `${prefix}${resultWords(hand.result, net)}`,
    totals: `${youTotal(hand)} · ${dealerTotal(dealerCards, holeRevealed)}`,
    net,
  };
}

function resultWords(result: PlayerHand['result'], net: number): string {
  const n = signed(net, { plusZero: false });
  switch (result) {
    case 'win':
      return `Win ${n}`;
    case 'lose':
      return `Lose ${n}`;
    case 'push':
      return 'Push';
    case 'blackjack':
      return `Blackjack! ${n}`;
    case 'surrender':
      return `Surrender ${n}`;
    default:
      return '';
  }
}

function youTotal(hand: PlayerHand): string {
  if (hand.result === 'blackjack') return 'You blackjack';
  const { total } = handValue(hand.cards);
  return total > 21 ? `You ${total} (bust)` : `You ${total}`;
}

/** Only the up-card while the hole is face down: a hand that busted or
 * surrendered never sees it, and a total would be invented. */
function dealerTotal(dealerCards: readonly Card[], holeRevealed: boolean): string {
  if (!holeRevealed) return `Dealer shows ${dealerCards[0]?.rank ?? '?'}`;
  const cards = [...dealerCards];
  if (isBlackjack(cards)) return 'Dealer blackjack';
  const { total } = handValue(cards);
  return total > 21 ? `Dealer ${total} (bust)` : `Dealer ${total}`;
}
