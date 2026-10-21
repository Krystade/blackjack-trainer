import { ACE, HEARTS, KING, QUEEN, TYPES, compTotal, rankCounts, suitCounts } from './comp';
import type { Comp } from './comp';
import { busterOdds } from './buster';
import type { Outcome, PayTable, SideBetId } from './payTables';

/**
 * Wave L: EXACT side-bet odds from a shoe composition.
 *
 * Every bet here is decided by the first two or three cards of the round (or,
 * for Buster, by the dealer's hand), and those are random draws without
 * replacement from what is left in the shoe -- so each outcome's probability
 * is a closed form in the 52 card-type counts. No simulation and no
 * approximation: the same functions price the bet off the top of a fresh
 * shoe (the house edge) and at any point in it (what a counter is after).
 * odds.test.ts checks every closed form against a brute-force enumeration of
 * the cards themselves.
 *
 * Which cards: the player's first two and, for 21+3, the dealer's up card.
 * At a table they are dealt interleaved (player, up, player, hole), but every
 * ordering of draws from a shuffled shoe is the same distribution, so the
 * order does not matter -- only that they are the round's first cards.
 *
 * The probabilities returned are EXCLUSIVE (a hand is exactly one outcome,
 * or a loss), so a pay table prices them by plain sums.
 */

export type OutcomeProbs = Partial<Record<Outcome, number>>;

/** Card types of one rank, as type indices. */
const typesOfRank = (r: number) => [r * 4, r * 4 + 1, r * 4 + 2, r * 4 + 3];

/** Value with the ace as one, by rank index. */
const VAL13 = (r: number) => (r >= 9 ? 10 : r + 1);

/**
 * Lucky Ladies. A two-card 20 is two ten-valued cards or an ace and a nine.
 * The dealer-blackjack lines need the dealer's two cards too: an ace and a
 * ten from the shoe less the player's two queens.
 */
export function luckyLadiesOdds(c: Comp): OutcomeProbs {
  const N = compTotal(c);
  const pairs = N * (N - 1);
  const ranks = rankCounts(c);
  const tens = ranks[9]! + ranks[10]! + ranks[11]! + ranks[12]!;
  const aces = ranks[ACE]!;
  // P(dealer blackjack | two queens gone): one ace, one ten among two cards from N - 2.
  const dbj = N >= 4 ? (2 * aces * (tens - 2)) / ((N - 2) * (N - 3)) : 0;
  const qh = c[QUEEN * 4 + HEARTS]!;
  const qhPair = (qh * (qh - 1)) / pairs;
  let qMatched = 0;
  for (const s of [0, 2, 3]) {
    const n = c[QUEEN * 4 + s]!;
    qMatched += (n * (n - 1)) / pairs;
  }
  const q = ranks[QUEEN]!;
  const qAll = (q * (q - 1)) / pairs; // two queens, any suits
  const qRanked = qAll - qhPair - qMatched;
  // Other 20s.
  let matched = 0; // identical non-queen cards making 20: ten-valued
  let ranked = 0; // same rank, different suit, non-queen ten-valued
  for (const r of [9, 10, 12]) {
    let same = 0;
    for (const t of typesOfRank(r)) same += (c[t]! * (c[t]! - 1)) / pairs;
    matched += same;
    ranked += (ranks[r]! * (ranks[r]! - 1)) / pairs - same;
  }
  // Suited 20s of different ranks: two different ten-valued ranks, or A+9, in one suit.
  let suited = 0;
  let any20 = 0;
  // Any 20 with two different ranks: ten-valued pairs of distinct ranks, and A-9.
  const tenRanks = [9, 10, 11, 12];
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      any20 += (2 * ranks[tenRanks[i]!]! * ranks[tenRanks[j]!]!) / pairs;
      for (let s = 0; s < 4; s++) suited += (2 * c[tenRanks[i]! * 4 + s]! * c[tenRanks[j]! * 4 + s]!) / pairs;
    }
  }
  any20 += (2 * ranks[ACE]! * ranks[8]!) / pairs;
  for (let s = 0; s < 4; s++) suited += (2 * c[ACE * 4 + s]! * c[8 * 4 + s]!) / pairs;
  const unsuited = any20 - suited;
  return {
    qhPairBj: qhPair * dbj,
    qhPair: qhPair * (1 - dbj),
    qMatchedBj: qMatched * dbj,
    qMatched: qMatched * (1 - dbj),
    qRankedBj: qRanked * dbj,
    qRanked: qRanked * (1 - dbj),
    matched20: matched,
    ranked20: ranked,
    suited20: suited,
    unsuited20: unsuited,
  };
}

/** The twelve three-rank straights, ace low (A-2-3) and high (Q-K-A). */
export const STRAIGHTS: readonly (readonly [number, number, number])[] = [
  ...Array.from({ length: 11 }, (_, i) => [i, i + 1, i + 2] as const),
  [11, 12, ACE] as const,
];

