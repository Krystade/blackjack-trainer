import type { Stats } from '../store/types';
import { ANSWER_SECTIONS } from '../habits/progress';

/**
 * Wave L (lane v): the answers, and the right ones, that one stats save added.
 *
 * The habit tracker's own signature (habits/progress.ts statsSignature) counts
 * answers; the guided session also needs how many were RIGHT, per segment,
 * from every drill it hosts, without touching any of them. Same two sources:
 *
 *   - graded events: `mistakes` counts each event once by its class, so the
 *     rise in the total is the answers and the rise in `correct` the right
 *     ones. A Wrong-tap undo lowers both, and is subtracted.
 *   - the history-only drills (count, true count, bet sizing ...): one row per
 *     answer, read from the UNTRIMMED save (a full history is flat once
 *     trimmed), right when the row says `correct` (or `ok`, bet sizing).
 */

export interface TallySig {
  events: number;
  correct: number;
  rows: Record<string, number>;
}

export interface Tally {
  answers: number;
  right: number;
}

export function tallySignature(stats: Stats): TallySig {
  let events = 0;
  for (const v of Object.values(stats.mistakes ?? {})) if (typeof v === 'number') events += v;
  const rows: Record<string, number> = {};
  const rec = stats as unknown as Record<string, { history?: unknown } | undefined>;
  for (const s of ANSWER_SECTIONS) {
    const h = rec[s]?.history;
    rows[s] = Array.isArray(h) ? h.length : 0;
  }
  return { events, correct: stats.mistakes?.correct ?? 0, rows };
}

function rowRight(row: unknown): boolean {
  if (!row || typeof row !== 'object') return false;
  const r = row as { correct?: unknown; ok?: unknown };
  return r.correct === true || r.ok === true;
}

/** What `untrimmed` added over `before`. A shrinking history (a cap, a reset) adds nothing. */
export function tallyDelta(before: TallySig, untrimmed: Stats): Tally {
  const after = tallySignature(untrimmed);
  let answers = after.events - before.events;
  let right = after.correct - before.correct;
  // A large fall is a reset or a restore, not an undo: a new baseline.
  if (answers < -1) {
    answers = 0;
    right = 0;
  }
  const rec = untrimmed as unknown as Record<string, { history?: unknown[] } | undefined>;
  for (const s of ANSWER_SECTIONS) {
    const d = (after.rows[s] ?? 0) - (before.rows[s] ?? 0);
    if (d <= 0) continue;
    answers += d;
    const h = rec[s]?.history;
    if (Array.isArray(h)) for (const row of h.slice(-d)) if (rowRight(row)) right += 1;
  }
  return { answers, right };
}
