import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import type { PlayerHand } from '../engine/game';
import { roundBanner } from './roundBanner';

const c = (...r: Rank[]): Card[] => r.map((rank) => ({ rank, suit: 's' }));
const hand = (cards: Card[], result: PlayerHand['result'], net: number): PlayerHand =>
  ({ cards, bet: 1, doubled: false, surrendered: false, fromSplit: false, splitAces: false, done: true, result, net, originIndex: 0 });

describe('roundBanner (B5/W5)', () => {
  it('a lost hand: result with a real minus, then both totals', () => {
    const b = roundBanner(hand(c('10', '7'), 'lose', -1), 1, false, c('10', '9'), true);
    expect(`${b.head} · ${b.totals}`).toBe('Lose −1 · You 17 · Dealer 19');
    expect(b.net).toBe(-1);
  });
  it('win, push, blackjack and surrender read as the table says them', () => {
    expect(roundBanner(hand(c('10', 'Q'), 'win', 2), 1, false, c('10', '8'), true).head).toBe('Win +2');
    expect(roundBanner(hand(c('10', '8'), 'push', 0), 1, false, c('9', '9'), true).head).toBe('Push');
    const bj = roundBanner(hand(c('A', 'K'), 'blackjack', 1.5), 1, false, c('10', '8'), true);
    expect(`${bj.head} · ${bj.totals}`).toBe('Blackjack! +1.5 · You blackjack · Dealer 18');
    expect(roundBanner(hand(c('10', '6'), 'surrender', -0.5), 1, false, c('10', '7'), false).head).toBe('Surrender −0.5');
  });
  it('a bust says so, and a dealer bust says so', () => {
    expect(roundBanner(hand(c('10', '6', '9'), 'lose', -1), 1, false, c('10', '7'), false).totals).toBe('You 25 (bust) · Dealer shows 10');
    expect(roundBanner(hand(c('10', '8'), 'win', 1), 1, false, c('6', '10', '9'), true).totals).toBe('You 18 · Dealer 25 (bust)');
  });
  it('never invents a dealer total for an unrevealed hole card', () => {
    expect(roundBanner(hand(c('10', '6'), 'surrender', -0.5), 1, false, c('A', '9'), false).totals).toBe('You 16 · Dealer shows A');
  });
  it('a dealer natural is named, not summed', () => {
    expect(roundBanner(hand(c('10', '8'), 'lose', -1), 1, false, c('A', 'K'), true).totals).toBe('You 18 · Dealer blackjack');
  });
  it('split and multi-hand rounds carry the play-order label', () => {
    expect(roundBanner(hand(c('8', '10'), 'win', 1), 2, true, c('10', '7'), true).head).toBe('Hand 2: Win +1');
  });
});
