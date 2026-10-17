import type { Card, Rank } from '../engine/cards';
import type { GradedEvent } from '../engine/grade';
import { handValue, isPair, pairRank } from '../engine/hand';
import type { Stats } from './types';

/**
 * B3 (spec 2026-10-13): per-cell accuracy.
 *
 * Every hand decision -- flashcards, mastery, the deviation quiz, Mixed and
 * Play -- is tallied against the chart cell it was asked on, keyed in the
 * flashcards' cell-id format ("hard-16-v-10", "soft-18-v-A", "pair-8-v-A").
 *
 * The producers do not all name the cell. Flashcards and mastery carry the
 * cell id itself as `hand`; Play and the quiz carry the dealt cards in table
 * notation ("9,7 v 10", "5,4,7 v 10"). Both are read here, so the key is
 * derived in ONE place and a 9,7 at the table lands on the same cell as a
 * hard-16 flashcard.
 */
export type CellTally = NonNullable<Stats['cellStats']>[string];

const CELL_ID = /^(hard|soft|pair)-([0-9]+|A)-v-([0-9]+|A)$/;
const TABLE_HAND = /^((?:[0-9]+|[AJQK])(?:,(?:[0-9]+|[AJQK]))+) v ([0-9]+|[AJQK])$/;
const RANKS = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);

/** Ten-value cards are one chart column and one pair row. */
function chartRank(rank: string): string {
  return rank === 'J' || rank === 'Q' || rank === 'K' ? '10' : rank;
}

/**
 * The chart cell a hand string names, or null when it names none (an
 * insurance item's "dealer A", an index label, a one-card hand).
 */
export function cellIdForHand(hand: string | undefined): string | null {
  if (!hand) return null;
  if (CELL_ID.test(hand)) return hand;
  const m = TABLE_HAND.exec(hand);
  if (!m) return null;
  const ranks = m[1]!.split(',');
  if (!ranks.every((r) => RANKS.has(r)) || !RANKS.has(m[2]!)) return null;
  const cards: Card[] = ranks.map((rank) => ({ rank: rank as Rank, suit: 's' }));
  const up = chartRank(m[2]!);
  if (isPair(cards)) return `pair-${pairRank(cards)}-v-${up}`;
  const value = handValue(cards);
  return `${value.soft ? 'soft' : 'hard'}-${value.total}-v-${up}`;
}

/** The cell an event is tallied under: hand decisions only. */
export function cellIdForEvent(event: GradedEvent): string | null {
  if (event.kind !== 'action') return null;
  return cellIdForHand(event.hand);
}

/**
 * The cell's tally after `event`. `lastAt` is the event's own `at`, else the
 * caller's `fallbackAt`; an event with neither keeps the cell's previous
 * date (empty on a cell seen for the first time) rather than inventing one --
 * applyEvents is pure and has no clock.
 */
export function cellAfter(
  before: CellTally | undefined,
  event: GradedEvent,
  fallbackAt?: string,
): CellTally {
  const base = before ?? { right: 0, wrong: 0, lastAt: '' };
  return {
    right: base.right + (event.correct ? 1 : 0),
    wrong: base.wrong + (event.correct ? 0 : 1),
    lastAt: event.at ?? fallbackAt ?? base.lastAt,
    recent: pushRecent(base.recent, event.correct, CELL_WINDOW),
  };
}

/* ---------------------------------------------------------------- */
/* Wave A / W3: judge "weak" on recent results, not lifetime totals.  */
/* ---------------------------------------------------------------- */

/** Results kept per cell: enough to judge 78% (Auto Focus, "Fix weak cells"). */
export const CELL_WINDOW = 10;
/** Results kept per hand type: enough to judge the 90% category gate. */
export const HAND_WINDOW = 30;

export type HandPrefix = 'hard' | 'soft' | 'pair';

/** `recent` with one more result on the end, trimmed to the last `max`. */
export function pushRecent(recent: string | undefined, correct: boolean, max: number): string {
  return ((recent ?? '') + (correct ? '1' : '0')).slice(-max);
}

/** `recent` with its last result removed (the inverse of pushRecent while untrimmed). */
export function popRecent(recent: string | undefined): string | undefined {
  if (!recent) return undefined;
  const out = recent.slice(0, -1);
  return out === '' ? undefined : out;
}

function countBits(recent: string): { right: number; wrong: number } {
  let right = 0;
  for (const ch of recent) if (ch === '1') right += 1;
  return { right, wrong: recent.length - right };
}

/**
 * The right/wrong figure a cell is JUDGED on: its recent window once that
 * holds at least `minSample` results, else the lifetime tally (a cell written
 * before the window shipped, or one with only a handful of answers since).
 */
export function judgedTally(t: CellTally | undefined, minSample: number): { right: number; wrong: number } {
  if (!t) return { right: 0, wrong: 0 };
  if (t.recent && t.recent.length >= minSample) return countBits(t.recent);
  return { right: t.right, wrong: t.wrong };
}

/**
 * The judged accuracy of a cell, 0..1, or undefined with no answers. Shared by
 * Auto (cellSelection) and Home's "Fix weak cells", so the two agree on what
 * is weak. The minimum sample matches Next step's MIN_CELL_ANSWERS.
 */
export function judgedAccuracy(t: CellTally | undefined, minSample = 5): number | undefined {
  const { right, wrong } = judgedTally(t, minSample);
  const n = right + wrong;
  return n > 0 ? right / n : undefined;
}

/** The hand type a cell id belongs to. */
export function handPrefixOf(cellId: string): HandPrefix | null {
  const m = /^(hard|soft|pair)-/.exec(cellId);
  return m ? (m[1] as HandPrefix) : null;
}

/** The recent-results window per hand type after a result on `cellId`. */
export function handRecentAfter(
  before: Stats['handRecent'],
  cellId: string,
  correct: boolean,
): Stats['handRecent'] {
  const prefix = handPrefixOf(cellId);
  if (prefix === null) return before;
  return { ...before, [prefix]: pushRecent(before?.[prefix], correct, HAND_WINDOW) };
}

/** The inverse of handRecentAfter for "Wrong tap"; empty branches are removed. */
export function handRecentUndone(current: Stats['handRecent'], cellId: string): Stats['handRecent'] {
  const prefix = handPrefixOf(cellId);
  if (prefix === null || !current) return current;
  const next = { ...current };
  const popped = popRecent(next[prefix]);
  if (popped === undefined) delete next[prefix];
  else next[prefix] = popped;
  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * The inverse of `cellAfter` for "Wrong tap". `before` is the cell as it was
 * just before the answer (captured by the grader); with it the undo is exact,
 * date included. Without it the count is still reversed and the date kept.
 * A cell emptied by the undo is removed, as it was never written.
 */
export function cellUndone(
  current: CellTally | undefined,
  event: GradedEvent,
  before?: CellTally | null,
): CellTally | null {
  if (before === null) return null;
  const base = current ?? { right: 0, wrong: 0, lastAt: '' };
  const right = event.correct ? Math.max(0, base.right - 1) : base.right;
  const wrong = event.correct ? base.wrong : Math.max(0, base.wrong - 1);
  if (right === 0 && wrong === 0) return null;
  const out: CellTally = { right, wrong, lastAt: before ? before.lastAt : base.lastAt };
  // W3: the window as it was (exact with `before`), else the last result dropped.
  const recent = before ? before.recent : popRecent(base.recent);
  if (recent !== undefined) out.recent = recent;
  return out;
}
