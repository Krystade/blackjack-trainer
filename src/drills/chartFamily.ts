import type { Chart, ChartAction } from '../engine/charts';
import type { Action } from '../engine/deviations';
import type { Rank } from '../engine/cards';
import type { PaintRow } from './cellSelection';

/**
 * A chart code's action FAMILY -- the five colours of the one action palette
 * (themes.css --act-*): Dh and Ds are both double, Rh/Rs/Rp all surrender,
 * the split variants all split. Shared by the Custom painter, which tints
 * each cell by it, and the chart test (F12), which grades by it.
 */
export function familyOf(action: ChartAction): Action {
  switch (action) {
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
    case 'Dh':
    case 'Ds':
      return 'double';
    case 'P':
    case 'Ph':
    case 'Pd':
    case 'Ps':
      return 'split';
    default:
      return 'surrender';
  }
}

/**
 * The chart action governing a painter cell. A pair rank with no PAIRS row
 * (5,5 and 10,10 in every shipped chart) plays as its hard total, as the
 * engine does.
 */
export function actionAt(chart: Chart, row: PaintRow, col: number): ChartAction {
  if (row.section === 'pair') {
    const pairRow = chart.PAIRS[row.key as Rank];
    if (pairRow) return pairRow[col]!;
    const v = row.key === 'A' ? 11 : Number(row.key);
    return chart.HARD[v * 2]?.[col] ?? 'S';
  }
  const table = row.section === 'hard' ? chart.HARD : chart.SOFT;
  return table[Number(row.key)]?.[col] ?? 'S';
}
