import type { Action } from '../../engine/deviations';

export type Handedness = 'right' | 'left';

/**
 * Owner 2026-11-07: Hit and Stand first (the top row where the bar is drawn in
 * two rows), then Surrender, Double, Split -- Double in the middle of the
 * bottom row and Split nearest the holding thumb, so a left hand mirrors it
 * to Split, Double, Surrender. Hit and Stand do not mirror. The DOM order is
 * the visual order (one row or two), so focus order follows what is seen.
 * Keyboard keys stay bound to the action, not the position.
 */
export function actionButtons(hand: Handedness = 'right'): { key: Action; label: string }[] {
  const bottom: { key: Action; label: string }[] = [
    { key: 'surrender', label: 'Surrender' },
    { key: 'double', label: 'Double' },
    { key: 'split', label: 'Split' },
  ];
  return [
    { key: 'hit', label: 'Hit' },
    { key: 'stand', label: 'Stand' },
    ...(hand === 'left' ? bottom.reverse() : bottom),
  ];
}
