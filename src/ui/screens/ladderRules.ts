import type { Stats } from '../../store/types';
import type { SrDeck } from '../../drills/spacedRepetition';
import { generateAllCells } from '../../drills/flashcards';

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

/** Contract 1: the bet sizing drill's history. */
export function betSizingRows(stats: Stats): readonly BetSizingRow[] {
  const h = stats.betSizing?.history;
  return Array.isArray(h) ? h : [];
}

export function betRampResult(stats: Stats): WindowResult {
  return recentWindow(betSizingRows(stats).map((row) => ({ correct: row?.ok })));
}

/**
 * Rung 7: one of the last PLAY_SESSIONS_JUDGED sessions has PLAY_MIN_GRADED+
 * PLAY decisions (action events) at PLAY_TARGET. B2, R4: sit-outs, bets and
 * count checks no longer count -- a cold shoe sat out by the ramp padded the
 * threshold with easy decisions and ticked "Play a shoe". A row written before
 * plays were recorded counts as none.
 */
export function playResult(stats: Stats): { best: { graded: number; correct: number } | null; passed: boolean } {
  const recent = (Array.isArray(stats.sessions) ? stats.sessions : []).slice(-PLAY_SESSIONS_JUDGED);
  let best: { graded: number; correct: number } | null = null;
  let passed = false;
  for (const s of recent) {
    const graded = Number.isFinite(s?.plays) ? s.plays! : 0;
    const correct = Number.isFinite(s?.playsCorrect) ? s.playsCorrect! : 0;
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

/** W2: this many due cells put "Review N due" ahead of the rung. */
export const REVIEW_DUE_MIN = 20;

/**
 * Wave B2 #39 / R7: due indexes alone earn a review at min(8, ceil(active/2)).
 * An index set is at most about 25 ids (17 for 6D H17), so the cells' 20
 * could never be reached by indexes on their own.
 */
export function reviewIndexMin(activeCount: number): number {
  return Math.max(1, Math.min(8, Math.ceil(activeCount / 2)));
}

export interface DueCount {
  cells: string[];
  indexes: string[];
  total: number;
}

let cellIdSet: Set<string> | null = null;
const isCellId = (id: string) => (cellIdSet ??= new Set(generateAllCells().map((c) => c.id))).has(id);

/** Due ids of a deck: graduated (box >= 1, so a card missed today waits) and dueAt reached. */
function dueIds(deck: SrDeck, keep: (id: string) => boolean, now: number): string[] {
  return Object.entries(deck ?? {})
    .filter(([id, c]) => keep(id) && Number.isFinite(c?.box) && c.box >= 1 && Number.isFinite(c?.dueAt) && c.dueAt <= now)
    .map(([id]) => id)
    .sort();
}

export function dueForReview(flashSr: SrDeck, quizSr: SrDeck, activeIndexIds: readonly string[], now: number): DueCount {
  const active = new Set(activeIndexIds);
  const cells = dueIds(flashSr, isCellId, now);
  const indexes = dueIds(quizSr, (id) => active.has(id), now);
  return { cells, indexes, total: cells.length + indexes.length };
}

export type StaleKind = 'flash' | 'count' | 'deckest' | 'truecount' | 'quiz' | 'betsizing' | 'play';
export interface StaleSkill {
  kind: StaleKind;
  label: string;
  /** Epoch ms; 0 = never. */
  lastAt: number;
}

const lastDate = (rows: readonly { date?: unknown }[] | undefined): number =>
  Array.isArray(rows) && rows.length > 0 ? parseTime(rows[rows.length - 1]?.date) : 0;

/** W2: once every rung is done, the skill practised longest ago (ties: the earlier rung). */
export function stalestSkill(stats: Stats, quizSr: SrDeck, activeIndexIds: readonly string[]): StaleSkill {
  const cellsAt = Math.max(0, ...Object.values(stats.cellStats ?? {}).map((t) => parseTime(t?.lastAt)));
  const quizAt = Math.max(0, ...activeIndexIds.map((id) => {
    const t = quizSr?.[id]?.lastSeenAt;
    return Number.isFinite(t) ? t! : 0;
  }));
  const candidates: StaleSkill[] = [
    { kind: 'flash', label: 'Basic strategy', lastAt: cellsAt },
    { kind: 'count', label: 'Running count', lastAt: lastDate(stats.countDrill?.history) },
    { kind: 'deckest', label: 'Deck estimation', lastAt: lastDate(stats.deckEstimation?.history) },
    { kind: 'truecount', label: 'True count', lastAt: lastDate(stats.trueCount?.history) },
    { kind: 'quiz', label: 'Deviations', lastAt: quizAt },
    { kind: 'betsizing', label: 'Bet ramp', lastAt: lastDate(betSizingRows(stats)) },
    { kind: 'play', label: 'Play a shoe', lastAt: lastDate(stats.sessions) },
  ];
  return candidates.reduce((best, c) => (c.lastAt < best.lastAt ? c : best));
}
