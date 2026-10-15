import type { Settings } from '../store/types';
import type { FlashOptions } from './flashcards';

/**
 * #27 / #53: the deal options a hand drill draws with, from settings.
 *
 * Both are visual-only. A fallback hand can be three cards and a With-count
 * card carries a true count, and the eyes-free prompt says neither (every
 * spoken sentence needs a recorded clip), so in eyes-free the drill deals
 * exactly as it did before these options existed.
 */
export function flashOptionsFor(drill: Settings['drill'], eyesFree: boolean): FlashOptions {
  if (eyesFree) return { fallbacks: false, withCount: false };
  return { fallbacks: drill.fallbacks === true, withCount: drill.withCount === true };
}
