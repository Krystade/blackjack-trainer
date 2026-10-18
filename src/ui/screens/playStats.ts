import type { Category, MistakeClass } from '../../engine/grade';
import type { DeviationId } from '../../engine/deviations';
import { EMPTY_STATS, type Stats, type TallyRW } from '../../store/types';

/**
 * D-R2 (Wave D, #4): what Stats > Play shows -- decisions made at the Play
 * table only. Flashcards, the quiz and every other drill feed the pooled
 * `categories`, `perIndex`, `mistakes` and EV-cost history too, so the Play
 * tab reads the table's own slices instead: `bySource.table`,
 * `tablePerIndex`, `tableMistakes` and the EV rows stamped `source: 'table'`.
 * A blob written before those slices existed has no table figures to show,
 * and reads as empty rather than borrowing the pooled drill answers.
 */
export interface PlayFigures {
  categories: Record<Category, TallyRW>;
  perIndex: Partial<Record<DeviationId, TallyRW>>;
  mistakes: Record<MistakeClass, number>;
  evCostRows: Stats['evCost']['history'];
}

export function playFigures(stats: Stats): PlayFigures {
  const table = stats.bySource?.table;
  const categories = Object.fromEntries(
    (Object.keys(EMPTY_STATS.categories) as Category[]).map((c) => [c, { ...(table?.[c] ?? { right: 0, wrong: 0 }) }]),
  ) as Record<Category, TallyRW>;
  const mistakes = Object.fromEntries(
    (Object.keys(EMPTY_STATS.mistakes) as MistakeClass[]).map((m) => [m, stats.tableMistakes?.[m] ?? 0]),
  ) as Record<MistakeClass, number>;
  return {
    categories,
    perIndex: { ...stats.tablePerIndex },
    mistakes,
    evCostRows: stats.evCost.history.filter((r) => r.source === 'table'),
  };
}

/**
 * The drills' side of the per-index tally: everything pooled that the table
 * did not answer (the quiz, the Index test, and answers from before the table
 * slice existed). Read by the Deviation quiz section on the Drills tab.
 */
export function drillPerIndex(stats: Stats): Partial<Record<DeviationId, TallyRW>> {
  const out: Partial<Record<DeviationId, TallyRW>> = {};
  for (const [id, t] of Object.entries(stats.perIndex) as [DeviationId, TallyRW][]) {
    const tbl = stats.tablePerIndex?.[id];
    const right = Math.max(0, t.right - (tbl?.right ?? 0));
    const wrong = Math.max(0, t.wrong - (tbl?.wrong ?? 0));
    if (right + wrong > 0) out[id] = { right, wrong };
  }
  return out;
}
