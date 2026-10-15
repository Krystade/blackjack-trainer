import type { Card } from '../engine/cards';
import { Shoe, mulberry32 } from '../engine/cards';
import { hiLoTag } from '../engine/count';

/**
 * #47: one round of the count drill's Table mode -- what a counter sees at a
 * real table once the round has played out: 1-6 player hands of 2-3 cards and
 * a dealer hand of 2-6 cards. The hands are not played by strategy; their
 * sizes are drawn so every table shape turns up. Read-only: only the count
 * matters.
 */
export interface TableRound {
  players: Card[][];
  dealer: Card[];
}

export interface CountTableRun {
  rounds: TableRound[];
  /** Every round's cards, flattened (players right to left order is the
   * caller's concern; a sum does not care), one group per round. */
  groups: Card[][];
  finalRc: number;
}

export const TABLE_ROUND_CHOICES = [5, 10, 20] as const;
export const DEFAULT_TABLE_ROUNDS = 10;
export const TABLE_SHOE_DECKS = 6;
const MAX_CARDS_PER_ROUND = 6 * 3 + 6;

/** The rounds setting, read safely: anything but a listed choice is the default. */
export function tableRounds(setting: number | undefined): number {
  return (TABLE_ROUND_CHOICES as readonly number[]).includes(setting ?? -1) ? setting! : DEFAULT_TABLE_ROUNDS;
}

/** Six decks, or enough that the worst-case run cannot empty the shoe. */
export function tableShoeDecks(rounds: number): number {
  return Math.max(TABLE_SHOE_DECKS, Math.ceil((rounds * MAX_CARDS_PER_ROUND) / 52));
}

/** Cards on the table in one round. */
export function cardsInRound(r: TableRound): number {
  return r.players.reduce((n, h) => n + h.length, 0) + r.dealer.length;
}

/**
 * Deal `rounds` rounds from one seeded shoe, dealt in table order: a card to
 * each player then the dealer, a second round of the same, then each
 * player's third card, then the dealer's draws. The shoe is a six-deck shoe,
 * or larger when the run could need more cards, so it never runs dry.
 */
export function makeCountTable(rounds: number, seed: number): CountTableRun {
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const decks = tableShoeDecks(rounds);
  const shoe = new Shoe({ decks, seed });
  const out: TableRound[] = [];
  for (let r = 0; r < rounds; r++) {
    const seats = 1 + Math.floor(rng() * 6);
    const players: Card[][] = Array.from({ length: seats }, () => []);
    const dealer: Card[] = [];
    for (let pass = 0; pass < 2; pass++) {
      for (const h of players) h.push(shoe.draw());
      dealer.push(shoe.draw());
    }
    for (const h of players) if (rng() < 0.5) h.push(shoe.draw());
    const dealerCards = 2 + Math.floor(rng() * 5);
    while (dealer.length < dealerCards) dealer.push(shoe.draw());
    out.push({ players, dealer });
  }
  const groups = out.map((r) => [...r.players.flat(), ...r.dealer]);
  const finalRc = groups.flat().reduce((s, c) => s + hiLoTag(c.rank), 0);
  return { rounds: out, groups, finalRc };
}
