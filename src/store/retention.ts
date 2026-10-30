/**
 * Retention policy for the telemetry histories in `Stats`.
 *
 * The app has no backend: everything lives in localStorage, which is capped
 * around 5MB. Eleven history arrays were append-only with no truncation
 * anywhere, and a measured year of ordinary use (200 flashcards + 20 pair
 * cancellations + 60 spaced reviews + a session + a count run per day) reached
 * **5.6M characters** — past the ceiling.
 *
 * What made that a data-loss bug rather than a slow file: once `setItem`
 * starts throwing, the throw escapes through `saveStats`/`saveSettings` into
 * the click handlers that called them. Ending a table session throws before
 * the report renders, so the session's stats are lost and no report appears;
 * grading a flashcard throws before feedback renders, so the drill looks
 * frozen. All silent — there is no error boundary.
 *
 * So the fix is two-part: cap the histories here (the cause), and never let a
 * storage write throw into a caller (the blast radius) — see `persist.ts`.
 *
 * The cap is generous on purpose. It is a safety valve against unbounded
 * growth, not a product decision about how much history is interesting; every
 * consumer in `drillStats.ts`/`Stats.tsx` already summarises or slices to far
 * fewer entries than this.
 */

import type { Stats } from './types';
import { dayKeyOfIso } from './practiceDays';

/** Entries kept per history array. ~2000 x the largest entry (176 chars for a
 * session) is about 350K characters for ONE full array; with eleven-plus
 * arrays all full at once that is roughly 4M, which does NOT fit beside
 * everything else under a ~5MB quota. In practice most arrays fill slowly and
 * the cap is a valve, not a budget -- a write that still fails makes room by
 * shrinking the diagnostic log and is then reported (store/storageHealth.ts). */
export const HISTORY_CAP = 2000;

/** Most-recent-N, tolerant of a corrupt non-array value. */
function tail<T>(value: T[] | undefined): T[] | undefined {
  if (!Array.isArray(value)) return value;
  return value.length > HISTORY_CAP ? value.slice(value.length - HISTORY_CAP) : value;
}

/**
 * Returns a copy of `stats` with every history truncated to its most recent
 * `HISTORY_CAP` entries. Pure — the input is never mutated.
 *
 * Keeps the NEWEST entries: the Stats screen reports trends and recent bests,
 * so discarding the newest would make those readouts actively wrong.
 */
export function capHistories(stats: Stats): Stats {
  const next = structuredClone(stats);

  next.latencyHistory = foldDroppedLatency(next);
  next.sessions = tail(next.sessions) as Stats['sessions'];

  // Every nested `{ history: [...] }` section, addressed generically so a
  // future drill's history is capped the moment it is added.
  for (const value of Object.values(next as unknown as Record<string, unknown>)) {
    if (value && typeof value === 'object' && 'history' in value) {
      const section = value as { history: unknown[] };
      section.history = tail(section.history) as unknown[];
    }
  }

  return next;
}

/** B6: days of folded latency counts kept; the longest fixed range is 90 days. */
export const LATENCY_DAILY_DAYS = 730;

/**
 * B6: cap the latency history, folding every graded row it drops into
 * `latencyDaily` first. Mutates `next` (a clone) and returns the kept rows.
 */
function foldDroppedLatency(next: Stats): Stats['latencyHistory'] {
  const rows = next.latencyHistory;
  if (!Array.isArray(rows) || rows.length <= HISTORY_CAP) return rows;
  const dropped = rows.slice(0, rows.length - HISTORY_CAP);
  const daily: NonNullable<Stats['latencyDaily']> =
    next.latencyDaily && typeof next.latencyDaily === 'object' ? { ...next.latencyDaily } : {};
  for (const r of dropped) {
    // C13: an index-quiz row is filed under its hand's category but is not a
    // hand answer; folded, it could no longer be told apart, so it is not.
    if (!r || r.correct === undefined || r.indexOnly) continue;
    const day = dayKeyOfIso(r.date);
    if (day === null) continue;
    const cats = { ...(daily[day] ?? {}) };
    const t = cats[r.category] ?? { n: 0, right: 0 };
    cats[r.category] = { n: t.n + 1, right: t.right + (r.correct ? 1 : 0) };
    daily[day] = cats;
  }
  const days = Object.keys(daily).sort();
  for (const d of days.slice(0, Math.max(0, days.length - LATENCY_DAILY_DAYS))) delete daily[d];
  next.latencyDaily = daily;
  return rows.slice(rows.length - HISTORY_CAP);
}
