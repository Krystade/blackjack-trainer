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

import type { GradedEvent, EventSource, MistakeClass } from '../engine/grade';
import { classifyAction, actionCategory, classifyInsurance } from '../engine/grade';
import { actionEvs, evCostBetween } from '../engine/handEv';
import type { Card, Rank } from '../engine/cards';
import type { Advice } from '../engine/strategy';
import type { EvAction } from '../engine/handEv';
import type { PlayContext } from '../engine/strategy';
import { correctPlay, basicPlay } from '../engine/strategy';
import type { RuleSet } from '../engine/ruleset';
import type { Action } from '../engine/deviations';
import type { Flashcard } from './flashcards';
import type { QuizItem } from './deviationQuiz';
import { reviewCard, isGapReview, SCREEN_CHANNEL } from './spacedRepetition';
import type { AnswerChannel } from './spacedRepetition';
import type { SrCard, SrDeck } from './spacedRepetition';
import { loadStats, saveStats } from '../store/persist';
import type { Stats } from '../store/types';
import { applyEvents } from '../store/stats';

type RetentionRow = Stats['retention']['history'][number];

/* ---------------------------------------------------------------- */
/* Per-drill SR-deck persistence (RV4).                              */
/* One localStorage key each so a corrupt/absent value in one drill  */
/* can never affect the other; a shared load/save primitive keeps    */
/* both drills' plumbing identical. FRESH START (operator-approved):  */
/* the old R3 miss-count keys (bjtrainer.flashweights/quizweights.v1) */
/* are ABANDONED, not migrated -- a miss count carried no time data,  */
/* so a clean SR start costs at most one session of re-warming.       */
/* ---------------------------------------------------------------- */

export const FLASH_SR_KEY = 'bjtrainer.flashsr.v1';
export const QUIZ_SR_KEY = 'bjtrainer.quizsr.v1';

function loadSrDeck(key: string): SrDeck {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null) return parsed as SrDeck;
    return {};
  } catch {
    return {};
  }
}

function saveSrDeck(key: string, deck: SrDeck): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    window.localStorage.setItem(key, JSON.stringify(deck));
  } catch {
    // best-effort persistence only
  }
}

export function loadFlashSr(): SrDeck {
  return loadSrDeck(FLASH_SR_KEY);
}

export function saveFlashSr(deck: SrDeck): void {
  saveSrDeck(FLASH_SR_KEY, deck);
}

export function loadQuizSr(): SrDeck {
  return loadSrDeck(QUIZ_SR_KEY);
}

export function saveQuizSr(deck: SrDeck): void {
  saveSrDeck(QUIZ_SR_KEY, deck);
}

/** Build a retention-history row for a gap review (a learned item recalled
 * after its interval elapsed). `date` is derived from the caller's `now` so it
 * agrees with the SR schedule. */
function retentionRow(key: string, prev: SrCard, correct: boolean, now: number): RetentionRow {
  return { date: new Date(now).toISOString(), key, box: prev.box, gapMs: now - prev.lastSeenAt, correct };
}

/** Persist a graded event and, when the review was a gap review, its retention
 * row -- one load/save so the two writes can't race. */
export function persistGrade(event: GradedEvent, retention: RetentionRow | null): void {
  let stats = applyEvents(loadStats(), [event]);
  if (retention) {
    stats = { ...stats, retention: { history: [...stats.retention.history, retention] } };
  }
  saveStats(stats);
}

/* ---------------------------------------------------------------- */
/* Pure event builders (deterministic given their inputs).           */
/* ---------------------------------------------------------------- */

/**
 * What the shot clock submits when nobody answered (R1, drills/shotClock.ts).
 *
 * A sentinel rather than a sixth `Action`, and deliberately: `Action` is the set
 * of plays that exist at a table, and every chart lookup, legality gate and
 * deviation entry in the engine is typed by it. Widening it to carry "no answer"
 * would push a non-play through all of that and make every exhaustive switch a
 * lie. It rides in the `taken` field, which `GradedEvent` already types as a
 * plain string for exactly this kind of non-action ("take-insurance" is the
 * other).
 */
export const TIMEOUT_ANSWER = 'timeout';

