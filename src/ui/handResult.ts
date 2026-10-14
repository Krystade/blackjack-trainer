import type { Card, Rank } from '../engine/cards';
import type { GradedEvent, MistakeClass } from '../engine/grade';
import { playLabel } from './playLabel';
import { TIMEOUT_ANSWER } from '../drills/gradeAnswer';

/**
 * B1 (spec 2026-10-13, items #8, #10, #14, #17): the result of an answered
 * hand, frozen at the moment it was graded.
 *
 * The hand drills now show the NEXT hand the instant an answer lands, so the
 * live card on screen is no longer the one that was answered. Everything the
 * result strip prints, and the hand "Show on chart" opens, comes from this
 * snapshot instead. That is the whole fix for #10: mastery's chart used the
 * live cell after the run had already moved on, so a miss on 4,4 v 4 could
 * open the HARD chart for whatever the reshuffle dealt next.
 */
export interface HandResult {
  /** Changes for every answer, so the strip restarts its fade (ResultStrip). */
  id: number;
  correct: boolean;
  /** The answered hand's cards; `null` for an insurance question. */
  cards: Card[] | null;
  up: Rank;
  /** The true count the hand was asked at, or `null` where none was shown
   *  (flashcards, mastery). */
  tc: number | null;
  taken: string;
  expected: string;
  reason: string;
  classification?: MistakeClass;
  /** Flashcard cell id, for the SR line and specs. */
  cellId?: string;
  /** Mastery only: the progress a miss threw away. */
  progressLost?: { at: number; of: number };
  /** Quiz only: which table the question was asked for (tableMaskNote). */
  note?: string | null;
  /** Quiz only: the index label, shown under a correct answer. A miss
   *  already prints it as the reason. */
  label?: string;
  /** Flashcards only: the spaced-repetition line, read after grading. */
  sr?: { text: string; box?: number } | null;
  /** #22: withdrawn with "Wrong tap", so it no longer counts anywhere. */
  undone?: boolean;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** "9,7 v 10" -- the exact cards, as dealt. An insurance question has no
 *  hand: "Insurance v A". */
export function handText(cards: Card[] | null, up: Rank): string {
  if (!cards) return `Insurance v ${up}`;
  return `${cards.map((c) => c.rank).join(',')} v ${up}`;
}

/** A play as the strip prints it. The insurance event records 'take' and
 *  'decline', which `playLabel` would print raw. */
export function resultPlayLabel(value: string): string {
  if (value === 'take') return 'Take insurance';
  if (value === 'decline') return 'Decline insurance';
  return playLabel(value);
}

/** The hand plus, for a count question, the count it was asked at. */
export function resultHandLine(r: Pick<HandResult, 'cards' | 'up' | 'tc'>): string {
  const hand = handText(r.cards, r.up);
  return r.tc === null ? hand : `${hand} at TC ${formatSigned(r.tc)}`;
}

/** #14: "Correct! A,2 v 7 — Hit". */
export function correctLine(r: HandResult): string {
  return `Correct! ${resultHandLine(r)} — ${resultPlayLabel(r.expected)}`;
}

/** #17: "Run reset at 120/150". */
export function progressLostLine(lost: { at: number; of: number }): string {
  return `Run reset at ${lost.at}/${lost.of}`;
}

/** #22: "Not counted: 9,7 v 10" -- a withdrawn answer. */
export function undoneLine(r: Pick<HandResult, 'cards' | 'up' | 'tc'>): string {
  return `Not counted: ${resultHandLine(r)}`;
}

export function isTimeout(r: Pick<HandResult, 'taken'>): boolean {
  return r.taken === TIMEOUT_ANSWER;
}

/** Freeze a graded event and the hand it was graded on. */
export function snapshotResult(
  id: number,
  event: GradedEvent,
  hand: { cards: Card[] | null; up: Rank; tc: number | null },
  extra: Pick<HandResult, 'cellId' | 'progressLost' | 'note' | 'sr' | 'label'> = {},
): HandResult {
  return {
    id,
    correct: event.correct,
    // Copied, not referenced: the caller's card object is about to be
    // replaced, and nothing here may follow it.
    cards: hand.cards ? hand.cards.map((c) => ({ ...c })) : null,
    up: hand.up,
    tc: hand.tc,
    taken: event.taken,
    expected: event.expected,
    reason: event.reason,
    classification: event.classification,
    ...extra,
  };
}

/**
 * Drop focus from the answer button that was just tapped. With no Next step
 * the same buttons now take the NEXT hand's answer, so a focused button would
 * turn a habitual Enter/Space ("next") into a graded answer on a hand the
 * learner has not looked at.
 */
export function releaseAnswerFocus(): void {
  if (typeof document === 'undefined') return;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el.closest('.action-bar')) el.blur();
}
