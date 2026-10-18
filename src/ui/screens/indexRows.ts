import type { Deviation, DeviationId } from '../../engine/deviations';
import type { IndexDirection, TallyRW } from '../../store/types';

/**
 * E7 (W2-16): Stats' Indexes table, as data.
 *
 * One row per index you have answered, worst first, with which way you miss
 * it: Early (the index play taken short of the index) or Late (the index
 * reached and the chart play taken anyway). Indexes never answered collapse to
 * a count instead of a column of dashes.
 */
export interface IndexRow {
  id: DeviationId;
  /** "16 v 10" -- the label before its colon. */
  hand: string;
  /** "stand at TC ≥ 0" -- the published wording (R6), after the colon. */
  play: string;
  right: number;
  wrong: number;
  answered: number;
  /** right / answered, 0..1. */
  accuracy: number;
  early: number;
  late: number;
}

export interface IndexTableData {
  seen: IndexRow[];
  /** Asked indexes with no answer yet ("N not seen yet"). */
  unseen: number;
}

/** A stored count, or 0 for anything that is not one (a hand-edited blob). */
function count(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Rows for `asked` (the indexes graded under the current rules, in set order).
 *
 * `wrong` adds the direction's `offTally` misses -- Play phantoms, which
 * perIndex never counted (see IndexDirection) -- so a row's accuracy and its
 * Early figure describe the same answers. Sorted by accuracy, lowest first;
 * ties put the index with more wrong answers first, then keep set order.
 */
export function indexRows(
  asked: readonly Deviation[],
  tally: Partial<Record<DeviationId, TallyRW>> | undefined,
  direction: Partial<Record<DeviationId, IndexDirection>> | undefined,
): IndexTableData {
  const seen: IndexRow[] = [];
  let unseen = 0;
  for (const dev of asked) {
    const t = tally?.[dev.id];
    const d = direction?.[dev.id];
    const right = count(t?.right);
    const wrong = count(t?.wrong) + count(d?.offTally);
    const answered = right + wrong;
    if (answered === 0) {
      unseen += 1;
      continue;
    }
    const cut = dev.label.indexOf(': ');
    seen.push({
      id: dev.id,
      hand: cut < 0 ? dev.label : dev.label.slice(0, cut),
      play: cut < 0 ? '' : dev.label.slice(cut + 2),
      right,
      wrong,
      answered,
      accuracy: right / answered,
      early: count(d?.early),
      late: count(d?.late),
    });
  }
  // Array.prototype.sort is stable, so equal rows keep set order.
  seen.sort((a, b) => a.accuracy - b.accuracy || b.wrong - a.wrong);
  return { seen, unseen };
}
