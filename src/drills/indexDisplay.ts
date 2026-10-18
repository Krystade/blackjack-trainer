/**
 * R6 (#20, #30): the ONE way an index is shown to the user.
 *
 * The deviation sets store some indexes as `lte` thresholds -- 12 v 6 under
 * H17 is kept as "hit at TC <= -4" because that is how strategy.ts tests it.
 * The published index, and the number the Index test grades, is the count the
 * play changes AT: "stand at TC >= -3". Charts, the deviation labels, the
 * strips, Stats and Rules differences all print it this way, always as
 * "TC >= n", so a number learned on one screen is the number every other
 * screen (and the Index test) asks for.
 */
import type { Deviation } from '../engine/deviations';
import { signed } from './signed';

/** The count the play changes AT: `gte` -> threshold; `lte` -> threshold + 1. */
export function publishedIndex(dev: Deviation): number {
  return dev.dir === 'gte' ? dev.threshold : dev.threshold + 1;
}

/** "TC ≥ −3": the published index, with a real minus. */
export function publishedIndexText(dev: Deviation): string {
  return `TC ≥ ${signed(publishedIndex(dev))}`;
}

/** The play at and above the published index. */
export function indexPlayAt(dev: Pick<Deviation, 'id' | 'dir' | 'action' | 'above'>): Deviation['action'] {
  if (dev.dir === 'gte') return dev.action;
  if (!dev.above) throw new Error(`indexPlayAt: lte entry ${dev.id} has no 'above' play`);
  return dev.above;
}

/**
 * The play below the published index when the entry itself names it (an `lte`
 * entry stores the play below); null for `gte`, where below is the chart play.
 */
export function indexPlayBelow(dev: Deviation): Deviation['action'] | null {
  return dev.dir === 'lte' ? dev.action : null;
}