/** An answer a hand drill can grade: a real play, or the clock running out. */
export type DrillAnswer = Action | typeof TIMEOUT_ANSWER;

export function cellCategory(cellId: string, correct: Action): 'hard' | 'soft' | 'pairs' | 'surrender' {
  if (correct === 'surrender') return 'surrender';
  if (cellId.startsWith('hard-')) return 'hard';
  if (cellId.startsWith('soft-')) return 'soft';
  return 'pairs';
}


/**
 * What a wrong hand decision cost, in units -- or `undefined` when pricing it
 * would be dishonest.
 *
 * Shared by both builders below so flashcards and the quiz cannot disagree about
 * when a cost exists. The abstentions are listed in `GradedEvent.evCost`'s own
 * doc; the gate here is simply that ONLY a `basic-error` gets a number, which is
 * exactly the set of wrong answers where no index is involved on either side.
 *
 * That single check covers all of them. `correct` is not a basic-error, so a
 * correct answer is unpriced. `missed-deviation` and `wrong-anyway` mean the
 * count called for an index, and the EV engine is count-blind by construction --
 * it would price the index play as the worse one and report a missed deviation as
 * free. `phantom-deviation` is the mirror: the player deviated below the
 * threshold, and a count-blind engine prices that at neutral-count weights, which
 * overstates what it actually cost at the count they were at.
 */
function priceMistake(
  cards: Card[],
  up: Rank,
  ctx: PlayContext,
  rules: RuleSet,
  expected: Advice,
  taken: string,
  classification: MistakeClass,
): number | undefined {
  if (classification !== 'basic-error') return undefined;
  const evs = actionEvs(cards, up, ctx, rules);
  const cost = evCostBetween(evs, expected.action as EvAction, taken as EvAction);
  return cost ?? undefined;
}

/**
 * Build the GradedEvent + correct action for a flashcard answer. Pure: no
 * weight/stats writes, no audio. `elapsedMs` (R1) is captured by the caller
 * via performance.now() and passed in, so this stays deterministic and the
 * anti-drift unit test can assert byte-identical output.
 */
