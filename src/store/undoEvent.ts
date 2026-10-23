import type { GradedEvent } from '../engine/grade';
import type { IndexDirection, Stats, TallyRW } from './types';
import type { CellTally } from './cellStats';
import { cellUndone, handRecentUndone } from './cellStats';
import { indexRecentUndone } from './indexRecent';
import { countsInCategory, indexDirectionFor, tallyCellIdFor } from './stats';
import type { DirectedMiss } from './stats';

/**
 * #22 (spec 2026-10-13): "Wrong tap". The exact inverse of applying ONE graded
 * event with `applyEvents` (store/stats.ts), so a misclick leaves no trace in
 * the numbers it would have moved.
 *
 * Pure, and copy-on-write like `applyEvents`: no object reachable from the
 * input is mutated. `undoGradedEvent(applyEvents(s, [e]), e)` deep-equals `s`
 * (undoEvent.test.ts pins that for every branch `applyEvents` writes).
 *
 * Branches `applyEvents` CREATES on first write (a `bySource` bucket, the
 * `shotClockSplit` pair, a `perIndex` entry) are removed again once they are
 * back to all zeros: `applyEvents` never writes an all-zero tally, so an
 * all-zero one can only be the one this undo just emptied.
 *
 * Appended history rows (latency, EV cost) are removed by matching the row the
 * event produced, searched from the end: the undo is offered only until the
 * next answer, so the row is the last of its kind in practice, and matching
 * rather than popping means an unrelated row is never the one dropped.
 */
export function undoGradedEvent(stats: Stats, event: GradedEvent, cellBefore?: CellTally | null): Stats {
  const result: Stats = { ...stats };

  const dec = (t: TallyRW | undefined): TallyRW => {
    const base = t ?? { right: 0, wrong: 0 };
    return event.correct
      ? { ...base, right: Math.max(0, base.right - 1) }
      : { ...base, wrong: Math.max(0, base.wrong - 1) };
  };
  const isZero = (t: TallyRW) => t.right === 0 && t.wrong === 0;

  if (countsInCategory(event)) {
    result.categories = { ...stats.categories, [event.category]: dec(stats.categories[event.category]) };
  }

  if (event.deviationId) {
    const perIndex = { ...stats.perIndex };
    const tally = dec(perIndex[event.deviationId]);
    if (isZero(tally)) delete perIndex[event.deviationId];
    else perIndex[event.deviationId] = tally;
    result.perIndex = perIndex;
    // Wave T: the index's dated window loses the same answer; an emptied
    // entry, then an emptied map, is removed (applyEvents created them).
    if (stats.indexRecent?.[event.deviationId]) {
      const indexRecent = { ...stats.indexRecent };
      const entry = indexRecentUndone(indexRecent[event.deviationId]);
      if (entry === undefined) delete indexRecent[event.deviationId];
      else indexRecent[event.deviationId] = entry;
      if (Object.keys(indexRecent).length === 0) delete result.indexRecent;
      else result.indexRecent = indexRecent;
    }
  }

  if (event.source && stats.bySource?.[event.source]) {
    const bySource = { ...stats.bySource };
    const bucket = { ...bySource[event.source]! };
    bucket[event.category] = dec(bucket[event.category]);
    if (Object.values(bucket).every(isZero)) delete bySource[event.source];
    else bySource[event.source] = bucket;
    if (Object.keys(bySource).length === 0) delete result.bySource;
    else result.bySource = bySource;
  }

  if (event.underShotClock !== undefined && stats.shotClockSplit) {
    const split = {
      timed: event.underShotClock ? dec(stats.shotClockSplit.timed) : stats.shotClockSplit.timed,
      untimed: event.underShotClock ? stats.shotClockSplit.untimed : dec(stats.shotClockSplit.untimed),
    };
    if (isZero(split.timed) && isZero(split.untimed)) delete result.shotClockSplit;
    else result.shotClockSplit = split;
  }

  // B3: `cellBefore` is the cell as the grader found it (null = absent), so
  // the date is restored too; see cellStats.ts's cellUndone.
  const cellId = tallyCellIdFor(event);
  if (cellId !== null && stats.cellStats) {
    const cellStats = { ...stats.cellStats };
    const cell = cellUndone(cellStats[cellId], event, cellBefore);
    if (cell === null) delete cellStats[cellId];
    else cellStats[cellId] = cell;
    if (Object.keys(cellStats).length === 0) delete result.cellStats;
    else result.cellStats = cellStats;
    // W3: the per-hand-type window loses the same result.
    const handRecent = handRecentUndone(stats.handRecent, cellId);
    if (handRecent === undefined) delete result.handRecent;
    else result.handRecent = handRecent;
  }

  result.mistakes = {
    ...stats.mistakes,
    [event.classification]: Math.max(0, stats.mistakes[event.classification] - 1),
  };

  // D-R2: the table-only tallies applyEvents writes for a table event.
  if (event.source === 'table' && stats.tableMistakes) {
    const tableMistakes = { ...stats.tableMistakes };
    const left = Math.max(0, (tableMistakes[event.classification] ?? 0) - 1);
    if (left === 0) delete tableMistakes[event.classification];
    else tableMistakes[event.classification] = left;
    const tablePerIndex = { ...stats.tablePerIndex };
    if (event.deviationId) {
      const t = dec(tablePerIndex[event.deviationId]);
      if (isZero(t)) delete tablePerIndex[event.deviationId];
      else tablePerIndex[event.deviationId] = t;
    }
    if (Object.keys(tableMistakes).length === 0 && Object.keys(tablePerIndex).length === 0) {
      delete result.tableMistakes;
      delete result.tablePerIndex;
    } else {
      result.tableMistakes = tableMistakes;
      result.tablePerIndex = tablePerIndex;
    }
  }

  // E7: the early/late tallies applyEvents writes for a directed index miss.
  const miss = indexDirectionFor(event);
  if (miss) {
    const pooled = directionUndone(stats.indexDirection, miss);
    if (pooled === undefined) delete result.indexDirection;
    else result.indexDirection = pooled;
    if (event.source === 'table') {
      const table = directionUndone(stats.tableIndexDirection, miss);
      if (table === undefined) delete result.tableIndexDirection;
      else result.tableIndexDirection = table;
    }
  }

  if (event.elapsedMs !== undefined) {
    const i = findLastIndex(
      stats.latencyHistory,
      (r) => r.category === event.category && r.elapsedMs === event.elapsedMs && r.date === event.at,
    );
    if (i >= 0) result.latencyHistory = without(stats.latencyHistory, i);
  }

  if (event.evCost !== undefined) {
    const i = findLastIndex(
      stats.evCost.history,
      (r) =>
        r.category === event.category &&
        r.hand === event.hand &&
        r.taken === event.taken &&
        r.expected === event.expected &&
        r.units === event.evCost &&
        r.date === event.at &&
        r.source === event.source,
    );
    if (i >= 0) result.evCost = { ...stats.evCost, history: without(stats.evCost.history, i) };
  }

  return result;
}

