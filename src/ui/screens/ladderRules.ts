import type { Stats } from '../../store/types';

/**
 * B2: the recent-window pass rules for the ladder's drill rungs (nextStep.ts).
 * Pure; every figure is judged on the last few answers, so old misses age out.
 */

/** Wave A's recent window for drill histories (statsFormat.trendLine). */
export const DRILL_WINDOW = 10;
/** 80%: the count rule's 4 of 5. */
export const DRILL_WINDOW_NEEDED = 8;
export const PLAY_SESSIONS_JUDGED = 5;
export const PLAY_MIN_GRADED = 40;
export const PLAY_TARGET = 0.9;

export interface WindowResult {
  judged: number;
  right: number;
  passed: boolean;
}

/** The last `window` rows; a row is right only when `correct === true` (legacy/corrupt rows count as misses). */
export function recentWindow(
  history: readonly { correct: unknown }[],
  window = DRILL_WINDOW,
  needed = DRILL_WINDOW_NEEDED,
): WindowResult {
  const rows = Array.isArray(history) ? history.slice(-window) : [];
  const right = rows.filter((r) => r?.correct === true).length;
  return { judged: rows.length, right, passed: rows.length >= window && right >= needed };
}

export function deckTcResult(stats: Stats): { deck: WindowResult; tc: WindowResult; passed: boolean } {
  const deck = recentWindow(stats.deckEstimation?.history ?? []);
  const tc = recentWindow(stats.trueCount?.history ?? []);
  return { deck, tc, passed: deck.passed && tc.passed };
}

export type BetSizingRow = { date: string; ok: boolean };

/** Contract 1: the bet sizing drill's history (another lane adds the field; cast dropped after merge). */
export function betSizingRows(stats: Stats): readonly BetSizingRow[] {
  const h = (stats as Stats & { betSizing?: { history?: BetSizingRow[] } }).betSizing?.history;
  return Array.isArray(h) ? h : [];
}

export function betRampResult(stats: Stats): WindowResult {
  return recentWindow(betSizingRows(stats).map((row) => ({ correct: row?.ok })));
}

/** Rung 7: one of the last PLAY_SESSIONS_JUDGED sessions has PLAY_MIN_GRADED+ graded decisions at PLAY_TARGET. */
export function playResult(stats: Stats): { best: { graded: number; correct: number } | null; passed: boolean } {
  const recent = (Array.isArray(stats.sessions) ? stats.sessions : []).slice(-PLAY_SESSIONS_JUDGED);
  let best: { graded: number; correct: number } | null = null;
  let passed = false;
  for (const s of recent) {
    const graded = Number.isFinite(s?.graded) ? s.graded : 0;
    const correct = Number.isFinite(s?.correct) ? s.correct : 0;
    if (graded >= PLAY_MIN_GRADED && correct / graded >= PLAY_TARGET) passed = true;
    if (!best || graded > best.graded) best = { graded, correct };
  }
  return { best, passed };
}

/** Date.parse, with NaN / '' / non-strings as 0 (never). */
export function parseTime(iso: unknown): number {
  if (typeof iso !== 'string' || iso === '') return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
