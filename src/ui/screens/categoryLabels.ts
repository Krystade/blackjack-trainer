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
  bet: 'Bet sizing',
  countCheck: 'Count checks',
  // RV7: this covers the play-or-sit decision on EVERY round with a spread
  // on, not only the rounds actually sat out -- so 'Wong-outs' would name a
  // subset of what it counts.
  wong: 'Play or sit out',
};
