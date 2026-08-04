/**
 * V3-4 (docs/BACKLOG.md, red-team v3): SOFT competence gating for the pressure /
 * advanced experiential modes (the Downswing tilt session, the count-drill pace-
 * pressure toggle, the bet/sit/leave decision drill). The pressure-training
 * science says these are effective only once base counting fluency is in place —
 * but the operator wants SOFT gating (an advisory, never a lock), since they're
 * an expert and hard locks add friction. So this only tells the UI whether to
 * show a "build your fluency first" nudge; the modes stay clickable regardless.
 *
 * Fluency here = demonstrated basic count-drill competence: enough completed
 * runs at a decent accuracy. Pure/deterministic over the count-drill history.
 */

export const FLUENCY_MIN_RUNS = 10;
export const FLUENCY_MIN_ACCURACY = 0.7;

/** True once the learner has completed at least FLUENCY_MIN_RUNS count-drill runs
 * at >= FLUENCY_MIN_ACCURACY. Below that, advanced modes show a soft nudge. */
export function isCountFluent(countDrillHistory: readonly { correct: boolean }[]): boolean {
  if (countDrillHistory.length < FLUENCY_MIN_RUNS) return false;
  const correct = countDrillHistory.reduce((n, h) => n + (h.correct ? 1 : 0), 0);
  return correct / countDrillHistory.length >= FLUENCY_MIN_ACCURACY;
}
