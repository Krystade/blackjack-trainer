import type { Card } from '../cards';
import { RANK_INDEX, SUIT_INDEX } from './comp';
import { STRAIGHTS } from './odds';
import type { Outcome, PayTable, SideBetId } from './payTables';

/**
 * Wave L: SETTLING a side bet from the cards actually dealt -- what Play
 * pays. The same outcome partition odds.ts prices (settle.test.ts deals every
 * two- and three-card combination of a deck through here and checks the
 * tallies against odds.ts), so what Play pays and what the house edge says
 * can never describe different bets.
 */

const rankI = (c: Card) => RANK_INDEX[c.rank];
const suitI = (c: Card) => SUIT_INDEX[c.suit];
/** Value, ace one. */
const val = (c: Card) => {
  const r = rankI(c);
  return r >= 9 ? 10 : r + 1;
};
const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
const isTen = (c: Card) => rankI(c) >= 9;
const blackjack = (cs: readonly Card[]) => cs.length === 2 && ((cs[0]!.rank === 'A' && isTen(cs[1]!)) || (cs[1]!.rank === 'A' && isTen(cs[0]!)));
const QUEEN = 11;
const HEARTS = 1;

export interface SettleInput {
  /** The player's first two cards (of the first hand dealt). */
  player: readonly [Card, Card];
  /** The dealer's up card. */
  up: Card;
  /** The dealer's whole hand as it finished (Buster), up card first. */
  dealer: readonly Card[];
}

function luckyLadies(p: readonly [Card, Card], dealer: readonly Card[]): Outcome | null {
  const [a, b] = p;
  if (val(a) + val(b) !== 20 && !(a.rank === 'A' && b.rank === '9') && !(a.rank === '9' && b.rank === 'A')) return null;
  // An ace counts eleven for Lucky Ladies' 20 (A-9): val() above counts it one.
  const dbj = blackjack(dealer.slice(0, 2));
  if (rankI(a) === QUEEN && rankI(b) === QUEEN) {
    if (same(a, b)) {
      if (suitI(a) === HEARTS) return dbj ? 'qhPairBj' : 'qhPair';
      return dbj ? 'qMatchedBj' : 'qMatched';
    }
    return dbj ? 'qRankedBj' : 'qRanked';
  }
  if (same(a, b)) return 'matched20';
  if (a.rank === b.rank) return 'ranked20';
  return a.suit === b.suit ? 'suited20' : 'unsuited20';
}

function twentyOnePlus3(cs: readonly Card[]): Outcome | null {
  const [a, b, c] = cs as [Card, Card, Card];
  const flush = a.suit === b.suit && b.suit === c.suit;
  const ranks = [rankI(a), rankI(b), rankI(c)].sort((x, y) => x - y);
  const trips = ranks[0] === ranks[2];
  if (trips) return flush ? 'suitedTrips' : 'trips';
  const straight = STRAIGHTS.some((s) => [...s].sort((x, y) => x - y).every((r, i) => r === ranks[i]));
  if (straight) return flush ? 'straightFlush' : 'straight';
  if (flush) return 'flush';
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) return 'pair';
  return null;
}

function perfectPairs([a, b]: readonly [Card, Card]): Outcome | null {
  if (a.rank !== b.rank) return null;
  if (a.suit === b.suit) return 'perfect';
  const red = (c: Card) => c.suit === 'h' || c.suit === 'd';
  return red(a) === red(b) ? 'colored' : 'mixed';
}

function royalMatch([a, b]: readonly [Card, Card]): Outcome | null {
  if (a.suit !== b.suit) return null;
  const kq = (a.rank === 'K' && b.rank === 'Q') || (a.rank === 'Q' && b.rank === 'K');
  if (kq) return 'royal';
  if (blackjack([a, b])) return 'suitedBj';
  return 'suited';
}

function buster(player: readonly [Card, Card], dealer: readonly Card[]): Outcome | null {
  let hard = 0;
  for (const c of dealer) hard += val(c);
  if (hard <= 21) return null;
  const n = dealer.length;
  const pbj = blackjack(player);
  if (n >= 8) return pbj ? 'b8Bj' : 'b8';
  if (n === 7) return pbj ? 'b7Bj' : 'b7';
  return (['b3', 'b4', 'b5', 'b6'] as const)[n - 3] ?? null;
}

/** The outcome these cards make for the bet, or null for a loss. */
export function outcomeOf(bet: SideBetId, s: SettleInput): Outcome | null {
  switch (bet) {
    case 'luckyLadies':
      return luckyLadies(s.player, s.dealer);
    case 'twentyOnePlus3':
      return twentyOnePlus3([s.player[0], s.player[1], s.up]);
    case 'perfectPairs':
      return perfectPairs(s.player);
    case 'royalMatch':
      return royalMatch(s.player);
    case 'buster':
      return buster(s.player, s.dealer);
    case 'over13':
      return val(s.player[0]) + val(s.player[1]) > 13 ? 'win' : null;
    case 'under13':
      return val(s.player[0]) + val(s.player[1]) < 13 ? 'win' : null;
  }
}

/** Net in stakes: the line's pay, or -1. */
export function settleNet(outcome: Outcome | null, pays: PayTable['pays']): number {
  if (outcome === null) return -1;
  return pays[outcome] ?? -1;
}

/** Plain words for an outcome, for the result line. */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  qhPairBj: 'Q♥ pair + dealer blackjack',
  qhPair: 'Q♥ pair',
  qMatchedBj: 'matched queens + dealer blackjack',
  qMatched: 'matched queens',
  qRankedBj: 'pair of queens + dealer blackjack',
  qRanked: 'pair of queens',
  matched20: 'matched 20',
  ranked20: 'ranked 20',
  suited20: 'suited 20',
  unsuited20: '20',
  suitedTrips: 'suited trips',
  straightFlush: 'straight flush',
  trips: 'three of a kind',
  straight: 'straight',
  flush: 'flush',
  pair: 'pair',
  perfect: 'perfect pair',
  colored: 'coloured pair',
  mixed: 'mixed pair',
  royal: 'royal match',
  suitedBj: 'suited blackjack',
  suited: 'suited',
  b3: 'dealer bust, 3 cards',
  b4: 'dealer bust, 4 cards',
  b5: 'dealer bust, 5 cards',
  b6: 'dealer bust, 6 cards',
  b7Bj: 'dealer bust, 7 cards + your blackjack',
  b7: 'dealer bust, 7 cards',
  b8Bj: 'dealer bust, 8+ cards + your blackjack',
  b8: 'dealer bust, 8+ cards',
  win: 'win',
};