/**
 * The whole "Wrong tap": undo the event, drop the retention row its grade
 * wrote (gradeAnswer.ts's persistGrade stamps that row with the event's own
 * `at`), and count the misclick so the habit stays visible in Stats.
 */
export function recordMisclick(stats: Stats, event: GradedEvent, cellBefore?: CellTally | null): Stats {
  const result = undoGradedEvent(stats, event, cellBefore);
  if (event.at !== undefined) {
    const keys = [event.hand, event.deviationId].filter((k): k is string => k !== undefined);
    const i = findLastIndex(stats.retention.history, (r) => r.date === event.at && keys.includes(r.key));
    if (i >= 0) result.retention = { ...stats.retention, history: without(stats.retention.history, i) };
  }
  result.misclicks = (stats.misclicks ?? 0) + 1;
  return result;
}

/** One directed miss withdrawn; an emptied entry, then an emptied map, is removed. */
function directionUndone(
  map: Stats['indexDirection'],
  miss: DirectedMiss,
): Stats['indexDirection'] {
  const entry = map?.[miss.id];
  if (!map || !entry) return map;
  const next: IndexDirection = { ...entry, [miss.side]: Math.max(0, entry[miss.side] - 1) };
  if (miss.offTally) {
    const left = Math.max(0, (entry.offTally ?? 0) - 1);
    if (left === 0) delete next.offTally;
    else next.offTally = left;
  }
  const out = { ...map };
  if (next.early === 0 && next.late === 0 && !next.offTally) delete out[miss.id];
  else out[miss.id] = next;
  return Object.keys(out).length === 0 ? undefined : out;
}

function findLastIndex<T>(rows: readonly T[], match: (row: T) => boolean): number {
  for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i]!)) return i;
  return -1;
}

function without<T>(rows: readonly T[], index: number): T[] {
  return [...rows.slice(0, index), ...rows.slice(index + 1)];
}