/** 21+3: the player's two cards and the dealer's up card. */
export function twentyOnePlus3Odds(c: Comp): OutcomeProbs {
  const N = compTotal(c);
  const N3 = N * (N - 1) * (N - 2);
  const ranks = rankCounts(c);
  const suits = suitCounts(c);
  let suitedTrips = 0;
  for (let t = 0; t < TYPES; t++) suitedTrips += c[t]! * (c[t]! - 1) * (c[t]! - 2);
  let tripsAny = 0;
  for (const n of ranks) tripsAny += n * (n - 1) * (n - 2);
  let flushAny = 0;
  for (const n of suits) flushAny += n * (n - 1) * (n - 2);
  let straightAny = 0;
  let sf = 0;
  for (const [a, b, d] of STRAIGHTS) {
    straightAny += 6 * ranks[a]! * ranks[b]! * ranks[d]!;
    for (let s = 0; s < 4; s++) sf += 6 * c[a * 4 + s]! * c[b * 4 + s]! * c[d * 4 + s]!;
  }
  // Exactly two of a rank: the pair in either of three places.
  let pairAny = 0;
  let flushPair = 0;
  for (let r = 0; r < 13; r++) {
    pairAny += 3 * ranks[r]! * (ranks[r]! - 1) * (N - ranks[r]!);
    for (let s = 0; s < 4; s++) {
      const n = c[r * 4 + s]!;
      // Two identical cards and a third of the same suit, another rank.
      flushPair += 3 * n * (n - 1) * (suits[s]! - n);
    }
  }
  return {
    suitedTrips: suitedTrips / N3,
    straightFlush: sf / N3,
    trips: (tripsAny - suitedTrips) / N3,
    straight: (straightAny - sf) / N3,
    flush: (flushAny - sf - suitedTrips) / N3,
    pair: (pairAny - flushPair) / N3,
  };
}

/** Perfect Pairs: spades and clubs are black, hearts and diamonds red. */
export function perfectPairsOdds(c: Comp): OutcomeProbs {
  const N = compTotal(c);
  const pairs = N * (N - 1);
  const ranks = rankCounts(c);
  let perfect = 0;
  let colored = 0;
  let any = 0;
  for (let r = 0; r < 13; r++) {
    any += ranks[r]! * (ranks[r]! - 1);
    for (let s = 0; s < 4; s++) perfect += c[r * 4 + s]! * (c[r * 4 + s]! - 1);
    colored += 2 * (c[r * 4]! * c[r * 4 + 3]! + c[r * 4 + 1]! * c[r * 4 + 2]!);
  }
  return { perfect: perfect / pairs, colored: colored / pairs, mixed: (any - perfect - colored) / pairs };
}

/** Royal Match: a suited K-Q; a suited ace and ten-valued card; any other suited two. */
export function royalMatchOdds(c: Comp): OutcomeProbs {
  const N = compTotal(c);
  const pairs = N * (N - 1);
  const suits = suitCounts(c);
  let royal = 0;
  let suitedBj = 0;
  let suited = 0;
  for (let s = 0; s < 4; s++) {
    royal += 2 * c[KING * 4 + s]! * c[QUEEN * 4 + s]!;
    const tens = c[9 * 4 + s]! + c[10 * 4 + s]! + c[QUEEN * 4 + s]! + c[KING * 4 + s]!;
    suitedBj += 2 * c[ACE * 4 + s]! * tens;
    suited += suits[s]! * (suits[s]! - 1);
  }
  return { royal: royal / pairs, suitedBj: suitedBj / pairs, suited: (suited - royal - suitedBj) / pairs };
}

/** Over / Under 13: the two-card total, aces one. */
export function overUnderOdds(c: Comp): { over: number; under: number; thirteen: number } {
  const N = compTotal(c);
  const pairs = N * (N - 1);
  const ranks = rankCounts(c);
  const byVal = new Array<number>(11).fill(0);
  for (let r = 0; r < 13; r++) byVal[VAL13(r)]! += ranks[r]!;
  let over = 0;
  let under = 0;
  let thirteen = 0;
  for (let a = 1; a <= 10; a++) {
    for (let b = 1; b <= 10; b++) {
      const w = a === b ? byVal[a]! * (byVal[a]! - 1) : byVal[a]! * byVal[b]!;
      const t = a + b;
      if (t > 13) over += w;
      else if (t < 13) under += w;
      else thirteen += w;
    }
  }
  return { over: over / pairs, under: under / pairs, thirteen: thirteen / pairs };
}

export interface OddsOptions {
  /** Buster: the dealer stands on soft 17 (absent = true). */
  s17?: boolean;
}

/** Every outcome's probability for this bet, from this composition. */
export function outcomeProbs(bet: SideBetId, c: Comp, opts: OddsOptions = {}): OutcomeProbs {
  switch (bet) {
    case 'luckyLadies':
      return luckyLadiesOdds(c);
    case 'twentyOnePlus3':
      return twentyOnePlus3Odds(c);
    case 'perfectPairs':
      return perfectPairsOdds(c);
    case 'royalMatch':
      return royalMatchOdds(c);
    case 'buster':
      return busterOdds(c, opts.s17 ?? true);
    case 'over13':
      return { win: overUnderOdds(c).over };
    case 'under13':
      return { win: overUnderOdds(c).under };
  }
}

/** Expected return per unit staked: sum of P x pay, less P(lose). */
export function evOf(probs: OutcomeProbs, pays: PayTable['pays']): number {
  let ev = 0;
  let winP = 0;
  for (const [k, p] of Object.entries(probs) as [Outcome, number][]) {
    const pay = pays[k];
    if (pay === undefined) continue;
    ev += p * pay;
    winP += p;
  }
  return ev - (1 - winP);
}

/** The bet's expected return per unit from this composition. */
export function sideBetEv(bet: SideBetId, pays: PayTable['pays'], c: Comp, opts: OddsOptions = {}): number {
  return evOf(outcomeProbs(bet, c, opts), pays);
}
