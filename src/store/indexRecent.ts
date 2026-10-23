import { WINDOW_SPARE } from './cellStats';
import type { IndexRecentEntry } from './types';

/**
 * Wave T: each index's recent answers, with the day each was given, so the
 * mastery tiers (habits/achievements.ts) can judge an index on its LAST N
 * answers that are also recent in time. `perIndex` is a lifetime tally with
 * no dates, so it can say neither.
 *
 * `recent` is '1' right / '0' wrong, oldest first (cellStats' format);
 * `days` is the same answers' UTC calendar days ('YYYY-MM-DD'), in the same
 * order, '' for an answer that carried no time at all. UTC because
 * applyEvents is pure and has no time zone; a day either way is nothing
 * against a 180-day window.
 */
export type IndexRecent = IndexRecentEntry;

/**
 * Answers kept per index: the longest window a tier is judged on (the Fab 4's
 * 50, habits/achievements.ts FAB4_WINDOW -- achievements.test.ts pins that
 * this covers it), plus cellStats' spare so "Wrong tap" restores the judged
 * window exactly once the store is full.
 */
export const INDEX_RECENT_KEEP = 50 + WINDOW_SPARE;

const DAY_MS = 86_400_000;

/** The UTC day of an ISO timestamp, '' when there is none (or it is not a date). */
export function answerDay(at: string | undefined): string {
  if (!at) return '';
  const t = Date.parse(at);
  return Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10);
}

/** The index's store after one more answer, trimmed to INDEX_RECENT_KEEP. */
export function indexRecentAfter(before: IndexRecent | undefined, correct: boolean, at: string | undefined): IndexRecent {
  const recent = (typeof before?.recent === 'string' ? before.recent : '') + (correct ? '1' : '0');
  const days = [...(Array.isArray(before?.days) ? before.days : []), answerDay(at)];
  return { recent: recent.slice(-INDEX_RECENT_KEEP), days: days.slice(-INDEX_RECENT_KEEP) };
}

/** The inverse of indexRecentAfter for "Wrong tap": the last answer dropped; undefined once empty. */
export function indexRecentUndone(current: IndexRecent | undefined): IndexRecent | undefined {
  if (!current || typeof current.recent !== 'string' || current.recent.length <= 1) return undefined;
  return { recent: current.recent.slice(0, -1), days: Array.isArray(current.days) ? current.days.slice(0, -1) : [] };
}

/**
 * Whether a day or timestamp falls in the last `maxAgeDays` days, by UTC day:
 * today (`nowMs`'s day) is day 0, so one `maxAgeDays` days old is out. A
 * missing or unreadable date is never recent -- its age cannot be shown.
 */
export function isRecent(at: unknown, nowMs: number, maxAgeDays: number): boolean {
  if (typeof at !== 'string' || at === '') return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Math.floor(nowMs / DAY_MS) - Math.floor(t / DAY_MS) < maxAgeDays;
}

/**
 * The results an index is judged on: its last `size` answers from the last
 * `maxAgeDays` days (isRecent), oldest first -- or null when it has fewer
 * than `size` such answers. A blob with `recent` and `days` out of step
 * (hand edited, or corrupt) is read from the end, where the two still pair up.
 */
export function recentWindow(entry: IndexRecent | undefined, size: number, nowMs: number, maxAgeDays: number): string | null {
  if (!entry || typeof entry.recent !== 'string' || !Array.isArray(entry.days)) return null;
  const n = Math.min(entry.recent.length, entry.days.length);
  const bits = entry.recent.slice(entry.recent.length - n);
  const days = entry.days.slice(entry.days.length - n);
  // From the newest back, stopping at `size`: the same as filtering every
  // answer and keeping the last `size`, without reading the rest.
  let out = '';
  for (let i = n - 1; i >= 0 && out.length < size; i -= 1) if (isRecent(days[i], nowMs, maxAgeDays)) out = bits[i] + out;
  return out.length >= size ? out : null;
}
