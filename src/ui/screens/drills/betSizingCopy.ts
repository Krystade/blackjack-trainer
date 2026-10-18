import { CATEGORY_LABELS } from '../categoryLabels';

/**
 * Wave B2 #14: one vocabulary for the bet decision. Play grades it as two rows
 * (whether to play the round at all, and the size of the bet when you do); the
 * drill grades both in one answer. The drill keeps its name, Play's bet row is
 * scoped to "when playing", and the drill says which two rows its answer is.
 */
export const BET_SIZING_DRILL = 'Bet sizing';

export const BET_SIZING_PICKER = 'Read the running count and the tray, then sit out or bet your ramp: both decisions in one answer.';

export const BET_SIZING_INTRO =
  `Read the tray, divide, and bet your ramp; sit out at or below your exit point. One answer covers two of Play's rows: “${CATEGORY_LABELS.wong}” and “${CATEGORY_LABELS.bet}”.`;
