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
import { basicPlay, correctPlay } from '../engine/strategy';
import type { Advice, PlayContext } from '../engine/strategy';
import type { StrategyRules } from '../engine/ruleset';
import { redundantForChart } from './deviationQuiz';
import { indexPlayAt } from './indexDisplay';

/** The counts a With-count card can show. */
export const TC_MIN = -6;
export const TC_MAX = 8;
/** The plain range, for a hand with no reachable index (or the other coin). */
export const PLAIN_MIN = -3;
export const PLAIN_MAX = 5;
/** How often a hand with an index is dealt at or past it. */
export const INDEX_SHARE = 0.5;
/**
 * C19 (audit 2026-10-29): how often a hand with an index is dealt one or two
 * counts SHORT of it, where the chart play is still right and deviating early
 * is the classic error. Without this band "one short" came up only from the
 * uniform draw: about 5.5% of the hand's cards against 22% at the index.
 */
export const NEAR_SHARE = 0.2;

/**
 * The play for a With-count card: `correctPlay`, except that an index the
 * profile's own basic chart already plays is not an index.
 *
 * Wave A review (s08, carried into Flashcards): the index set is the 6-deck
 * one, and on 2 decks basic already doubles 9 v 2 and 11 v A. The engine still
 * tags the double past +1 with the index id, so a With-count card graded it as
 * an index hit -- and reviewed it in the quiz deck under an index the quiz no
 * longer asks (deviationQuiz.ts redundantForChart, the one rule for both). The
 * PLAY never changes here: only when the chart's own play is the same action
 * is the advice swapped for the chart's, with no index id.
 */
export function withCountAdvice(cards: Card[], up: Rank, tc: number, ctx: PlayContext, rules: StrategyRules): Advice {
  const advice = correctPlay(cards, up, tc, ctx, rules);
  if (!advice.deviationId) return advice;
  const dev = indexSetFor(rules).find((d) => d.id === advice.deviationId);
  if (!dev || !redundantForChart(dev, rules)) return advice;
  const basic = basicPlay(cards, up, ctx, rules);
  return basic.action === advice.action ? basic : advice;
}

/** Index ids `advise` returns for this hand somewhere in the range. */
function indexIdsInRange(
  advise: (tc: number) => Pick<Advice, 'deviationId'>,
): Set<string> {
  const ids = new Set<string>();
  for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
    const id = advise(tc).deviationId;
    if (id) ids.add(id);
  }
  return ids;
}

/** The deviations the engine applies to this hand somewhere in the range. */
export function reachableIndexes(cards: Card[], up: Rank, ctx: PlayContext, rules: StrategyRules): Deviation[] {
  const ids = indexIdsInRange((tc) => withCountAdvice(cards, up, tc, ctx, rules));
  return indexSetFor(rules).filter((d) => ids.has(d.id));
}

/** Indexes the engine carries for this hand that the chart already plays. */
function chartPlayedIndexes(cards: Card[], up: Rank, ctx: PlayContext, rules: StrategyRules): Deviation[] {
  const raw = indexIdsInRange((tc) => correctPlay(cards, up, tc, ctx, rules));
  const kept = new Set(reachableIndexes(cards, up, ctx, rules).map((d) => d.id));
  return indexSetFor(rules).filter((d) => raw.has(d.id) && !kept.has(d.id));
}

const PLAYS: Record<Deviation['action'], string> = {
  hit: 'hits',
  stand: 'stands',
  double: 'doubles',
  split: 'splits',
  surrender: 'surrenders',
  'take-insurance': 'takes insurance on',
};

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
  const branch = indexes.length > 0 ? rng() : 1;
  if (branch < INDEX_SHARE + NEAR_SHARE) {
    const dev = indexes[Math.floor(rng() * indexes.length)]!;
    // At or 1-2 past the index; or (C19) 1-2 short of it.
    const past = branch < INDEX_SHARE ? intIn(rng, 0, 2) : -intIn(rng, 1, 2);
    return clamp(dev.dir === 'gte' ? dev.threshold + past : dev.threshold - past);
  }
  return intIn(rng, PLAIN_MIN, PLAIN_MAX);
}

/**
 * E1 (W2-11): the counts at which a Mixed basic-strategy item may be shown --
 * ones where the hand is still played by the chart.
 *
 * Two rule sets, because Mixed has two: `gradeRules` grades the flashcard
 * (the profile's own), and `rules` is the index set the learner is drilling
 * (with the opted-in Fab 4 and BJA extras, as the quiz half asks). Every
 * count offered is plain under `gradeRules` -- no index, the chart's play --
 * so grading and stats routing (F4, R9) are exactly a basic answer's. Under
 * `rules` the play must be the chart's too, or the two halves of one session
 * would teach different plays for the same hand and count.
 *
 * Counts where no index fires at all come first. A few cells have none: with
 * the Fab 4 on, 15 v 10 is a surrender from 0 up and a hit below it, so every
 * count either carries the index or leaves the chart. There the counts where
 * the index agrees with the chart are used (15 v 10 at 0 and up: surrender,
 * both ways). The plain range first; the whole card range only if it has none.
 */
