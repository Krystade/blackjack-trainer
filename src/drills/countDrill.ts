import type { Card } from '../engine/cards';
import { Shoe } from '../engine/cards';
import { hiLoTag } from '../engine/count';

export interface CountDrillRound {
  groups: Card[][];
  finalRc: number;
}

/**
 * Generate a count drill round with the specified number of cards, grouped by groupSize.
 * Uses a seeded Shoe to ensure deterministic generation.
 *
 * @param cards - Total number of cards to generate (up to 312 for 6-deck shoe)
 * @param groupSize - Size of each group (1, 2, or 3)
 * @param seed - Optional seed for reproducibility
 * @returns CountDrillRound with grouped cards and final running count
 */
export function makeCountDrill(cards: number, groupSize: 1 | 2 | 3, seed?: number): CountDrillRound {
  const shoe = new Shoe({ decks: Math.ceil(cards / 52), seed });

  const allCards: Card[] = [];
  for (let i = 0; i < cards; i++) {
    allCards.push(shoe.draw());
  }

  // Group the cards
  const groups: Card[][] = [];
  for (let i = 0; i < allCards.length; i += groupSize) {
    groups.push(allCards.slice(i, i + groupSize));
  }

  // Calculate final running count
  const finalRc = allCards.reduce((sum, card) => sum + hiLoTag(card.rank), 0);

  return { groups, finalRc };
}

export interface CountdownRound {
  shown: Card[];
  hidden: Card;
}

/**
 * Generate a countdown round: a full 52-card deck with the last card hidden.
 * The sum of shown card tags equals the negative tag of the hidden card.
 *
 * @param seed - Optional seed for reproducibility
 * @returns CountdownRound with shown cards and hidden card
 */
export function makeCountdown(seed?: number): CountdownRound {
  const shoe = new Shoe({ decks: 1, seed });

  const allCards: Card[] = [];
  for (let i = 0; i < 52; i++) {
    allCards.push(shoe.draw());
  }

  const hidden = allCards.pop()!;
  const shown = allCards;

  return { shown, hidden };
}
