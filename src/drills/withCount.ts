/**
 * #53 (spec 2026-10-13): "With count" flashcards. Each card shows a true
 * count and is graded with `correctPlay` at it, so a flashcard asks the whole
 * question -- chart AND index -- instead of the chart alone.
 *
 * The count is not uniform. Most cells have no index, and on the ones that do
 * a uniform count would sit short of the threshold most of the time, so the
 * deviation would almost never be the answer. When the hand has an index the
 * engine can reach, the count is drawn at or past it INDEX_SHARE of the time.
 *
 * Which indexes a hand has is asked of the engine, not listed: the hand is
 * graded across the count range and every deviation the engine returns is
 * one that applies. That keeps masking honest -- 16 v 10 with surrender on is
 * a surrender at every count, so its stand index never applies there.
 */

import type { Card, Rank } from '../engine/cards';
import type { Deviation } from '../engine/deviations';
import { indexSetFor } from '../engine/deviations';
import { correctPlay } from '../engine/strategy';
import type { Advice, PlayContext } from '../engine/strategy';
import type { StrategyRules } from '../engine/ruleset';

/** The counts a With-count card can show. */
export const TC_MIN = -6;
export const TC_MAX = 8;
/** The plain range, for a hand with no reachable index (or the other coin). */
export const PLAIN_MIN = -3;
export const PLAIN_MAX = 5;
/** How often a hand with an index is dealt at or past it. */
export const INDEX_SHARE = 0.5;

/** The deviations the engine applies to this hand somewhere in the range. */
export function reachableIndexes(cards: Card[], up: Rank, ctx: PlayContext, rules: StrategyRules): Deviation[] {
  const ids = new Set<string>();
  for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
    const id = correctPlay(cards, up, tc, ctx, rules).deviationId;
    if (id) ids.add(id);
  }
  return indexSetFor(rules).filter((d) => ids.has(d.id));
}

const intIn = (rng: () => number, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
const clamp = (tc: number) => Math.max(TC_MIN, Math.min(TC_MAX, tc));

/** A seeded true count for this hand (see the module note). */
export function drawCountTc(
  cards: Card[],
  up: Rank,
  ctx: PlayContext,
  rules: StrategyRules,
  rng: () => number,
): number {
  const indexes = reachableIndexes(cards, up, ctx, rules);
  if (indexes.length > 0 && rng() < INDEX_SHARE) {
    const dev = indexes[Math.floor(rng() * indexes.length)]!;
    const past = intIn(rng, 0, 2);
    return clamp(dev.dir === 'gte' ? dev.threshold + past : dev.threshold - past);
  }
  return intIn(rng, PLAIN_MIN, PLAIN_MAX);
}

/** The result strip's line for a With-count card: which index applied. */
export function indexLine(advice: Pick<Advice, 'deviationId' | 'reason'>, rules: StrategyRules): string {
  if (!advice.deviationId) return 'No index here';
  const dev = indexSetFor(rules).find((d) => d.id === advice.deviationId);
  return `Index: ${dev?.label ?? advice.reason}`;
}
