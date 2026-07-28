/**
 * R4 (docs/BACKLOG.md, interleaved / mixed-session mode): the ONE shared
 * implementation of the flashcard and deviation-quiz grade paths, extracted
 * out of Drills.tsx so the standalone FlashcardsView / DeviationQuizView AND
 * the mixed-session view all grade through byte-identical code -- same engine
 * graders (classifyAction / buildQuizEvent), same R3 weight updates, same R1
 * latency capture, same GradedEvent written to the same Stats histories.
 *
 * Nothing here touches React: the two grade wrappers are pure aside from the
 * localStorage weight/stats writes they have always performed (loadStats /
 * saveStats via the persist layer, which falls back to an in-memory store in
 * node so this module is directly unit-testable -- see gradeAnswer.test.ts's
 * anti-drift guard). Callers layer their own audio / feedback rendering on
 * top of the returned GradedEvent.
 */

import type { GradedEvent } from '../engine/grade';
import { classifyAction, actionCategory, classifyInsurance } from '../engine/grade';
import type { PlayContext } from '../engine/strategy';
import { correctPlay, basicPlay } from '../engine/strategy';
import type { RuleSet } from '../engine/ruleset';
import type { Action } from '../engine/deviations';
import type { Flashcard } from './flashcards';
import type { QuizItem } from './deviationQuiz';
import { bumpMiss, decayMiss } from './weightedDraw';
import { loadStats, saveStats } from '../store/persist';
import { applyEvents } from '../store/stats';

/* ---------------------------------------------------------------- */
/* Per-drill weight-map persistence (R3).                            */
/* One localStorage key each so a corrupt/absent value in one drill  */
/* can never affect the other; a shared load/save primitive keeps    */
/* both drills' plumbing identical.                                  */
/* ---------------------------------------------------------------- */

export const FLASH_WEIGHTS_KEY = 'bjtrainer.flashweights.v1';
export const QUIZ_WEIGHTS_KEY = 'bjtrainer.quizweights.v1';

function loadWeightMap(key: string): Record<string, number> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, number>;
    return {};
  } catch {
    return {};
  }
}

function saveWeightMap(key: string, weights: Record<string, number>): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(weights));
  } catch {
    // best-effort persistence only
  }
}

export function loadFlashWeights(): Record<string, number> {
  return loadWeightMap(FLASH_WEIGHTS_KEY);
}

export function saveFlashWeights(weights: Record<string, number>): void {
  saveWeightMap(FLASH_WEIGHTS_KEY, weights);
}

export function loadQuizWeights(): Record<string, number> {
  return loadWeightMap(QUIZ_WEIGHTS_KEY);
}

export function saveQuizWeights(weights: Record<string, number>): void {
  saveWeightMap(QUIZ_WEIGHTS_KEY, weights);
}

/* ---------------------------------------------------------------- */
/* Pure event builders (deterministic given their inputs).           */
/* ---------------------------------------------------------------- */

export function cellCategory(cellId: string, correct: Action): 'hard' | 'soft' | 'pairs' | 'surrender' {
  if (correct === 'surrender') return 'surrender';
  if (cellId.startsWith('hard-')) return 'hard';
  if (cellId.startsWith('soft-')) return 'soft';
  return 'pairs';
}

/**
 * Build the GradedEvent + correct action for a flashcard answer. Pure: no
 * weight/stats writes, no audio. `elapsedMs` (R1) is captured by the caller
 * via performance.now() and passed in, so this stays deterministic and the
 * anti-drift unit test can assert byte-identical output.
 */
export function buildFlashcardEvent(
  card: Flashcard,
  taken: Action,
  rules: RuleSet,
  elapsedMs: number,
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
  const withCount = correctPlay(card.cards, card.up, 0, ctx, rules);
  const basicOnly = basicPlay(card.cards, card.up, ctx, rules);
  const { classification, correct } = classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, rules);

  const event: GradedEvent = {
    kind: 'action',
    category: cellCategory(card.cellId, card.correct),
    correct,
    classification,
    taken,
    expected: card.correct,
    reason: card.cellId,
    tc: 0,
    hand: card.cellId,
    elapsedMs,
  };

  return { event, correctAction: withCount.action, correct };
}

