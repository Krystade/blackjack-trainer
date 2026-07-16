import type { Rank } from '../cards';
import type { ChartAction } from './types';

// Moved verbatim from basicStrategy.ts (v1's only chart: 4-8 decks, H17).
// ZERO cell edits -- this is the pure-refactor skeleton task.
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
