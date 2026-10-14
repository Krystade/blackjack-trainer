import type { MistakeClass } from '../engine/grade';

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
