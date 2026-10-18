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
import type { Card } from '../engine/cards';
import type { StrategyRules } from '../engine/ruleset';
import { indexSetFor } from '../engine/deviations';
import { narrateQuizPrompt } from '../audio/narrate';
import { drawFlashcard, flashCtx } from './flashcards';
import type { Flashcard, FlashOptions } from './flashcards';
import type { SrDeck } from './spacedRepetition';
import { drawPlainTc, reachableIndexes, withCountAdvice } from './withCount';
import { distractorLabel } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';

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

/* ---------------------------------------------------------------- */
/* E1 (W2-11): every Mixed item shows a true count.                   */
/* ---------------------------------------------------------------- */

/** Salt for the count's own rng, so it is independent of the draw's. */
const MIXED_TC_SALT = 0x5bd1e995;

/** The arguments `drawFlashcard` takes, by name. */
export interface MixedFlashDraw {
  scopes: Parameters<typeof drawFlashcard>[0];
  srDeck: SrDeck;
  now: number;
  seed: number;
  /** The rules the card is graded under (the profile's own). */
  rules: StrategyRules;
  /**
   * The index set the learner is drilling: the profile's with its opted-in
   * Fab 4 and BJA extras (`strategyRulesFor`), the set the quiz half asks.
   * The count must leave the chart's play the answer under these as well as
   * under `rules` (withCount.ts plainCounts).
   */
  countRules: StrategyRules;
  byConfusability: boolean;
  previousCellId: string | null;
  deckWeights: ReadonlyMap<string, number> | null;
  options: FlashOptions;
}

/**
 * A Mixed basic-strategy item: the flashcard `drawFlashcard` deals, at a true
 * count where no index applies to it (`drawPlainTc`), graded at that count.
 * The play is the chart's either way; the count is there so that a flashcard
 * and an index item look and sound alike until the learner decides.
 */
export function drawMixedFlashcard(d: MixedFlashDraw): Flashcard {
  const card = drawFlashcard(
    d.scopes,
    d.srDeck,
    d.now,
    d.seed,
    d.rules,
    d.byConfusability,
    d.previousCellId,
    d.deckWeights,
    // The count is chosen here, never the With-count one biased toward an index.
    { ...d.options, withCount: false },
  );
  const ctx = flashCtx(card);
  const tc = drawPlainTc(card.cards, card.up, ctx, d.countRules, mulberry32((d.seed ^ MIXED_TC_SALT) >>> 0), d.rules);
  return { ...card, tc, correct: withCountAdvice(card.cards, card.up, tc, ctx, d.rules).action };
}

/** A Mixed item: a basic-strategy flashcard, or a deviation-quiz item. */
export type MixedItem = { type: 'flash'; card: Flashcard } | { type: 'quiz'; item: QuizItem };

/**
 * The spoken prompt for either kind of item: the quiz prompt builder, count
 * included, so the voice no more says which kind it is than the screen does.
 * A Mixed flashcard always carries its count (`drawMixedFlashcard`). The cast
 * is for a fallback deal's third card, which `narrateQuizPrompt`'s hand phrase
 * reads like any other hand.
 */
export function mixedPrompt(c: MixedItem): string {
  if (c.type === 'quiz') return narrateQuizPrompt(c.item.cards, c.item.up, c.item.tc);
  return narrateQuizPrompt(c.card.cards as [Card, Card], c.card.up, c.card.tc ?? 0);
}

/**
 * The label a Mixed flashcard shows after the answer, in the quiz's own
 * shape. Almost always it IS a distractor -- a hand at a count where no index
 * applies -- so it reads like one, "near" the index its cell carries if it
 * has one. On the few cells where every count carries an index of the
 * learner's set (plainCounts), the count is one where that index plays the
 * chart's move, and the label is the index's own, as a quiz item's is.
 */
export function mixedFlashLabel(card: Flashcard, countRules: StrategyRules): string {
  const ctx = flashCtx(card);
  const applied = withCountAdvice(card.cards, card.up, card.tc ?? 0, ctx, countRules).deviationId;
  const dev = applied ? indexSetFor(countRules).find((d) => d.id === applied) : undefined;
  if (dev) return dev.label;
  return distractorLabel(reachableIndexes(card.cards, card.up, ctx, countRules)[0]);
}
