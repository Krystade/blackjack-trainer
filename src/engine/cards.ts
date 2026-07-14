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
function fisherYatesShuffle<T>(array: T[], rng: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class Shoe {
  private cards: Card[];
  private cardsDealtCount: number;
  private deckCount: number;
  private penetration: number;
  private rng: () => number;

  constructor(opts: { decks?: number; penetration?: number; seed?: number } = {}) {
    this.deckCount = opts.decks ?? 6;
    this.penetration = opts.penetration ?? 0.75;
    this.cardsDealtCount = 0;

    const seed = opts.seed ?? Date.now();
    this.rng = mulberry32(seed);

    this.cards = this.buildShoe();
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
    // Formula: max(0.5, round(cardsRemaining/26)/2)
    // cardsRemaining/26 gives decks in increments of 0.5
    // round(x)/2 rounds to nearest 0.5
    const cardsPerHalfDeck = 26;
    const halfDecksRemaining = this.cardsRemaining / cardsPerHalfDeck;
    const rounded = Math.round(halfDecksRemaining);
    return Math.max(0.5, rounded / 2);
  }

  get cutCardReached(): boolean {
    const cutCardPosition = Math.floor(this.deckCount * 52 * this.penetration);
    return this.cardsDealtCount >= cutCardPosition;
  }

  shuffle(): void {
    this.cardsDealtCount = 0;
    this.cards = this.buildShoe();
  }
}
