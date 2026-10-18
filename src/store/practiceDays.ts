import type { Stats } from './types';

/**
 * F10 (L-2): "Practised N of the last 7 days" on Home. No streak: a streak
 * punishes the one missed day and says nothing about the other six.
 *
 * A day counts when any graded answer or Play round was recorded on that
 * LOCAL calendar day -- the day Jack lived, not the UTC day the ISO string
 * names (an evening drive in California is already tomorrow in UTC).
 *
 * Read from the timestamps the stats already keep: every drill history row's
 * `date`, the dated latency and EV-cost rows, Play's session rows and decision
 * times, and each chart cell's `lastAt`. The few answers that write no dated
 * row of their own (an Index test answer, an idle or untimed hand) are dated
 * by `Stats.practiceDays`, the additive per-day set this module also owns.
 *
 * Pure: the caller passes `now`.
 */

/** Days kept in `Stats.practiceDays`. Home reads seven; the rest is slack. */
export const PRACTICE_DAYS_KEPT = 60;

/** The window Home reports on: today and the six days before it. */
export const PRACTICE_WINDOW_DAYS = 7;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' for the local calendar day `d` falls on. */
export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The local day of an ISO timestamp, or null for anything unreadable. */
export function dayKeyOfIso(iso: unknown): string | null {
  if (typeof iso !== 'string' || iso === '') return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return localDayKey(new Date(t));
}

/** `days` with `key` added: unique, oldest first, the newest PRACTICE_DAYS_KEPT. */
export function withPracticeDay(days: readonly string[] | undefined, key: string): string[] {
  const list = Array.isArray(days) ? days.filter((d) => typeof d === 'string') : [];
  if (list.includes(key)) return list;
  return [...list, key].sort().slice(-PRACTICE_DAYS_KEPT);
}

/** `stats` with the local day of `iso` in its per-day set (unchanged when unreadable or already there). */
export function notePracticeDay(stats: Stats, iso: string): Stats {
  const key = dayKeyOfIso(iso);
  if (key === null) return stats;
  const days = stats.practiceDays;
  if (Array.isArray(days) && days.includes(key)) return stats;
  return { ...stats, practiceDays: withPracticeDay(days, key) };
}

function addRowDates(into: Set<string>, rows: unknown, field: 'date' | 'lastAt' = 'date'): void {
  if (!Array.isArray(rows)) return;
  for (const row of rows) {
    if (row === null || typeof row !== 'object') continue;
    const key = dayKeyOfIso((row as Record<string, unknown>)[field]);
    if (key !== null) into.add(key);
  }
}

/** Every local day with a recorded graded answer or Play round. */
export function practiceDaySet(stats: Stats): Set<string> {
  const days = new Set<string>();
  if (Array.isArray(stats.practiceDays)) {
    for (const d of stats.practiceDays) if (typeof d === 'string') days.add(d);
  }
  // Every `{ history: [...] }` section, whatever its name: the count, true
  // count, deck, speed, bet sizing, produce-TC, pair, retention, downswing and
  // bet-or-sit drills, the EV-cost rows and Play's decision times. A section
  // added later is covered without a change here.
  for (const value of Object.values(stats as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && 'history' in value) {
      addRowDates(days, (value as { history: unknown }).history);
    }
  }
  addRowDates(days, stats.latencyHistory);
  addRowDates(days, stats.sessions);
  addRowDates(days, Object.values(stats.cellStats ?? {}), 'lastAt');
  return days;
}

export interface PracticeDays {
  /** Days in the window (today and the six before) with any practice. */
  practised: number;
  /** Any practice on record at all; Home hides the line when false. */
  ever: boolean;
}

export function practiceDays(stats: Stats, now: Date): PracticeDays {
  const days = practiceDaySet(stats);
  let practised = 0;
  // Stepped by calendar day, not by 24h: a DST change makes one day 23 or 25
  // hours long, and subtracting 24h from just after midnight would skip it.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < PRACTICE_WINDOW_DAYS; i++) {
    if (days.has(localDayKey(cursor))) practised += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { practised, ever: days.size > 0 };
}

/** Home's line, or null when there is no practice on record. */
export function practiceDaysText(stats: Stats, now: Date): string | null {
  const { practised, ever } = practiceDays(stats, now);
  if (!ever) return null;
  return `Practised ${practised} of the last ${PRACTICE_WINDOW_DAYS} days`;
}
