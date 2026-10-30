import type { MistakeClass } from '../engine/grade';
import { isRcRuleText } from '../engine/strategy';

/**
 * What each classification actually means, in the second person. These are
 * the sentences that turn a verdict into a lesson, so they name the fix
 * rather than restating the error.
 *
 * Shared by the full correction panel (components/MistakeCard.tsx) and the
 * B1 result strip (components/HandResultStrip.tsx), so the two cannot name
 * the same error differently.
 */
export const CLASS_COPY: Record<Exclude<MistakeClass, 'correct'>, { label: string; note: string }> = {
  'basic-error': {
    label: 'Basic strategy error',
    note: 'The count doesn\'t change this hand. It\'s pure basic strategy.',
  },
  'missed-deviation': {
    label: 'Missed deviation',
    note: 'Basic strategy is right at a neutral count, but the true count had passed the index for this hand.',
  },
  'phantom-deviation': {
    label: 'Phantom deviation',
    note: 'You deviated, but the true count hadn\'t reached the index yet. Basic strategy still applied.',
  },
  'wrong-anyway': {
    label: 'Wrong either way',
    note: 'Neither the basic strategy play nor the index play. Worth a slow look at this hand.',
  },
  timeout: {
    label: 'Out of time',
    note: 'No answer before the shot clock ran out. Knowing it slowly isn\'t the same as knowing it.',
  },
  'self-report': {
    label: 'Admitted miss',
    note: 'You said you didn\'t know this one, so no play was graded. It goes back to box 0 and comes up again this session.',
  },
};

/**
 * R2 (review of C11): at the table a zero-count cell is decided by the
 * running count's sign; when that went against the rounded true count the
 * reason says so (strategy.ts rcRuleText), and the note must not then speak
 * of the true count passing the index beside a TC of 0.
 */
const RC_COPY: Partial<Record<Exclude<MistakeClass, 'correct'>, string>> = {
  'missed-deviation':
    'Basic strategy is right at a running count of 0 or more, but the running count was negative, which decides this index whatever the true count rounds to.',
  'phantom-deviation': 'You deviated, but the running count was negative, so this index did not apply, whatever the true count rounds to.',
};

export function classCopyFor(classification: Exclude<MistakeClass, 'correct'>, reason: string | undefined): { label: string; note: string } {
  const base = CLASS_COPY[classification];
  const rc = reason !== undefined && isRcRuleText(reason) ? RC_COPY[classification] : undefined;
  return rc === undefined ? base : { ...base, note: rc };
}
