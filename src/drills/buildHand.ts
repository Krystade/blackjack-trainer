import type { Card } from '../engine/cards';
import { RANKS, rankValue } from '../engine/cards';

/**
 * Build a concrete two-card HARD hand for a given total.
 * - Excludes aces: an A+x two-card hand is always SOFT (the ace counts as 11
 *   for any x <= 10), so it can never represent a hard total here.
 * - Excludes pairs (equal rank VALUES, so 10/J/Q/K never combine).
 * Constructible range: 5..19 (4 and 20 are only reachable as pairs).
 * Suits are varied (s, h) purely for display.
 *
 * Shared by flashcards.ts and deviationQuiz.ts so both modules build hard
 * hands identically.
 */
export function makeHardHand(total: number): [Card, Card] | null {
  for (const r1 of RANKS) {
    if (r1 === 'A') continue;
    for (const r2 of RANKS) {
      if (r2 === 'A') continue;
      const v1 = rankValue(r1);
      const v2 = rankValue(r2);
      if (v1 === v2) continue; // non-pair (also excludes 10/J/Q/K combos)
      if (v1 + v2 === total) {
        return [
          { rank: r1, suit: 's' },
          { rank: r2, suit: 'h' },
        ];
      }
    }
  }
  return null;
}
