import type { GradedEvent } from '../engine/grade';
import { loadStats, saveStats } from '../store/persist';
import { recordMisclick } from '../store/undoEvent';
import type { CellTally } from '../store/cellStats';
import { SELF_REPORT_MISSED, TIMEOUT_ANSWER } from '../drills/gradeAnswer';

/**
 * #22 (spec 2026-10-13): what a "Wrong tap" withdraws. Held by a hand drill
 * for the result strip now on screen, and dropped the moment another answer
 * is graded -- the link is offered only until the next answer.
 *
 * `revert` puts back whatever the drill itself moved: the spaced-repetition
 * card (flashcards, quiz, Mixed) or the mastery run. Stats are withdrawn here,
 * the same way for every drill.
 */
export interface WrongTapRecord {
  /** The HandResult.id of the strip this belongs to. */
  resultId: number;
  event: GradedEvent;
  revert: () => void;
  /** B3: the answered chart cell's tally before the answer (null = it had
   *  none), so the undo restores the cell's date as well as its count. */
  cellBefore?: CellTally | null;
}

/** Offered on a graded miss only. A shot-clock timeout and an admitted
 *  self-check miss are not taps at all, so there is nothing to have mis-tapped. */
export function wrongTapOffered(event: GradedEvent): boolean {
  return !event.correct && event.taken !== TIMEOUT_ANSWER && event.taken !== SELF_REPORT_MISSED;
}

/** Take the answer out of Stats and count the misclick, then let the drill
 *  revert its own state. */
export function withdrawAnswer(record: WrongTapRecord): void {
  saveStats(recordMisclick(loadStats(), record.event, record.cellBefore));
  record.revert();
}
