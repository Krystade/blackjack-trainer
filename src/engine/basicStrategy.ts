import type { Card, Rank } from './cards';
import { handValue, isPair, pairRank } from './hand';
import { DEFAULT_RULES } from './ruleset';
import type { RuleSet } from './ruleset';
import { getChart } from './charts';
import type { ChartAction } from './charts';

export type { ChartAction } from './charts';
export type UpIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; // dealer 2,3,4,5,6,7,8,9,10,A

/**
 * Map dealer up-card rank to index 0-9.
 * '2'->0 ... '9'->7, '10'/'J'/'Q'/'K'->8, 'A'->9
 */
export function upIndex(up: Rank): UpIndex {
  switch (up) {
    case '2':
      return 0;
    case '3':
      return 1;
    case '4':
      return 2;
    case '5':
      return 3;
    case '6':
      return 4;
    case '7':
      return 5;
    case '8':
      return 6;
    case '9':
      return 7;
    case '10':
    case 'J':
    case 'Q':
    case 'K':
      return 8;
    case 'A':
      return 9;
  }
}

// Re-exported for backward compatibility (v1's 340-cell test imports these
// directly) and as the default/v1 chart. Actual data now lives in
// charts/d68_h17.ts; per-ruleset selection goes through charts/index.ts.
export { HARD, SOFT, PAIRS } from './charts/d68_h17';

/**
 * Look up the basic strategy action for a player hand vs dealer up-card.
 * Routing: pairs first (if the pair rank has a PAIRS row), then soft, then hard.
 * pairRank normalizes ten-value pairs to '10' (absent from PAIRS -> falls to
 * hard 20) and 5,5 is also absent from PAIRS -> falls to hard 10.
 */
export function chartLookup(cards: Card[], dealerUp: Rank, rules: RuleSet = DEFAULT_RULES): ChartAction {
  const { HARD, SOFT, PAIRS } = getChart(rules);
  const idx = upIndex(dealerUp);

  if (isPair(cards)) {
    const rank = pairRank(cards);
    if (rank && rank in PAIRS) {
      return PAIRS[rank]![idx];
    }
    // Falls through to hard 20 (ten-pair) or hard 10 (five-pair)
  }

  const hv = handValue(cards);

  if (hv.soft) {
    return SOFT[hv.total][idx];
  }

  return HARD[hv.total][idx];
}
