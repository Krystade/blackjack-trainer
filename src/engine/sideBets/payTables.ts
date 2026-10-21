/**
 * Wave L: THE SIDE BETS, AND THEIR PAY TABLES, AS PUBLISHED.
 *
 * A side bet is two things: the rule for what wins (engine/sideBets/odds.ts
 * computes each outcome's probability from the shoe) and a pay table, which
 * differs from casino to casino. The rules are code; the pay tables are data,
 * and every one here is TRANSCRIBED from a named page, with its URL beside it
 * (docs/BACKLOG.md "Status": no number from memory). A pay table maps each of
 * the bet's outcomes to what it pays "to 1"; an outcome a table does not list
 * loses the stake.
 *
 * `published` is the house edge the same page prints, as a fraction, for a
 * deck count -- payTables.test.ts computes the edge with the app's own
 * combinatorics and compares. A row whose source is ambiguous says so in
 * `note` (and `weak`).
 */

export type SideBetId = 'luckyLadies' | 'twentyOnePlus3' | 'perfectPairs' | 'royalMatch' | 'buster' | 'over13' | 'under13';

export const SIDE_BET_IDS: readonly SideBetId[] = ['luckyLadies', 'twentyOnePlus3', 'perfectPairs', 'royalMatch', 'buster', 'over13', 'under13'];

/**
 * Every outcome a bet can end in, finest first. Exclusive: a hand is exactly
 * one of these (or a loss). A pay table pays each by the line of its own that
 * the hand falls under -- e.g. a queen-of-hearts pair is "pair of queens" on
 * table C and "queen of hearts pair" on A.
 */
export const OUTCOMES = {
  luckyLadies: [
    // Two queens of hearts (identical cards), with / without a dealer blackjack.
    'qhPairBj',
    'qhPair',
    // Two identical queens of another suit.
    'qMatchedBj',
    'qMatched',
    // Two queens of different suits.
    'qRankedBj',
    'qRanked',
    // Other two-card 20s: identical cards; same rank, different suits; same suit; neither.
    'matched20',
    'ranked20',
    'suited20',
    'unsuited20',
  ],
  // The player's two cards and the dealer's up card as a three-card poker hand.
  twentyOnePlus3: ['suitedTrips', 'straightFlush', 'trips', 'straight', 'flush', 'pair'],
  // The player's first two cards a pair: identical; same colour; mixed colours.
  perfectPairs: ['perfect', 'colored', 'mixed'],
  // The player's first two cards suited: K-Q suited; a suited blackjack; any other suited pair.
  royalMatch: ['royal', 'suitedBj', 'suited'],
  // The dealer busts with this many cards (8 = eight or more); "Bj" = and the player has a blackjack.
  buster: ['b3', 'b4', 'b5', 'b6', 'b7Bj', 'b7', 'b8Bj', 'b8'],
  over13: ['win'],
  under13: ['win'],
} as const satisfies Record<SideBetId, readonly string[]>;

export type OutcomeOf<B extends SideBetId> = (typeof OUTCOMES)[B][number];
export type Outcome = OutcomeOf<SideBetId>;

export interface PublishedEdge {
  decks: number;
  /** House edge as a fraction (0.0324 = 3.24%); negative = a player edge. */
  edge: number;
  /** Buster only: the dealer's soft-17 rule the figure assumes. */
  s17?: boolean;
}

export interface PayTable {
  /** Stable id, stored on a profile and a casino game. */
  id: string;
  bet: SideBetId;
  /** "Table A (1000/125/19/9/4)". */
  name: string;
  /** What each outcome pays, to 1. Absent = the stake loses. */
  pays: Partial<Record<Outcome, number>>;
  sourceUrl: string;
  /** The page's own name for this table ("Pay Table A", "Version 1"). */
  sourceName: string;
  published: PublishedEdge[];
  /**
   * Published figures the app's combinatorics does NOT reproduce, with why
   * (as far as can be told). Kept, not averaged or dropped: the test checks
   * they still disagree, so a fix on either side is noticed.
   */
  disagree?: (PublishedEdge & { reason: string })[];
  /** Something about the source is ambiguous; says what. */
  note?: string;
  weak?: boolean;
}

const WOO = 'https://wizardofodds.com/games/blackjack/side-bets';

export const BET_NAMES: Record<SideBetId, string> = {
  luckyLadies: 'Lucky Ladies',
  twentyOnePlus3: '21+3',
  perfectPairs: 'Perfect Pairs',
  royalMatch: 'Royal Match',
  buster: 'Buster Blackjack',
  over13: 'Over 13',
  under13: 'Under 13',
};