export function plainCounts(
  cards: Card[],
  up: Rank,
  ctx: PlayContext,
  rules: StrategyRules,
  gradeRules: StrategyRules = rules,
): number[] {
  const chart = basicPlay(cards, up, ctx, rules).action;
  const graded = (tc: number) => {
    const advice = withCountAdvice(cards, up, tc, ctx, gradeRules);
    return !advice.deviationId && advice.action === chart;
  };
  const noIndex = (tc: number) => {
    const advice = withCountAdvice(cards, up, tc, ctx, rules);
    return !advice.deviationId && advice.action === chart;
  };
  const agrees = (tc: number) => withCountAdvice(cards, up, tc, ctx, rules).action === chart;
  for (const [lo, hi] of [[PLAIN_MIN, PLAIN_MAX], [TC_MIN, TC_MAX]] as const) {
    for (const ok of [noIndex, agrees]) {
      const out: number[] = [];
      for (let tc = lo; tc <= hi; tc++) if (graded(tc) && ok(tc)) out.push(tc);
      if (out.length > 0) return out;
    }
  }
  return [];
}

/**
 * E1 (W2-11): a seeded true count for a hand Mixed asks as BASIC STRATEGY.
 *
 * Mixed's flashcards used to show no count while its index items did, so the
 * screen (and the voice) said which kind of question it was before the
 * learner had to decide whether the count mattered -- the one judgment the
 * session exists to train. Every item now shows a count; on a basic-strategy
 * item it is one where the chart's play is the answer (`plainCounts`), so
 * nothing about grading or stats routing moves.
 *
 * Uniform over `plainCounts`. The exhaustive test in mixedFlashCount.test.ts
 * proves every cell has one under every rule set; the 0 is a backstop, never
 * reached.
 */
export function drawPlainTc(
  cards: Card[],
  up: Rank,
  ctx: PlayContext,
  rules: StrategyRules,
  rng: () => number,
  gradeRules: StrategyRules = rules,
): number {
  const counts = plainCounts(cards, up, ctx, rules, gradeRules);
  if (counts.length === 0) return 0;
  return counts[Math.floor(rng() * counts.length)]!;
}

/**
 * The result strip's line for a With-count card: which index applied.
 *
 * Wave A (s03): with the hand given, a cell that HAS an index the count has
 * not reached says so -- "No index here" on 12 v 2 at +0 told a learner the
 * cell had no index while the chart showed a corner mark on it.
 */
export function indexLine(
  advice: Pick<Advice, 'deviationId' | 'reason'>,
  rules: StrategyRules,
  hand?: { cards: Card[]; up: Rank; ctx: PlayContext },
): string {
  if (!advice.deviationId) {
    const near = hand ? reachableIndexes(hand.cards, hand.up, hand.ctx, rules) : [];
    if (near.length > 0) return `Index not reached at this count: ${near.map((d) => d.label).join('; ')}`;
    // Wave A review: the Charts screen still marks 9 v 2 on 2 decks, so say
    // why the card has no index rather than a bare "No index here".
    const played = hand ? chartPlayedIndexes(hand.cards, hand.up, hand.ctx, rules) : [];
    if (played.length === 0) return 'No index here';
    return `No index at these rules: basic already ${played
      .map((d) => `${PLAYS[d.action]} ${d.label.split(':')[0]!.trim()}`)
      .join('; ')}`;
  }
  const dev = indexSetFor(rules).find((d) => d.id === advice.deviationId);
  return `Index: ${dev?.label ?? advice.reason}`;
}

/**
 * Wave A (s03): the index picker's option text -- the hand (and the play, to
 * tell 15 v 10 stand from 15 v 10 surrender) without the threshold. The full
 * label stayed in the closed select above every question, so focused practice
 * on one index printed its answer on screen.
 *
 * H6 (R6): the play is the published one, AT the index (`indexPlayAt`). H17
 * 12 v 6 is stored as "hit at TC ≤ −4" and published as "stand at TC ≥ −3";
 * the picker and the summary chip said "12 v 6 (hit)" beside a label, a
 * Charts row and an Index test that all say stand.
 */
export function indexPickerText(dev: Pick<Deviation, 'id' | 'label' | 'kind' | 'action' | 'dir' | 'above'>): string {
  if (dev.kind === 'insurance') return 'Insurance';
  const hand = dev.label.split(':')[0]!.trim();
  return `${hand} (${indexPlayAt(dev)})`;
}
