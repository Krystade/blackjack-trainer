import type { Category, MistakeClass } from '../../engine/grade';
import type { DeviationId } from '../../engine/deviations';
import { EMPTY_STATS, type IndexDirection, type Stats, type TallyRW } from '../../store/types';

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
  /** E7: the table's early/late misses per index. */
  indexDirection: Partial<Record<DeviationId, IndexDirection>>;
  mistakes: Record<MistakeClass, number>;
  evCostRows: Stats['evCost']['history'];
  /** F5 (W2-17): timed table decisions, for the median decision time. */
  decisionRows: NonNullable<Stats['tableDecisions']>['history'];
}

/** Every category, `wongIn` included -- EMPTY_STATS leaves it out (Wave J, store/types.ts). */
const PLAY_CATEGORIES: readonly Category[] = [...(Object.keys(EMPTY_STATS.categories) as Category[]), 'wongIn'];

export function playFigures(stats: Stats): PlayFigures {
  const table = stats.bySource?.table;
  const categories = Object.fromEntries(
    PLAY_CATEGORIES.map((c) => [c, { ...(table?.[c] ?? { right: 0, wrong: 0 }) }]),
  ) as Record<Category, TallyRW>;
  const mistakes = Object.fromEntries(
    (Object.keys(EMPTY_STATS.mistakes) as MistakeClass[]).map((m) => [m, stats.tableMistakes?.[m] ?? 0]),
  ) as Record<MistakeClass, number>;
  return {
    categories,
    perIndex: { ...stats.tablePerIndex },
    indexDirection: { ...stats.tableIndexDirection },
    mistakes,
    evCostRows: stats.evCost.history.filter((r) => r.source === 'table'),
    decisionRows: Array.isArray(stats.tableDecisions?.history) ? stats.tableDecisions.history : [],
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

/**
 * E7: the drills' side of the early/late tally, the same subtraction as
 * `drillPerIndex` -- pooled minus the table's slice.
 */
export function drillIndexDirection(stats: Stats): Partial<Record<DeviationId, IndexDirection>> {
  const out: Partial<Record<DeviationId, IndexDirection>> = {};
  for (const [id, d] of Object.entries(stats.indexDirection ?? {}) as [DeviationId, IndexDirection][]) {
    const tbl = stats.tableIndexDirection?.[id];
    const early = Math.max(0, (d?.early ?? 0) - (tbl?.early ?? 0));
    const late = Math.max(0, (d?.late ?? 0) - (tbl?.late ?? 0));
    const offTally = Math.max(0, (d?.offTally ?? 0) - (tbl?.offTally ?? 0));
    if (early + late + offTally > 0) out[id] = offTally > 0 ? { early, late, offTally } : { early, late };
  }
  return out;
}
