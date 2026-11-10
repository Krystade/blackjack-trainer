import { fisherYatesShuffle, mulberry32, rankValue, RANKS, type Card, type Suit } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import type { DistractionDifficulty } from './distraction';

/**
 * Owner 2026-11-10 ("it shows another full table of like 6 players and says
 * what's the count of that other table"): a Play distraction that deals a
 * second table, off its own six-deck shoe, and asks its Hi-Lo running count.
 * Nothing here touches the main shoe: the cards come from a deck built and
 * shuffled for this one table and are thrown away with it.
 *
 * Difficulty, on the same Easy/Normal/Hard/Expert choice as the sums:
 * - easy:   3 players, 2 cards each, and the dealer's up-card.
 * - normal: 6 players, 2 cards each, and the up-card.
 * - hard:   6 players who play their hands: a stiff hits now and then, so
 *           hands run 2 to 4 cards (at least one seat always hits).
 * - expert: Hard's table, shown for OTHER_TABLE_EXPERT_MS and then turned
 *           face down: the count is answered from memory.
 */
export interface OtherTable {
  dealer: Card;
  seats: Card[][];
  /** Expert only: the cards turn face down this long after the table shows. */
  hideAfterMs?: number;
}

export const OTHER_TABLE_EXPERT_MS = 5000;

const OTHER_TABLE_DECKS = 6;
const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

/** The best total of a hand (an ace counts 11 while that does not bust it). */
function handTotal(cards: readonly Card[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += rankValue(c.rank);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

/**
 * Deal one other table. Seeded, so a seed always deals the same table.
 * Hands at Hard and Expert are played roughly as a table plays them: 11 or
 * under always hits, 17 and over always stands, a stiff hits half the time;
 * never past 4 cards, the most the felt is laid out for.
 */
export function makeOtherTable(seed: number, difficulty: DistractionDifficulty): OtherTable {
  const rng = mulberry32(seed);
  const deck: Card[] = [];
  for (let d = 0; d < OTHER_TABLE_DECKS; d++) for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  const shoe = fisherYatesShuffle(deck, rng);
  let next = 0;
  const draw = (): Card => shoe[next++]!;

  const players = difficulty === 'easy' ? 3 : 6;
  const plays = difficulty === 'hard' || difficulty === 'expert';
  // Dealt as a table deals: one card round, the dealer's up-card, the second round.
  const dealRound = (): { dealer: Card; seats: Card[][] } => {
    const seats: Card[][] = Array.from({ length: players }, () => [draw()]);
    const dealer = draw();
    for (const s of seats) s.push(draw());
    return { dealer, seats };
  };
  let round = dealRound();
  // Hard always shows a hit: a round where nobody had a stiff to hit is
  // dealt again off the same shoe (a few dozen cards a round, 312 in it).
  for (let tries = 0; plays && tries < 8 && round.seats.every((s) => handTotal(s) >= 17); tries++) round = dealRound();
  const { dealer, seats } = round;

  if (plays) {
    let hits = 0;
    for (const s of seats) {
      while (s.length < 4) {
        const t = handTotal(s);
        if (t >= 17 || (t >= 12 && rng() < 0.5)) break;
        s.push(draw());
        hits++;
      }
    }
    if (hits === 0) {
      // Every stiff stood: the lowest takes a card.
      let low = 0;
      seats.forEach((s, i) => {
        if (handTotal(s) < handTotal(seats[low]!)) low = i;
      });
      if (handTotal(seats[low]!) < 17) seats[low]!.push(draw());
    }
  }
  return { dealer, seats, ...(difficulty === 'expert' ? { hideAfterMs: OTHER_TABLE_EXPERT_MS } : {}) };
}

/** Every card the table shows: the seats in order, then the dealer's up-card. */
export function otherTableCards(t: OtherTable): Card[] {
  return [...t.seats.flat(), t.dealer];
}

/** The Hi-Lo running count of that table alone (the app counts Hi-Lo only). */
export function otherTableCount(t: OtherTable): number {
  return otherTableCards(t).reduce((n, c) => n + hiLoTag(c.rank), 0);
}

/** Owner 2026-11-10: the Kind line under Play's gear, one per choice. */
export const OTHER_TABLE_DIFFICULTY_NOTES: Record<DistractionDifficulty, string> = {
  easy: 'Another table: 3 players, 2 cards each.',
  normal: 'Another table: 6 players, 2 cards each.',
  hard: 'Another table: 6 players, some of them hit.',
  expert: 'Another table, with hits, shown for 5 seconds.',
};
