import type { GradedEvent } from '../engine/grade';
import { loadFlashSr, loadQuizSr, persistGrade, saveFlashSr, saveQuizSr } from './gradeAnswer';
import { reviewCard, SCREEN_CHANNEL, type AnswerChannel } from './spacedRepetition';
import { buildSpeedEvent, type SpeedQuestion } from './speedDrill';

/**
 * D-R9 (Jack, 2026-10-17): a Speed answer reaches Stats and the review
 * schedule ONLY when it is wrong. A miss is a real miss and must feed Review;
 * a right "Double? No" says nothing about the full chart answer, so correct
 * answers stay out (the Wave A F20 reasoning still holds for them). Wheel and
 * tapped alike.
 *
 * The miss is written without its time: a yes/no tap is not a chart decision's
 * latency, and letting it in would drag the medians F20 protected.
 *
 * Returns the event written, or null when nothing was.
 */
export function gradeSpeedAnswer(
  q: SpeedQuestion,
  saidYes: boolean,
  elapsedMs: number,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
): GradedEvent | null {
  const built = buildSpeedEvent(q, saidYes, elapsedMs, now);
  if (built.correct) return null;
  const { elapsedMs: _untimed, ...event } = built;
  void _untimed;
  if (event.deviationId) {
    const deck = loadQuizSr();
    saveQuizSr({ ...deck, [event.deviationId]: reviewCard(deck[event.deviationId], false, now, { channel }) });
  } else {
    const deck = loadFlashSr();
    saveFlashSr({ ...deck, [q.cellId]: reviewCard(deck[q.cellId], false, now, { channel }) });
  }
  persistGrade(event, null);
  return event;
}
