import type { Card, Rank } from '../engine/cards';
import { RANKS, mulberry32, rankValue } from '../engine/cards';
import { correctPlay } from '../engine/strategy';
import type { Action } from '../engine/deviations';

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
 * - hard: hard totals 5-17 (2 non-pair cards)
 * - soft: soft hands A+x (A with another card making soft totals 13-20)
 * - pairs: all pair ranks (A,2,3,4,5,6,7,8,9,10)
 */
function generateAllCells(): Cell[] {
  const cells: Cell[] = [];
  const upcards: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

  // Helper to build a cell
  function addCell(id: string, cards: [Card, Card], up: Rank) {
    cells.push({ id, cards, up });
  }

  // Hard totals: 5-17
  // 5 = 2+3, 6 = 2+4, 7 = 2+5, ..., 17 = 10+7
  for (const up of upcards) {
    for (let total = 5; total <= 17; total++) {
      // Find two cards that sum to total (avoiding pairs)
      // Strategy: try different combinations
      let found = false;
      for (const r1 of RANKS) {
        if (found) break;
        for (const r2 of RANKS) {
          const v1 = rankValue(r1);
          const v2 = rankValue(r2);

          if (v1 === v2) continue; // skip pairs for hard totals
          if (v1 + v2 === total) {
            addCell(`hard-${total}-v-${up}`, [{ rank: r1, suit: 's' }, { rank: r2, suit: 's' }], up);
            found = true;
            break;
          }
        }
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
 * @returns A flashcard with correct action
 */
export function drawFlashcard(
  category: 'all' | 'hard' | 'soft' | 'pairs',
  missWeights: Record<string, number>,
  seed?: number,
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
  const advice = correctPlay(cell.cards, cell.up, 0, {
    canDouble: true,
    canSplit: true,
    canSurrender: true,
  });

  return {
    cards: cell.cards as [Card, Card],
    up: cell.up,
    correct: advice.action,
    cellId: cell.id,
  };
}
