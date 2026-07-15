import type { Card, Rank } from '../engine/cards';
import { RANKS, mulberry32, rankValue } from '../engine/cards';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import type { Action, DeviationId } from '../engine/deviations';
import { ILLUSTRIOUS_18 } from '../engine/deviations';

export interface QuizItem {
  cards: [Card, Card] | null; // null for insurance items
  up: Rank;
  tc: number;
  deviationId: DeviationId;
  isDeviationSide: boolean;
  correct: Action | 'take-insurance' | 'decline-insurance';
  label: string; // the index label for feedback
}

/**
 * Helper: find two cards that produce a specific hard total (non-pair).
 */
function findHardTotalCards(total: number): [Card, Card] | null {
  for (const r1 of RANKS) {
    for (const r2 of RANKS) {
      const v1 = rankValue(r1);
      const v2 = rankValue(r2);

      if (v1 === v2) continue; // non-pair
      if (v1 + v2 === total) {
        return [{ rank: r1, suit: 's' }, { rank: r2, suit: 's' }];
      }
    }
  }
  return null;
}

/**
 * Helper: construct cards for a pair10 (two ten-value cards).
 */
function makePair10Cards(): [Card, Card] {
  return [
    { rank: '10', suit: 's' },
    { rank: 'J', suit: 's' },
  ];
}

/**
 * Draw a random quiz item from the Illustrious 18.
 *
 * @param seed - Optional seed for reproducibility
 * @returns A quiz item
 */
export function drawQuizItem(seed?: number): QuizItem {
  const rng = mulberry32(seed ?? Date.now());

  // Pick a random entry from ILLUSTRIOUS_18
  const entryIndex = Math.floor(rng() * ILLUSTRIOUS_18.length);
  const entry = ILLUSTRIOUS_18[entryIndex];

  // Generate tc: integer uniform in [threshold - 2, threshold + 2]
  const tcMin = entry.threshold - 2;
  const tcMax = entry.threshold + 2;
  const tc = tcMin + Math.floor(rng() * (tcMax - tcMin + 1));

  // Determine isDeviationSide
  const isDeviationSide = entry.dir === 'gte' ? tc >= entry.threshold : tc <= entry.threshold;

  // Construct cards and correct action
  let cards: [Card, Card] | null;
  let correct: Action | 'take-insurance' | 'decline-insurance';

  if (entry.kind === 'insurance') {
    // Insurance: no cards, correct is take/decline based on tc
    cards = null;
    correct = insuranceCorrect(tc) ? 'take-insurance' : 'decline-insurance';
  } else if (entry.kind === 'pair10') {
    // pair10: two ten-value cards
    cards = makePair10Cards();
    const advice = correctPlay(cards, entry.up!, tc, {
      canDouble: true,
      canSplit: true,
      canSurrender: true,
    });
    correct = advice.action;
  } else {
    // hard: construct a non-pair hand with the specified total
    const totalCards = findHardTotalCards(entry.total!);
    if (!totalCards) {
      // Fallback: should not happen for valid entries
      throw new Error(`Cannot construct hard total ${entry.total}`);
    }
    cards = totalCards;
    const advice = correctPlay(cards, entry.up!, tc, {
      canDouble: true,
      canSplit: true,
      canSurrender: true,
    });
    correct = advice.action;
  }

  // Special case: 11vA (inactive) should always be 'double'
  if (entry.id === '11vA') {
    correct = 'double';
  }

  return {
    cards,
    up: entry.up || ('A' as Rank), // insurance has no up, use 'A' as placeholder
    tc,
    deviationId: entry.id,
    isDeviationSide,
    correct,
    label: entry.label,
  };
}
