export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export type Suit = 's' | 'h' | 'd' | 'c';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];

export function rankValue(rank: Rank): number {
  if (rank === 'A') return 11;
  if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') return 10;
  return parseInt(rank, 10);
}

/**
 * Mulberry32 - a simple deterministic PRNG
 * Returns a function that generates pseudo-random numbers in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0; // Ensure seed is an integer
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using a seeded RNG
 */
export function fisherYatesShuffle<T>(array: T[], rng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Decks remaining as the graded true count divides by it: the nearest half
 * deck, never below half a deck.
 *
 * F17: in the LAST deck of a one- or two-deck game it is the nearest quarter
 * deck instead. With 40 cards left in a single deck, half-deck snapping says
 * one deck, and RC +6 grades as TC +6 where the shoe really holds +7.8 -- a
 * two-count error on the very depths a pitch-game counter reads most closely.
 * Shoe games keep half decks throughout: there a half-deck step near the end
 * is a small share of what has been dealt.
 */
export function snapDecksRemaining(cardsRemaining: number, totalDecks: number): number {
  if (totalDecks <= 2 && cardsRemaining <= 52) {
    return Math.max(0.5, Math.round(cardsRemaining / 13) / 4);
  }
  return Math.max(0.5, Math.round(cardsRemaining / 26) / 2);
}

export class Shoe {
  private cards: Card[];
  private cardsDealtCount: number;
  private deckCount: number;
  private penetration: number;
  private rng: () => number;
  /** #39: cards left behind the cut, asked afresh for every shoe. Absent =
   * the cut sits at `penetration`, the same place every shoe. */
  private cutCards?: () => number;
  private cutPosition: number;

  constructor(
    opts: { decks?: number; penetration?: number; seed?: number; cutCards?: () => number } = {},
  ) {
    this.deckCount = opts.decks ?? 6;
    this.penetration = opts.penetration ?? 0.75;
    this.cutCards = opts.cutCards;
    this.cardsDealtCount = 0;

    const seed = opts.seed ?? Date.now();
    this.rng = mulberry32(seed);

    this.cards = this.buildShoe();
    this.cutPosition = this.placeCut();
  }

  /** Cards dealt before the cut card comes out, for the shoe just built. */
  private placeCut(): number {
    const total = this.deckCount * 52;
    if (this.cutCards) return total - this.cutCards();
    return Math.floor(total * this.penetration);
  }

  /** Cards dealt before the cut card comes out, in this shoe. */
  get cutCardPosition(): number {
    return this.cutPosition;
  }

  private buildShoe(): Card[] {
    const cards: Card[] = [];

    for (let deck = 0; deck < this.deckCount; deck++) {
      for (const suit of SUITS) {
        for (const rank of RANKS) {
          cards.push({ rank, suit });
        }
      }
    }

    return fisherYatesShuffle(cards, this.rng);
  }

  draw(): Card {
    if (this.cards.length === 0) {
      throw new Error('Cannot draw from empty shoe');
    }
    this.cardsDealtCount++;
    return this.cards.shift()!;
  }

  get cardsRemaining(): number {
    return this.cards.length;
  }

  get cardsDealt(): number {
    return this.cardsDealtCount;
  }

  get decksRemaining(): number {
    return snapDecksRemaining(this.cardsRemaining, this.deckCount);
  }

  get cutCardReached(): boolean {
    return this.cardsDealtCount >= this.cutPosition;
  }

  shuffle(): void {
    this.cardsDealtCount = 0;
    this.cards = this.buildShoe();
    this.cutPosition = this.placeCut();
  }
}
