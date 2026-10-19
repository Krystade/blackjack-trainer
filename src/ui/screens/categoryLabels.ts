import type { Category } from '../../engine/grade';

/**
 * One name per graded category, shared by Home, Stats and the session report
 * so the same tally never reads two ways on two screens.
 */
export const CATEGORY_LABELS: Record<Category, string> = {
  hard: 'Hard totals',
  soft: 'Soft totals',
  pairs: 'Pairs',
  surrender: 'Surrender',
  insurance: 'Insurance',
  // Wave B2 #14: the size of the bet on a round you play. Whether to play at
  // all is `wong`; the Bet sizing drill grades the two together.
  bet: 'Bet size when playing',
  countCheck: 'Count checks',
  // RV7: this covers the play-or-sit decision on EVERY round with a spread
  // on, not only the rounds actually sat out -- so 'Wong-outs' would name a
  // subset of what it counts.
  // Wave J toggle rework: in toggle words -- the exit, from In.
  wong: 'Stay in or get out',
  // Wave J: the entry, from Out, kept apart from the exit above.
  wongIn: 'Stay out or get in',
};
