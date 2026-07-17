import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { correctPlay } from '../engine/strategy';
import type { Action } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import { makeHardHand } from './buildHand';

export interface Flashcard {
  cards: [Card, Card];
  up: Rank;
  correct: Action;
  cellId: string;
}

/**
 * Cell ID format: "hard-16-v-9", "soft-18-v-A", "pair-8-v-10"
 */
interface Cell {
  id: string;
  cards: [Card, Card];
  up: Rank;
}

/**
 * Generate all possible flashcard cells.
 * Categories:
 * - hard: hard totals 5-19, built from two non-pair non-ace cards
 *   (4 and 20 are excluded: only constructible as pairs)
 * - soft: soft hands A+x (A with another card making soft totals 13-20)
 * - pairs: all pair ranks (A,2,3,4,5,6,7,8,9,10)
 * Universe size: (15 hard + 8 soft + 10 pair) x 10 upcards = 330 cells.
 */
function generateAllCells(): Cell[] {
  const cells: Cell[] = [];
  const upcards: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

  // Helper to build a cell
  function addCell(id: string, cards: [Card, Card], up: Rank) {
    cells.push({ id, cards, up });
  }

  // Hard totals: 5-19 (aces excluded — A+x is always soft; pairs excluded).
  for (const up of upcards) {
    for (let total = 5; total <= 19; total++) {
      const hand = makeHardHand(total);
      if (hand) {
        addCell(`hard-${total}-v-${up}`, hand, up);
      }
    }
  }

  // Soft totals: A+x makes soft 13-20
  // A+2 = soft 13, A+3 = soft 14, ..., A+9 = soft 20
  for (const up of upcards) {
    for (let softTotal = 13; softTotal <= 20; softTotal++) {
      // A counts as 11, so the other card must be softTotal - 11
      const otherValue = softTotal - 11;
      if (otherValue >= 2 && otherValue <= 9) {
        // Find a card with that value
        const otherRank = otherValue === 10 ? '10' : String(otherValue) as Rank;
        addCell(
          `soft-${softTotal}-v-${up}`,
          [{ rank: 'A', suit: 's' }, { rank: otherRank, suit: 's' }],
          up,
        );
      }
    }
  }

  // Pairs: A, 2-9, 10
  const pairRanks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  for (const up of upcards) {
    for (const rank of pairRanks) {
      addCell(`pair-${rank}-v-${up}`, [{ rank, suit: 's' }, { rank, suit: 'h' }], up);
    }
  }

  return cells;
}

/**
 * Draw a random flashcard from the specified category with weighted sampling.
 *
 * @param category - 'all', 'hard', 'soft', or 'pairs'
 * @param missWeights - Weight map (cellId -> weight) for missed cards
 * @param seed - Optional seed for reproducibility
 * @param rules - Optional ruleset (defaults to DEFAULT_RULES); selects the
 *   chart/deviations the correct action is graded against — additive param,
 *   omitting it preserves v1 (H17 6-deck) behavior exactly. Note: which cell
 *   is drawn depends only on category/missWeights/seed, never on rules.
 * @returns A flashcard with correct action
 */
export function drawFlashcard(
  category: 'all' | 'hard' | 'soft' | 'pairs',
  missWeights: Record<string, number>,
  seed?: number,
  rules: RuleSet = DEFAULT_RULES,
): Flashcard {
  const rng = mulberry32(seed ?? Date.now());

  // Generate all cells
  const allCells = generateAllCells();

  // Filter by category
  let cells: Cell[];
  if (category === 'all') {
    cells = allCells;
  } else if (category === 'pairs') {
    cells = allCells.filter((c) => c.id.startsWith('pair-'));
  } else {
    cells = allCells.filter((c) => c.id.startsWith(category + '-'));
  }

  // Compute weights: 1 + 2 * missWeight
  const weights = cells.map((c) => {
    const missCount = missWeights[c.id] ?? 0;
    return 1 + 2 * missCount;
  });

  // Weighted random selection
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = rng() * totalWeight;
  let selectedIndex = 0;

  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      selectedIndex = i;
      break;
    }
  }

  const cell = cells[selectedIndex];

  // Get correct action
  const advice = correctPlay(
    cell.cards,
    cell.up,
    0,
    {
      canDouble: true,
      canSplit: true,
      canSurrender: true,
    },
    rules,
  );

  return {
    cards: cell.cards as [Card, Card],
    up: cell.up,
    correct: advice.action,
    cellId: cell.id,
  };
}
