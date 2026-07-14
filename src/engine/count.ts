import type { Rank } from './cards';

/**
 * Returns the Hi-Lo tag for a card rank.
 * - 2-6: +1 (low cards favor the player)
 * - 7-9: 0 (neutral)
 * - 10/J/Q/K/A: -1 (high cards favor the dealer)
 */
export function hiLoTag(rank: Rank): -1 | 0 | 1 {
  if (rank === '2' || rank === '3' || rank === '4' || rank === '5' || rank === '6') {
    return 1;
  }
  if (rank === '7' || rank === '8' || rank === '9') {
    return 0;
  }
  return -1;
}

/**
 * Converts a running count to a true count by dividing by decks remaining.
 * Clamps decksRemaining to minimum 0.5.
 * Always floors toward -∞ (Math.floor).
 */
export function trueCount(runningCount: number, decksRemaining: number): number {
  const clampedDecks = Math.max(0.5, decksRemaining);
  return Math.floor(runningCount / clampedDecks);
}
