/**
 * #30: an answer slower than this was idle time, not thinking time.
 *
 * The one place the 30s cap lives. Hand drills (flashcards, quiz, Mixed,
 * mastery) still GRADE such an answer and still update spaced repetition;
 * only its timing is dropped, so median and latency stats are not dragged by
 * a phone left on the table. The count drill's manual tap gaps (#20) use the
 * same cap.
 */
export const IDLE_ANSWER_MS = 30_000;

/**
 * The latency to record for an answer, or `undefined` to record none.
 * A shot-clock timeout keeps its measured time whatever the limit: it is the
 * clock running out, not the learner walking away.
 */
export function trackedElapsedMs(elapsedMs: number | undefined, isTimeout: boolean): number | undefined {
  if (elapsedMs === undefined || isTimeout) return elapsedMs;
  return elapsedMs > IDLE_ANSWER_MS ? undefined : elapsedMs;
}