/** The chip's label at 320px: a few letters. */
export const BET_SHORT: Record<SideBetId, string> = {
  luckyLadies: 'LL',
  twentyOnePlus3: '21+3',
  perfectPairs: 'Pairs',
  royalMatch: 'Royal',
  buster: 'Buster',
  over13: 'Over',
  under13: 'Under',
};

/** One line on what the bet is. */
export const BET_RULES: Record<SideBetId, string> = {
  luckyLadies: 'Your first two cards total 20. Queens pay more; two queens of hearts with a dealer blackjack pay most.',
  twentyOnePlus3: 'Your two cards and the dealer’s up card make a poker hand: flush, straight, three of a kind (ace high or low).',
  perfectPairs: 'Your first two cards are a pair: perfect (identical), coloured (same colour) or mixed.',
  royalMatch: 'Your first two cards are suited; a suited king–queen is a royal match.',
  buster: 'The dealer busts. Pays by how many cards the dealer busted with; the dealer plays out even if you bust.',
  over13: 'Your first two cards total more than 13, aces counting one. Exactly 13 loses.',
  under13: 'Your first two cards total less than 13, aces counting one. Exactly 13 loses.',
};

export const PAY_TABLES: readonly PayTable[] = [
  // ---------------------------------------------------------- Lucky Ladies
  {
    id: 'll-a',
    bet: 'luckyLadies',
    name: 'Table A (1000/125/19/9/4)',
    sourceName: 'Pay Table A',
    sourceUrl: `${WOO}/lucky-ladies/`,
    pays: { qhPairBj: 1000, qhPair: 125, qMatchedBj: 19, qMatched: 19, qRankedBj: 4, qRanked: 4, matched20: 19, ranked20: 4, suited20: 9, unsuited20: 4 },
    published: [
      { decks: 2, edge: 0.3005 },
      { decks: 6, edge: 0.2471 },
      { decks: 8, edge: 0.2405 },
    ],
  },
  {
    id: 'll-b',
    bet: 'luckyLadies',
    name: 'Table B (1000/200/25/10/4)',
    sourceName: 'Pay Table B',
    sourceUrl: `${WOO}/lucky-ladies/`,
    pays: { qhPairBj: 1000, qhPair: 200, qMatchedBj: 25, qMatched: 25, qRankedBj: 4, qRanked: 4, matched20: 25, ranked20: 4, suited20: 10, unsuited20: 4 },
    published: [
      { decks: 2, edge: 0.2494 },
      { decks: 6, edge: 0.1764 },
      { decks: 8, edge: 0.1673 },
    ],
  },
  {
    id: 'll-c',
    bet: 'luckyLadies',
    name: 'Table C (250/25/9/6/3)',
    sourceName: 'Pay Table C',
    sourceUrl: `${WOO}/lucky-ladies/`,
    // "Pair of queens, dealer blackjack 250; pair of queens 25; ranked 20 9; suited 20 6; any 20 3."
    pays: { qhPairBj: 250, qhPair: 25, qMatchedBj: 250, qMatched: 25, qRankedBj: 250, qRanked: 25, matched20: 9, ranked20: 9, suited20: 6, unsuited20: 3 },
    published: [
      { decks: 1, edge: 0.2989 },
      { decks: 2, edge: 0.2551 },
      { decks: 6, edge: 0.2264 },
      { decks: 8, edge: 0.2228 },
    ],
  },
  // ---------------------------------------------------------- 21+3
  {
    id: '213-v1',
    bet: 'twentyOnePlus3',
    name: 'Classic 9 to 1',
    sourceName: 'Version 1',
    sourceUrl: `${WOO}/21plus3/`,
    pays: { suitedTrips: 9, straightFlush: 9, trips: 9, straight: 9, flush: 9 },
    published: [
      { decks: 1, edge: 0.133 },
      { decks: 2, edge: 0.0726 },
      { decks: 6, edge: 0.0324 },
      { decks: 8, edge: 0.0274 },
    ],
  },
  {
    id: '213-v4',
    bet: 'twentyOnePlus3',
    name: 'Xtreme (30/20/10/5)',
    sourceName: 'Version 4 ("21+3 Xtreme")',
    sourceUrl: `${WOO}/21plus3/`,
    // No suited-trips line: suited trips are three of a kind (the better of trips and flush).
    pays: { suitedTrips: 20, straightFlush: 30, trips: 20, straight: 10, flush: 5 },
    published: [
      { decks: 1, edge: 0.22733 },
      { decks: 2, edge: 0.172736 },
      { decks: 6, edge: 0.133896 },
      { decks: 8, edge: 0.128912 },
    ],
  },
  {
    id: '213-v5',
    bet: 'twentyOnePlus3',
    name: '100/40/25/10/5',
    sourceName: 'Version 5 (Evolution)',
    sourceUrl: `${WOO}/21plus3/`,
    pays: { suitedTrips: 100, straightFlush: 40, trips: 25, straight: 10, flush: 5 },
    published: [{ decks: 6, edge: 0.0714 }],
  },
  {
    id: '213-v7',
    bet: 'twentyOnePlus3',
    name: '100/40/30/10/5',
    sourceName: 'Version 7 (Evolution)',
    sourceUrl: `${WOO}/21plus3/`,
    pays: { suitedTrips: 100, straightFlush: 40, trips: 30, straight: 10, flush: 5 },
    published: [{ decks: 4, edge: 0.0639 }],
    disagree: [
      {
        decks: 6,
        edge: 0.037,
        reason:
          'Computed 4.62%. The same page’s 4-deck figure (6.39%) is reproduced exactly with this table, and every other 21+3 table matches at 6 decks, so the 6-deck figure looks like a different table or a typo.',
      },
    ],
  },
  // ---------------------------------------------------------- Perfect Pairs
  {
    id: 'pp-a',
    bet: 'perfectPairs',
    name: '25/12/6',
    sourceName: 'Version 1, Pay Table A',
    sourceUrl: `${WOO}/perfect-pairs/`,
    pays: { perfect: 25, colored: 12, mixed: 6 },
    published: [
      { decks: 2, edge: 0.2233 },
      { decks: 6, edge: 0.0611 },
      { decks: 8, edge: 0.041 },
    ],
  },
  {
    id: 'pp-b',
    bet: 'perfectPairs',
    name: '30/10/5',
    sourceName: 'Version 1, Pay Table B',
    sourceUrl: `${WOO}/perfect-pairs/`,
    pays: { perfect: 30, colored: 10, mixed: 5 },
    published: [
      { decks: 2, edge: 0.2524 },
      { decks: 6, edge: 0.0579 },
      { decks: 8, edge: 0.0337 },
    ],
  },
  {
    id: 'pp-c',
    bet: 'perfectPairs',
    name: '25/12/5',
    sourceName: 'Version 1, Pay Table C',
    sourceUrl: `${WOO}/perfect-pairs/`,
    pays: { perfect: 25, colored: 12, mixed: 5 },
    published: [
      { decks: 2, edge: 0.2621 },
      { decks: 6, edge: 0.0997 },
      { decks: 8, edge: 0.0795 },
    ],
  },
  {
    id: 'pp-d',
    bet: 'perfectPairs',
    name: '25/15/5',
    sourceName: 'Version 1, Pay Table D',
    sourceUrl: `${WOO}/perfect-pairs/`,
    pays: { perfect: 25, colored: 15, mixed: 5 },
    published: [
      { decks: 2, edge: 0.2039 },
      { decks: 6, edge: 0.0418 },
      { decks: 8, edge: 0.0217 },
    ],
  },
  // ---------------------------------------------------------- Royal Match
  {
    id: 'rm-v1',
    bet: 'royalMatch',
    name: '25 / 5 to 2',
    sourceName: 'Version 1',
    sourceUrl: `${WOO}/royal-match/`,
    pays: { royal: 25, suitedBj: 2.5, suited: 2.5 },
    published: [
      { decks: 1, edge: 0.108597 },
      { decks: 2, edge: 0.083271 },
      { decks: 6, edge: 0.066658 },
      { decks: 8, edge: 0.064597 },
    ],
  },
  {
    id: 'rm-v2',
    bet: 'royalMatch',
    name: '10 / 3 to 1',
    sourceName: 'Version 2',
    sourceUrl: `${WOO}/royal-match/`,
    pays: { royal: 10, suitedBj: 3, suited: 3 },
    published: [
      { decks: 1, edge: 0.037707 },
      { decks: 2, edge: 0.008215 },
      { decks: 6, edge: -0.01113 },
      { decks: 8, edge: -0.013531 },
    ],
  },
  {
    id: 'rm-v3',
    bet: 'royalMatch',
    name: '25 / suited BJ 5 / 5 to 2',
    sourceName: 'Version 3',
    sourceUrl: `${WOO}/royal-match/`,
    pays: { royal: 25, suitedBj: 5, suited: 2.5 },
    published: [
      { decks: 1, edge: 0.0784 },
      { decks: 2, edge: 0.0534 },
      { decks: 6, edge: 0.037 },
      { decks: 8, edge: 0.0349 },
    ],
  },
  // ---------------------------------------------------------- Buster
  {
    id: 'bu-v1',
    bet: 'buster',
    name: '250/50/15/4/2',
    sourceName: 'Version 1',
    sourceUrl: `${WOO}/buster-blackjack/`,
    pays: { b8Bj: 250, b8: 250, b7Bj: 50, b7: 50, b6: 15, b5: 4, b4: 2, b3: 2 },
    published: [],
    note: 'The page lists six cards at 15 to 1 in Version 1’s pay table but 12 to 1 in its analysis; its house-edge summary is the 12 to 1 table (see 250/50/12/4/2). No published edge for this one.',
    weak: true,
  },
  {
    id: 'bu-v1a',
    bet: 'buster',
    name: '250/50/12/4/2',
    sourceName: 'Version 1 as analysed (house-edge summary)',
    sourceUrl: `${WOO}/buster-blackjack/`,
    pays: { b8Bj: 250, b8: 250, b7Bj: 50, b7: 50, b6: 12, b5: 4, b4: 2, b3: 2 },
    // The summary table does not name its pay table; all eight figures are
    // reproduced exactly with six cards at 12 to 1, and none with 15.
    published: [
      { decks: 1, edge: 0.0689, s17: false },
      { decks: 2, edge: 0.0651, s17: false },
      { decks: 6, edge: 0.0621, s17: false },
      { decks: 8, edge: 0.0617, s17: false },
      { decks: 1, edge: 0.0877, s17: true },
      { decks: 2, edge: 0.0848, s17: true },
      { decks: 6, edge: 0.0825, s17: true },
      { decks: 8, edge: 0.0822, s17: true },
    ],
  },
  {
    id: 'bu-v2',
    bet: 'buster',
    name: 'Player-BJ bonus (2000/800/250/50/18/4/2)',
    sourceName: 'Version 2',
    sourceUrl: `${WOO}/buster-blackjack/`,
    pays: { b8Bj: 2000, b7Bj: 800, b8: 250, b7: 50, b6: 18, b5: 4, b4: 2, b3: 2 },
    published: [{ decks: 6, edge: 0.062, s17: true }],
  },
  {
    id: 'bu-evo',
    bet: 'buster',
    name: '250/100/50/9/2/1',
    sourceName: 'Evolution Gaming, Infinite Blackjack',
    sourceUrl: `${WOO}/buster-blackjack/`,
    pays: { b8Bj: 250, b8: 250, b7Bj: 100, b7: 100, b6: 50, b5: 9, b4: 2, b3: 1 },
    published: [{ decks: 8, edge: 0.0618, s17: true }],
  },
  // ---------------------------------------------------------- Over/Under 13
  {
    id: 'ou-even',
    bet: 'over13',
    name: 'Even money',
    sourceName: 'Over 13',
    sourceUrl: `${WOO}/over-under-13/`,
    pays: { win: 1 },
    published: [
      { decks: 1, edge: 0.0679 },
      { decks: 2, edge: 0.0665 },
      { decks: 6, edge: 0.0655 },
      { decks: 8, edge: 0.0654 },
    ],
  },
  {
    id: 'ou-even',
    bet: 'under13',
    name: 'Even money',
    sourceName: 'Under 13',
    sourceUrl: `${WOO}/over-under-13/`,
    pays: { win: 1 },
    published: [
      { decks: 1, edge: 0.1011 },
      { decks: 2, edge: 0.1008 },
      { decks: 6, edge: 0.1007 },
      { decks: 8, edge: 0.1006 },
    ],
  },
];

export function payTablesFor(bet: SideBetId): PayTable[] {
  return PAY_TABLES.filter((t) => t.bet === bet);
}

export function payTableOf(bet: SideBetId, id: string): PayTable | null {
  return PAY_TABLES.find((t) => t.bet === bet && t.id === id) ?? null;
}

export function isSideBetId(x: unknown): x is SideBetId {
  return typeof x === 'string' && (SIDE_BET_IDS as readonly string[]).includes(x);
}
