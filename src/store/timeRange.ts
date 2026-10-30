/**
 * Time-range filtering for the Stats screen (operator request).
 *
 * Stats reported lifetime totals only, which answers "how have I ever played"
 * — not "am I better than I was last week", which is the question someone
 * training actually has. Every history entry already carries an ISO `date`
 * written at record time, so a range filter needs no schema change and no
 * migration; it is a read-side concern.
 *
 * Pure and clock-injected: `now` is always passed in, never read here, so the
 * boundaries are testable and cannot drift with the machine clock mid-render.
 */

export type RangeId = 'all' | '7d' | '30d' | '90d' | 'since';

export interface TimeRange {
  id: RangeId;
  /** ISO date (YYYY-MM-DD) for `since`; ignored otherwise. */
  since?: string;
}

export const RANGE_LABEL: Record<RangeId, string> = {
  all: 'All time',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  since: 'Since…',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The inclusive lower bound of a range as epoch ms, or `null` for "all time".
 * Returns `null` for a `since` range with a missing or unparseable date, so a
 * half-typed date shows everything rather than nothing.
 */
export function rangeStart(range: TimeRange, now: number): number | null {
  switch (range.id) {
    case 'all':
      return null;
    case '7d':
      return now - 7 * DAY_MS;
    case '30d':
      return now - 30 * DAY_MS;
    case '90d':
      return now - 90 * DAY_MS;
    case 'since': {
      // Shape-checked before parsing: Date.parse is lenient enough to accept a
      // half-typed "2026-08-" as a real date (the 1st of that month), so a
      // user mid-keystroke would silently get a bounded range they never
      // asked for. A date input always yields YYYY-MM-DD.
      if (!range.since || !/^\d{4}-\d{2}-\d{2}$/.test(range.since)) return null;
      // B11/B18: LOCAL midnight. Date.parse reads a date-only string as UTC
      // midnight, which in California is 17:00 the evening BEFORE -- so
      // "Since 28 Oct" counted the 27th's drive home. Every other day in the
      // app (streaks, practice days, the goal) is a local calendar day.
      const [y, m, d] = range.since.split('-').map(Number) as [number, number, number];
      const local = new Date(y, m - 1, d);
      // An impossible day (2026-02-31) would roll into March silently.
      if (local.getFullYear() !== y || local.getMonth() !== m - 1 || local.getDate() !== d) return null;
      return local.getTime();
    }
  }
}

/**
 * Keep entries at or after the range's start. Entries with no parseable date
 * are kept ONLY on "all time": they predate the field, and silently dropping
 * them from a bounded range would be honest, but dropping them from an
 * unbounded one would quietly shrink the lifetime totals.
 */
export function filterByRange<T extends { date?: string }>(
  entries: readonly T[],
  range: TimeRange,
  now: number,
): T[] {
  const start = rangeStart(range, now);
  if (start === null) return [...entries];
  return entries.filter((e) => {
    if (!e.date) return false;
    // A bare YYYY-MM-DD row names a local day already: compare days, not the
    // UTC instant Date.parse would make of it.
    if (range.id === 'since' && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) return e.date >= range.since!;
    const t = Date.parse(e.date);
    return !Number.isNaN(t) && t >= start;
  });
}