export function buildFlashcardEvent(
  card: Flashcard,
  taken: DrillAnswer,
  rules: RuleSet,
  elapsedMs: number,
  source: EventSource = 'flashcard',
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const ctx: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };
  const withCount = correctPlay(card.cards, card.up, 0, ctx, rules);
  const basicOnly = basicPlay(card.cards, card.up, ctx, rules);
  // A timeout never reaches classifyAction: that function asks which of the
  // five plays was chosen, and the answer here is none of them. Routed through
  // it with any stand-in action it would come back as that action's mistake
  // class -- so the taxonomy would record a play the learner never made.
  const { classification, correct } =
    taken === TIMEOUT_ANSWER
      ? ({ classification: 'timeout', correct: false } as const)
      : classifyAction(taken, withCount, basicOnly, card.cards, card.up, 0, rules);

  const event: GradedEvent = {
    kind: 'action',
    source,
    category: cellCategory(card.cellId, card.correct),
    correct,
    classification,
    taken,
    expected: card.correct,
    // A3: the strategy engine's own prose, not the cell id. `withCount.reason`
    // ("Basic stand vs dealer 9") was already computed two lines above and
    // thrown away, leaving the correction panel and the SPOKEN correction
    // both reading out "soft-20-v-A" where an explanation belongs. The cell
    // id is still carried as `hand`, which is what it actually is.
    reason: withCount.reason,
    tc: 0,
    hand: card.cellId,
    elapsedMs,
    evCost: priceMistake(card.cards, card.up, ctx, rules, withCount, taken, classification),
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
    // A timeout is not a decline, and classifyInsurance cannot tell them apart:
    // it takes a boolean, so "no answer" collapses into "said no" -- which at a
    // count above the index reads as a MISSED DEVIATION, crediting the learner
    // with a decision they never made. The timeout branch therefore comes first
    // here, exactly as it does on the action path below.
    const timedOut = taken === TIMEOUT_ANSWER;
    const { classification, correct } = timedOut
      ? ({ classification: 'timeout', correct: false } as const)
      : classifyInsurance(take, item.tc, rules);
    return {
      kind: 'insurance',
      source: 'quiz',
      category: 'insurance',
      correct,
      classification,
      taken: timedOut ? TIMEOUT_ANSWER : take ? 'take' : 'decline',
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
  // See buildFlashcardEvent: a shot-clock timeout is not one of the five plays.
  const { classification, correct } =
    taken === TIMEOUT_ANSWER
      ? ({ classification: 'timeout', correct: false } as const)
      : classifyAction(taken as Action, withCount, basicOnly, item.cards, item.up, item.tc, rules);

  return {
    kind: 'action',
    source: 'quiz',
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
    evCost: priceMistake(item.cards, item.up, ctx, rules, withCount, taken, classification),
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
  /** The SR deck after this answer's Leitner review. Callers hold this in a ref
   * so the NEXT draw's scheduling reflects it. */
  nextDeck: SrDeck;
}

/**
 * Grade a flashcard answer end-to-end: build the event, apply the RV4 Leitner
 * review to the cell's SR schedule and persist it, write the event into Stats,
 * and — when this was a gap review (a learned cell recalled after its interval)
 * — record a retention row. `now` is wall-clock epoch ms (Date.now() from the
 * component), NOT R1's `elapsedMs` (a duration) — SR schedules across sessions.
 */
export function gradeFlashcardAnswer(
  card: Flashcard,
  taken: DrillAnswer,
  rules: RuleSet,
  elapsedMs: number,
  deck: SrDeck,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
): FlashGradeResult {
  const { event, correctAction, correct } = buildFlashcardEvent(card, taken, rules, elapsedMs);

  // RV4: classify the gap review against the cell's PRE-review state, then
  // advance its Leitner schedule.
  const prev = deck[card.cellId];
  const retention = prev && isGapReview(prev, now) ? retentionRow(card.cellId, prev, correct, now) : null;
  const nextDeck = { ...deck, [card.cellId]: reviewCard(prev, correct, now, { elapsedMs, channel }) };
  saveFlashSr(nextDeck);

  persistGrade(event, retention);

  return { event, correctAction, nextDeck };
}

/**
 * Grade a Mastery Challenge answer. Unlike gradeFlashcardAnswer, this does
 * NOT touch the Flashcards spaced-repetition deck (D6, plan doc): a mastery
 * run walks a fixed shuffled deck exactly once per attempt, it is not an
 * SR-scheduled draw, and treating every correct mastery answer as a Flashcards
 * SR review would distort that schedule's due-ness weighting for a mode the
 * learner wasn't using. No retention row either -- mastery events are never
 * gap-reviews.
 */
export function gradeMasteryAnswer(
  cell: Flashcard,
  taken: DrillAnswer,
  rules: RuleSet,
  elapsedMs: number,
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  const result = buildFlashcardEvent(cell, taken, rules, elapsedMs, 'mastery');
  persistGrade(result.event, null);
  return result;
}

export interface QuizGradeResult {
  event: GradedEvent;
  /** The SR deck after this answer's Leitner review (unchanged for a distractor,
   * which carries no deviationId and is never scheduled). */
  nextDeck: SrDeck;
}

/**
 * Grade a deviation-quiz answer end-to-end: build the event, apply the RV4
 * Leitner review to the tested index's SR schedule (real items only --
 * distractors never carry a deviationId, matching stats.ts's perIndex
 * exclusion), record a retention row on a gap review, and write the event into
 * Stats. `now` is wall-clock epoch ms (see gradeFlashcardAnswer).
 */
export function gradeQuizAnswer(
  item: QuizItem,
  taken: string,
  rules: RuleSet,
  elapsedMs: number,
  deck: SrDeck,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
): QuizGradeResult {
  const event = buildQuizEvent(item, taken, rules, elapsedMs);

  let nextDeck = deck;
  let retention: RetentionRow | null = null;
  if (item.deviationId) {
    const prev = deck[item.deviationId];
    retention = prev && isGapReview(prev, now) ? retentionRow(item.deviationId, prev, event.correct, now) : null;
    nextDeck = {
      ...deck,
      [item.deviationId]: reviewCard(prev, event.correct, now, { elapsedMs, channel }),
    };
    saveQuizSr(nextDeck);
  }

  persistGrade(event, retention);

  return { event, nextDeck };
}
