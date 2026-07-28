/**
 * R4 (docs/BACKLOG.md, interleaved / mixed-session mode): the schedule that
 * blends flashcard items (pure basic strategy, no count) with deviation-quiz
 * items (count-dependent) in a single session, so the learner keeps switching
 * between "the count doesn't matter" and "the count matters" -- the near-miss
 * discrimination the interleaving meta-analysis (Hedges' g ~= 0.42, strongest
 * for discriminating SIMILAR categories) says beats blocked practice.
 *
 * The prescription is RANDOM interleaving -- NOT blocked, NOT a rigid A-B-A
 * alternation. Each item is an independent seeded coin flip, so consecutive
 * items CAN be the same type (that's the point: the learner cannot predict
 * the next type and coast). Balanced ~50/50 by default.
 */

import { mulberry32 } from '../engine/cards';

export type MixedItemType = 'flash' | 'quiz';

/** Default P(flash) -- balanced 50/50 blend. */
export const DEFAULT_MIX_RATIO = 0.5;

/**
 * Pick the item type for position `index` of a mixed session seeded by
 * `sessionSeed`. PURE: the same (sessionSeed, index, ratio) always yields the
 * same type, so it is immune to React StrictMode's double-invocation and
 * trivially seedable in tests/e2e -- unlike advancing a single stateful rng,
 * which a re-render could desync.
 *
 * `ratio` is P(flash) in [0, 1]; the default is a balanced blend. A fresh
 * mulberry32 seeded at `sessionSeed + index` gives an independent, well-
 * distributed draw per position (verified ~0.50 balance over 10k positions).
 */
export function pickMixedType(sessionSeed: number, index: number, ratio: number = DEFAULT_MIX_RATIO): MixedItemType {
  const r = mulberry32(sessionSeed + index)();
  return r < ratio ? 'flash' : 'quiz';
}
