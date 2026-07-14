import { rankValue } from './cards';
import type { Card, Rank } from './cards';

export interface HandValue {
  total: number;
  soft: boolean;
}

/**
 * Calculate the value of a hand.
 * - Aces are initially counted as 11
 * - Aces are demoted to 1 (one at a time) while total > 21
 * - soft = true if at least one ace is counted as 11
 */
export function handValue(cards: Card[]): HandValue {
  // Count aces
  let aceCount = 0;
  let total = 0;

  for (const card of cards) {
    if (card.rank === 'A') {
      aceCount++;
      total += 11; // Initially count as 11
    } else {
      total += rankValue(card.rank);
    }
  }

  // Demote aces from 11 to 1 while total > 21
  let acesAsEleven = aceCount;
  while (total > 21 && acesAsEleven > 0) {
    total -= 10; // Demote one ace from 11 to 1
    acesAsEleven--;
  }

  return {
    total,
    soft: acesAsEleven > 0, // soft if at least one ace is still counted as 11
  };
}

/**
 * Check if a hand is bust (total > 21).
 */
export function isBust(cards: Card[]): boolean {
  return handValue(cards).total > 21;
}

/**
 * Check if a hand is blackjack (exactly 2 cards totaling 21).
 */
export function isBlackjack(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  return handValue(cards).total === 21;
}

/**
 * Normalize a rank to its rank group.
 * 10, J, Q, K all normalize to '10'.
 */
function normalizeRank(rank: Rank): Rank {
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') {
    return '10';
  }
  return rank;
}

/**
 * Check if a hand is a pair (exactly 2 cards in the same rank group).
 * 10-value cards (10, J, Q, K) all form pairs with each other.
 */
export function isPair(cards: Card[]): boolean {
  if (cards.length !== 2) return false;
  return normalizeRank(cards[0].rank) === normalizeRank(cards[1].rank);
}

/**
 * Get the rank of a pair (normalized).
 * Returns null if not a pair.
 * 10, J, Q, K pairs all return '10'.
 */
export function pairRank(cards: Card[]): Rank | null {
  if (!isPair(cards)) return null;
  return normalizeRank(cards[0].rank);
}
