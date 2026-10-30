import type { Category } from '../engine/grade';
import type { Stats } from './types';
import { filterByRange, rangeStart, type TimeRange } from './timeRange';
import { localDayKey } from './practiceDays';

/**
 * B6: timed-answer accuracy over a range, reading the kept rows AND the daily
 * counts the history cap folded the dropped rows into. Each answer is in
 * exactly one of the two. A folded day is counted whole when it is on or
 * after the range's first local day -- so at the far edge of a rolling range
 * the figure can include up to one extra day of answers; the rows themselves
 * are filtered to the instant.
 */
export function rangedAccuracy(
  stats: Stats,
  range: TimeRange,
  now: number,
  cat?: Category,
): { right: number; total: number } {
  let right = 0;
  let total = 0;
  for (const r of filterByRange(stats.latencyHistory, range, now)) {
    if (r.correct === undefined || (cat !== undefined && r.category !== cat)) continue;
    total += 1;
    if (r.correct) right += 1;
  }
  const start = rangeStart(range, now);
  const daily = stats.latencyDaily;
  if (start === null || !daily || typeof daily !== 'object') return { right, total };
  const startKey = range.id === 'since' && range.since ? range.since : localDayKey(new Date(start));
  for (const [day, cats] of Object.entries(daily)) {
    if (day < startKey || !cats || typeof cats !== 'object') continue;
    for (const [c, t] of Object.entries(cats)) {
      if (cat !== undefined && c !== cat) continue;
      if (!t || typeof t.n !== 'number' || typeof t.right !== 'number') continue;
      total += t.n;
      right += t.right;
    }
  }
  return { right, total };
}

/**
 * Where the kept latency rows start, when the cap has dropped older ones
 * (null when nothing was ever dropped): the median and pace readouts read
 * only the rows, and say so for a range reaching back past this.
 */
export function latencyRowsStart(stats: Stats): string | null {
  const daily = stats.latencyDaily;
  if (!daily || typeof daily !== 'object' || Object.keys(daily).length === 0) return null;
  const first = stats.latencyHistory.find((r) => typeof r.date === 'string');
  return first?.date ?? null;
}
