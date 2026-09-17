import type { Action } from '../engine/deviations';
import { SELF_REPORT_HAD, SELF_REPORT_MISSED, TIMEOUT_ANSWER } from '../drills/gradeAnswer';

export const ACTION_LABEL: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

/**
 * What to PRINT for something a drill graded.
 *
 * `GradedEvent.taken` is a plain string precisely so the drills can record
 * answers that are not table plays, and every one of those is a trap for a
 * panel that prints it raw: "You played: timeout" and "You played:
 * self-report-missed" both describe plays nobody made, and the second is not
 * even English. Shared rather than duplicated because the same strings reach
 * the correction panel and the Stats mistake list, and only the panel had
 * been taught to read them.
 */
export function playLabel(value: string): string {
  if (value in ACTION_LABEL) return ACTION_LABEL[value as Action];
  if (value === 'take-insurance') return 'Take insurance';
  if (value === 'decline-insurance') return 'Decline insurance';
  if (value === TIMEOUT_ANSWER) return 'Nothing — time ran out';
  if (value === SELF_REPORT_HAD) return 'Said you had it';
  if (value === SELF_REPORT_MISSED) return 'Said you missed it';
  return value;
}