/**
 * Build the GradedEvent for a deviation-quiz answer (action or insurance).
 * Pure, deterministic given its inputs. `elapsedMs` is optional and purely
 * additive -- omitting it produces an untimed event, exactly as before R1.
 */
export function buildQuizEvent(item: QuizItem, taken: string, rules: RuleSet, elapsedMs?: number): GradedEvent {
  if (item.cards === null) {
    const take = taken === 'take-insurance';
    const { classification, correct } = classifyInsurance(take, item.tc);
    return {
      kind: 'insurance',
      category: 'insurance',
      correct,
      classification,
      taken: take ? 'take' : 'decline',
      expected: item.correct === 'take-insurance' ? 'take' : 'decline',
      reason: item.label,
      deviationId: item.deviationId,
      tc: item.tc,
      hand: 'dealer A',
      elapsedMs,
    };
  }

  // canSurrender: false must match drawQuizItem's ctx (deviationQuiz.ts) so the
  // grader agrees with item.correct — see the deviation-quiz surrender-masking fix.
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: false };
  const withCount = correctPlay(item.cards, item.up, item.tc, ctx, rules);
  const basicOnly = basicPlay(item.cards, item.up, ctx, rules);
  const { classification, correct } = classifyAction(taken as Action, withCount, basicOnly, item.cards, item.up, item.tc, rules);

  return {
    kind: 'action',
    category: actionCategory(item.cards, item.correct as Action),
    correct,
    classification,
    taken,
    expected: item.correct,
    reason: item.label,
    deviationId: item.deviationId,
    tc: item.tc,
    hand: item.label,
    elapsedMs,
  };
}

/* ---------------------------------------------------------------- */
/* Full grade+persist wrappers -- THE shared grade path.             */
/* Both the standalone views and the mixed-session view call these   */
/* exact functions, so the two contexts cannot drift: R3 weights and */
/* the Stats write are performed here, once.                         */
/* ---------------------------------------------------------------- */

export interface FlashGradeResult {
  event: GradedEvent;
  correctAction: Action;
  /** The weight map after this answer's R3 bump/decay. Callers hold this in a
   * ref so the NEXT draw's weighting reflects it. */
  nextWeights: Record<string, number>;
}

/**
 * Grade a flashcard answer end-to-end: build the event, apply the R3 decay
 * (correct) / bump (miss) to the cell's weight and persist it, and write the
 * event into Stats. Returns the event, the correct action (for feedback), and
 * the updated weight map.
 */
export function gradeFlashcardAnswer(
  card: Flashcard,
  taken: Action,
  rules: RuleSet,
  elapsedMs: number,
  weights: Record<string, number>,
): FlashGradeResult {
  const { event, correctAction, correct } = buildFlashcardEvent(card, taken, rules, elapsedMs);

  // R3: a miss grows this cell's weight; a correct answer decays it back
  // toward baseline (floor 0) instead of leaving it frozen at a past peak.
  const nextWeights = correct ? decayMiss(weights, card.cellId) : bumpMiss(weights, card.cellId);
  saveFlashWeights(nextWeights);

  saveStats(applyEvents(loadStats(), [event]));

  return { event, correctAction, nextWeights };
}

export interface QuizGradeResult {
  event: GradedEvent;
  /** The weight map after this answer's R3 bump/decay (unchanged for a
   * distractor, which carries no deviationId). */
  nextWeights: Record<string, number>;
}

/**
 * Grade a deviation-quiz answer end-to-end: build the event, apply the R3
 * bump/decay to the tested index's weight (real items only -- distractors
 * never carry a deviationId, matching stats.ts's perIndex exclusion) and
 * persist it, and write the event into Stats.
 */
export function gradeQuizAnswer(
  item: QuizItem,
  taken: string,
  rules: RuleSet,
  elapsedMs: number,
  weights: Record<string, number>,
): QuizGradeResult {
  const event = buildQuizEvent(item, taken, rules, elapsedMs);

  // R3: symmetric to flashcards -- only REAL items carry a deviationId, so a
  // distractor never perturbs an index's weight.
  let nextWeights = weights;
  if (item.deviationId) {
    nextWeights = event.correct
      ? decayMiss(weights, item.deviationId)
      : bumpMiss(weights, item.deviationId);
    saveQuizWeights(nextWeights);
  }

  saveStats(applyEvents(loadStats(), [event]));

  return { event, nextWeights };
}
