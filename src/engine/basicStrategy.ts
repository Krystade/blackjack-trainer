import type { Card, Rank } from './cards';
import { handValue, isPair, pairRank } from './hand';

export type ChartAction = 'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Ph' | 'Rh' | 'Rs' | 'Rp';
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

const H = 'H',
  S = 'S',
  Dh = 'Dh',
  Ds = 'Ds',
  P = 'P',
  Ph = 'Ph',
  Rh = 'Rh',
  Rs = 'Rs',
  Rp = 'Rp';

// Engine data, verbatim from task-5 brief. Columns are dealer 2 3 4 5 6 7 8 9 10 A.
export const HARD: Record<number, ChartAction[]> = {
  4: [H, H, H, H, H, H, H, H, H, H],
  5: [H, H, H, H, H, H, H, H, H, H],
  6: [H, H, H, H, H, H, H, H, H, H],
  7: [H, H, H, H, H, H, H, H, H, H],
  8: [H, H, H, H, H, H, H, H, H, H],
  9: [H, Dh, Dh, Dh, Dh, H, H, H, H, H],
  10: [Dh, Dh, Dh, Dh, Dh, Dh, Dh, Dh, H, H],
  11: [Dh, Dh, Dh, Dh, Dh, Dh, Dh, Dh, Dh, Dh],
  12: [H, H, S, S, S, H, H, H, H, H],
  13: [S, S, S, S, S, H, H, H, H, H],
  14: [S, S, S, S, S, H, H, H, H, H],
  15: [S, S, S, S, S, H, H, H, Rh, Rh],
  16: [S, S, S, S, S, H, H, Rh, Rh, Rh],
  17: [S, S, S, S, S, S, S, S, S, Rs],
  18: [S, S, S, S, S, S, S, S, S, S],
  19: [S, S, S, S, S, S, S, S, S, S],
  20: [S, S, S, S, S, S, S, S, S, S],
  21: [S, S, S, S, S, S, S, S, S, S],
};

export const SOFT: Record<number, ChartAction[]> = {
  13: [H, H, H, Dh, Dh, H, H, H, H, H],
  14: [H, H, H, Dh, Dh, H, H, H, H, H],
  15: [H, H, Dh, Dh, Dh, H, H, H, H, H],
  16: [H, H, Dh, Dh, Dh, H, H, H, H, H],
  17: [H, Dh, Dh, Dh, Dh, H, H, H, H, H],
  18: [Ds, Ds, Ds, Ds, Ds, S, S, H, H, H],
  19: [S, S, S, S, Ds, S, S, S, S, S],
  20: [S, S, S, S, S, S, S, S, S, S],
  21: [S, S, S, S, S, S, S, S, S, S],
};

export const PAIRS: Partial<Record<Rank, ChartAction[]>> = {
  '2': [Ph, Ph, P, P, P, P, H, H, H, H],
  '3': [Ph, Ph, P, P, P, P, H, H, H, H],
  '4': [H, H, H, Ph, Ph, H, H, H, H, H],
  '6': [Ph, P, P, P, P, H, H, H, H, H],
  '7': [P, P, P, P, P, P, H, H, H, H],
  '8': [P, P, P, P, P, P, P, P, P, Rp],
  '9': [P, P, P, P, P, S, P, P, S, S],
  A: [P, P, P, P, P, P, P, P, P, P],
};

/**
 * Look up the basic strategy action for a player hand vs dealer up-card.
 * Routing: pairs first (if the pair rank has a PAIRS row), then soft, then hard.
 * pairRank normalizes ten-value pairs to '10' (absent from PAIRS -> falls to
 * hard 20) and 5,5 is also absent from PAIRS -> falls to hard 10.
 */
export function chartLookup(cards: Card[], dealerUp: Rank): ChartAction {
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
