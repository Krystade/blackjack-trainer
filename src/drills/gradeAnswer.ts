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

import { priceMistake as enginePriceMistake } from '../engine/mistakeCost';
import type { GradedEvent, EventSource, MistakeClass } from '../engine/grade';
import { classifyAction, actionCategory, classifyInsurance, phantomDeviationId } from '../engine/grade';
import type { Card, Rank } from '../engine/cards';
import type { PlayContext } from '../engine/strategy';
import { correctPlay, basicPlay } from '../engine/strategy';
import type { StrategyRules } from '../engine/ruleset';
import type { Action, DeviationId } from '../engine/deviations';
import type { Flashcard } from './flashcards';
import { flashCtx } from './flashcards';
import type { QuizItem } from './deviationQuiz';
import { quizCtxFor } from './deviationQuiz';
import type { IndexTestItem } from './indexTest';
import { buildIndexTestEvent } from './indexTest';
import { withCountAdvice } from './withCount';
import { reviewCard, isGapReview, SCREEN_CHANNEL } from './spacedRepetition';
import { trackedElapsedMs } from './idleAnswer';
import type { AnswerChannel } from './spacedRepetition';
import type { SrCard, SrDeck } from './spacedRepetition';
import { loadStats, saveStats } from '../store/persist';
import type { Stats } from '../store/types';
import { applyEvents, tallyCellIdFor } from '../store/stats';
import type { CellTally } from '../store/cellStats';

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
 * row -- one load/save so the two writes can't race.
 *
 * Returns the event's B3 chart cell as it was BEFORE this answer (null when
 * the cell had no tally yet), which "Wrong tap" hands back to the undo so the
 * cell's date is restored exactly, not just its count. */
export function persistGrade(event: GradedEvent, retention: RetentionRow | null): CellTally | null {
  const before = loadStats();
  const cellId = tallyCellIdFor(event);
  const cellBefore = cellId === null ? null : (before.cellStats?.[cellId] ?? null);
  let stats = applyEvents(before, [event]);
  if (retention) {
    stats = { ...stats, retention: { history: [...stats.retention.history, retention] } };
  }
  saveStats(stats);
  return cellBefore;
}

/** A hand in table notation, "9,7 v 10" -- the form Play's events carry. */
function tableHand(cards: Card[], up: Rank): string {
  return `${cards.map((c) => c.rank).join(',')} v ${up}`;
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

/**
 * What an eyes-free self-check submits.
 *
 * Same argument as `TIMEOUT_ANSWER`, one step further: in a car a flashcard
 * answer cannot be one of five buttons, because there are two wheel buttons
 * and no screen being looked at. So the drill says the hand, says the right
 * play, and asks whether you had it -- and the answer to that is not a play.
 *
 * "I had it" is the honest word for a correct answer with no action attached;
 * "I missed it" is a retention failure with no action attached. Both ride in
 * `taken`, which `GradedEvent` already types as a plain string for exactly
 * this.
 */
export const SELF_REPORT_HAD = 'self-report-had';
export const SELF_REPORT_MISSED = 'self-report-missed';

/**
 * An answer a hand drill can grade: a real play, the clock running out, or a
 * self-report from a channel that cannot name a play.
 */
export type DrillAnswer =
  | Action
  | typeof TIMEOUT_ANSWER
  | typeof SELF_REPORT_HAD
  | typeof SELF_REPORT_MISSED;

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
// The engine owns the one implementation (engine/mistakeCost.ts), so Play
// and the drills price a basic error identically (#25).
const priceMistake = enginePriceMistake;

/**
 * #30: the event's `elapsedMs` field, or no field at all for an answer slower
 * than IDLE_ANSWER_MS (the answer is still graded; only its timing is
 * dropped, so latency stats skip it). Shot-clock timeouts keep theirs.
 */
function elapsedField(elapsedMs: number | undefined, taken: string): { elapsedMs?: number } {
  const tracked = trackedElapsedMs(elapsedMs, taken === TIMEOUT_ANSWER);
  return tracked === undefined ? {} : { elapsedMs: tracked };
}

/**
 * Wave A (s01): a card shown with no count cannot be a phantom DEVIATION.
 * Standing 7,5 v 3 on a plain flashcard is a basic-strategy error; calling it
 * "Phantom deviation" told a beginner who has never heard of indexes that they
 * had deviated. The With-count cards, Mixed's quiz half, Play and the quiz keep
 * the class, because there a count was on the table.
 */
function noCountShown(
  verdict: { classification: GradedEvent['classification']; correct: boolean },
  card: Pick<Flashcard, 'tc'>,
): { classification: GradedEvent['classification']; correct: boolean } {
  if (card.tc === undefined && verdict.classification === 'phantom-deviation') {
    return { ...verdict, classification: 'basic-error' };
  }
  return verdict;
}

/** The deviationId a With-count answer is filed under, if any (#53, R9). */
function indexFieldFor(
  hit: DeviationId | undefined,
  classification: MistakeClass,
  taken: DrillAnswer,
  card: Flashcard,
  rules: StrategyRules,
): { deviationId?: DeviationId; indexOnly?: true } {
  if (hit) return { deviationId: hit, indexOnly: true };
  // Only classifyAction says phantom, and only for one of the five plays.
  if (classification !== 'phantom-deviation') return {};
  const id = phantomDeviationId(taken as Action, card.cards, card.up, rules);
  return id === null ? {} : { deviationId: id, indexOnly: true };
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
  rules: StrategyRules,
  elapsedMs: number,
  source: EventSource = 'flashcard',
): { event: GradedEvent; correctAction: Action; correct: boolean } {
  // #27: a fallback hand is graded with double/surrender gone; #53: a
  // "With count" card at the count it showed. Both absent = as before.
  const ctx: PlayContext = flashCtx(card);
  const tc = card.tc ?? 0;
  // Wave A review: an index the profile's chart already plays is not one
  // (withCount.ts) -- same play, no index id, so no index review.
  const withCount = withCountAdvice(card.cards, card.up, tc, ctx, rules);
  const basicOnly = basicPlay(card.cards, card.up, ctx, rules);
  // A timeout never reaches classifyAction, and neither does a self-report:
  // that function asks which of the five plays was chosen, and the answer in
  // both cases is none of them. Routed through it with any stand-in action,
  // the taxonomy would record a play the learner never made.
  const { classification, correct } =
    taken === TIMEOUT_ANSWER
      ? ({ classification: 'timeout', correct: false } as const)
      : taken === SELF_REPORT_HAD
        ? ({ classification: 'correct', correct: true } as const)
        : taken === SELF_REPORT_MISSED
          ? ({ classification: 'self-report', correct: false } as const)
          : noCountShown(classifyAction(taken, withCount, basicOnly, card.cards, card.up, tc, rules), card);

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
    tc,
    // #53: a With-count card that hit an index counts toward that index.
    // R9 (#8): so does a phantom deviation -- the play of an index taken below
    // it is index knowledge, filed under that index like the quiz files it.
    ...(card.tc !== undefined ? indexFieldFor(withCount.deviationId, classification, taken, card, rules) : {}),
    hand: card.cellId,
    // #30: omitted, not zeroed, for an idle answer -- see idleAnswer.ts.
    ...elapsedField(elapsedMs, taken),
    evCost: priceMistake(card.cards, card.up, ctx, rules, withCount, taken, classification),
  };

  return { event, correctAction: withCount.action, correct };
}

/**
 * Build the GradedEvent for a deviation-quiz answer (action or insurance).
 * Pure, deterministic given its inputs. `elapsedMs` is optional and purely
 * additive -- omitting it produces an untimed event, exactly as before R1.
 */
export function buildQuizEvent(item: QuizItem, taken: string, rules: StrategyRules, elapsedMs?: number): GradedEvent {
  if (item.cards === null) {
    const take = taken === 'take-insurance';
    // A timeout is not a decline, and classifyInsurance cannot tell them apart:
    // it takes a boolean, so "no answer" collapses into "said no" -- which at a
    // count above the index reads as a MISSED DEVIATION, crediting the learner
    // with a decision they never made. The timeout branch therefore comes first
    // here, exactly as it does on the action path below.
    const timedOut = taken === TIMEOUT_ANSWER;
    // A SELF-REPORT is not a decision either -- see the action path below.
    // On an insurance item it is the same claim about the same kind of
    // memory, and `classifyInsurance` takes a boolean, so routing one
    // through it would record "declined" for a learner who said they had it.
    const { classification, correct } = timedOut
      ? ({ classification: 'timeout', correct: false } as const)
      : taken === SELF_REPORT_HAD
        ? ({ classification: 'correct', correct: true } as const)
        : taken === SELF_REPORT_MISSED
          ? ({ classification: 'self-report', correct: false } as const)
          : classifyInsurance(take, item.tc, rules);
    return {
      kind: 'insurance',
      source: 'quiz',
      category: 'insurance',
      correct,
      classification,
      taken:
      timedOut || taken === SELF_REPORT_HAD || taken === SELF_REPORT_MISSED
        ? taken
        : take
          ? 'take'
          : 'decline',
      expected: item.correct === 'take-insurance' ? 'take' : 'decline',
      reason: item.label,
      deviationId: item.deviationId,
      tc: item.tc,
      hand: 'dealer A',
      ...elapsedField(elapsedMs, taken),
    };
  }

  /*
   * THE CTX THE ITEM WAS DRAWN UNDER, asked for rather than restated.
   *
   * This was a hardcoded `canSurrender: false`, with a comment saying it
   * matched the draw. It did, until the draw learned `ctxFor(entry)` for the
   * Fab 4 and this did not: a surrender index is drawn with surrender
   * available and `item.correct` is `surrender`, while the expectation
   * computed here came from a world where surrender does not exist. The
   * learner answered surrender, was marked wrong, and read "expected:
   * surrender" on the card that marked them -- at every true count, in both
   * directions, for the whole feature.
   */
  const ctx: PlayContext = quizCtxFor(item, rules);
  const withCount = correctPlay(item.cards, item.up, item.tc, ctx, rules);
  const basicOnly = basicPlay(item.cards, item.up, ctx, rules);
  // See buildFlashcardEvent: a shot-clock timeout is not one of the five plays.
  /*
   * ...AND A SELF-REPORT IS NOT ONE OF THE FIVE PLAYS.
   *
   * `buildFlashcardEvent` has said so since the wheel's self-check shipped;
   * this function sent everything that was not a timeout into
   * `classifyAction`, which asks WHICH play was chosen. A self-report cast
   * to an `Action` graded as a basic error and was written into Stats and
   * the review deck as a play nobody made -- which is also why the quiz
   * could not offer the self-check at all, and so had no wheel.
   */
  const { classification, correct } =
    taken === TIMEOUT_ANSWER
      ? ({ classification: 'timeout', correct: false } as const)
      : taken === SELF_REPORT_HAD
        ? ({ classification: 'correct', correct: true } as const)
        : taken === SELF_REPORT_MISSED
          ? ({ classification: 'self-report', correct: false } as const)
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
    // B3: the dealt cards, as Play writes them, so the answer is tallied
    // against its chart cell and its priced mistakes group with Play's. The
    // index label is already carried as `reason`.
    hand: tableHand(item.cards, item.up),
    ...elapsedField(elapsedMs, taken),
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
  /** B3: the answered cell's tally before this answer, for "Wrong tap". */
  cellBefore: CellTally | null;
  /**
   * Wave A F4b: set when the card's expected play came from an index. The
   * answer was reviewed in the QUIZ deck under that index, and the flash cell's
   * schedule was left alone; `prev` is the index's card before the review, for
   * "Wrong tap".
   */
  indexReview?: { key: string; prev: SrCard | undefined };
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
  rules: StrategyRules,
  elapsedMs: number,
  deck: SrDeck,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
  underShotClock?: boolean,
): FlashGradeResult {
  const built = buildFlashcardEvent(card, taken, rules, elapsedMs);
  const { correctAction, correct } = built;
  // V3-5: the grader already holds the wall clock the SR schedule runs on, so
  // the event is dated from the same `now` its retention row is. One clock per
  // answer, so a row can never disagree with the review that produced it.
  //
  // V5-2: `underShotClock` is stamped HERE and not by the caller, because this
  // function is what calls persistGrade -- a caller decorating the returned
  // event would only be decorating its own copy, and the stats blob would
  // never see the flag. (That is exactly what the first version did, and the
  // e2e caught it.) Left undefined when the caller does not say, so "unknown"
  // stays distinguishable from "untimed".
  const event: GradedEvent = {
    ...built.event,
    at: new Date(now).toISOString(),
    ...(underShotClock === undefined ? {} : { underShotClock }),
  };

  const review = { elapsedMs: trackedElapsedMs(elapsedMs, taken === TIMEOUT_ANSWER), channel };

  // Wave A F4b: a With-count card whose expected play came from an index was a
  // question about the INDEX. It is reviewed in the quiz deck under that
  // index, where the Deviation quiz schedules it, and the basic cell's
  // schedule is left alone -- missing 16v10 at +2 is not forgetting hard 16 v
  // 10 at TC 0, and it used to reset the cell's box.
  const deviationId = event.deviationId;
  if (deviationId) {
    const quizDeck = loadQuizSr();
    const prevIndex = quizDeck[deviationId];
    const retention = prevIndex && isGapReview(prevIndex, now) ? retentionRow(deviationId, prevIndex, correct, now) : null;
    saveQuizSr({ ...quizDeck, [deviationId]: reviewCard(prevIndex, correct, now, review) });
    const cellBefore = persistGrade(event, retention);
    return { event, correctAction, nextDeck: deck, cellBefore, indexReview: { key: deviationId, prev: prevIndex } };
  }

  // RV4: classify the gap review against the cell's PRE-review state, then
  // advance its Leitner schedule.
  const prev = deck[card.cellId];
  const retention = prev && isGapReview(prev, now) ? retentionRow(card.cellId, prev, correct, now) : null;
  const nextDeck = { ...deck, [card.cellId]: reviewCard(prev, correct, now, review) };
  saveFlashSr(nextDeck);

  const cellBefore = persistGrade(event, retention);

  return { event, correctAction, nextDeck, cellBefore };
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
  rules: StrategyRules,
  elapsedMs: number,
  now: number,
): { event: GradedEvent; correctAction: Action; correct: boolean; cellBefore: CellTally | null } {
  const built = buildFlashcardEvent(cell, taken, rules, elapsedMs, 'mastery');
  // V3-5: dated like every other graded answer. A mastery run is exactly the
  // kind of long unbroken sitting the session analysis exists to look at, so
  // leaving it undated would blind the drift readout to the drill most likely
  // to show one.
  const event: GradedEvent = { ...built.event, at: new Date(now).toISOString() };
  const cellBefore = persistGrade(event, null);
  return { ...built, event, cellBefore };
}

export interface QuizGradeResult {
  event: GradedEvent;
  /** The SR deck after this answer's Leitner review (unchanged for a distractor,
   * which carries no deviationId and is never scheduled). */
  nextDeck: SrDeck;
  /** B3: the answered cell's tally before this answer, for "Wrong tap". */
  cellBefore: CellTally | null;
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
  rules: StrategyRules,
  elapsedMs: number,
  deck: SrDeck,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
  underShotClock?: boolean,
): QuizGradeResult {
  // V5-2: stamped here, not by the caller -- see gradeFlashcardAnswer.
  const event: GradedEvent = {
    ...buildQuizEvent(item, taken, rules, elapsedMs),
    at: new Date(now).toISOString(),
    ...(underShotClock === undefined ? {} : { underShotClock }),
  };

  let nextDeck = deck;
  let retention: RetentionRow | null = null;
  if (item.deviationId) {
    const prev = deck[item.deviationId];
    retention = prev && isGapReview(prev, now) ? retentionRow(item.deviationId, prev, event.correct, now) : null;
    nextDeck = {
      ...deck,
      [item.deviationId]: reviewCard(prev, event.correct, now, { elapsedMs: trackedElapsedMs(elapsedMs, taken === TIMEOUT_ANSWER), channel }),
    };
    saveQuizSr(nextDeck);
  }

  const cellBefore = persistGrade(event, retention);

  return { event, nextDeck, cellBefore };
}

/**
 * B3: grade an Index test answer end-to-end. The index is reviewed in the QUIZ
 * deck (the same card the Deviation quiz schedules), a gap review writes its
 * retention row, and the event is tallied per index. No `elapsedMs` reaches
 * `reviewCard`: keying a signed number takes longer than tapping a play, so it
 * would brake promotion (FLUENT_MS) and drag the shared card's `paceMs`, which
 * the play quiz reads.
 */
export function gradeIndexTestAnswer(
  item: IndexTestItem,
  answer: number,
  deck: SrDeck,
  now: number,
  channel: AnswerChannel = SCREEN_CHANNEL,
  // #24 (R8): the answer was shown after a miss this session -- a copy, not a recall.
  answerShown = false,
): { event: GradedEvent; nextDeck: SrDeck; correct: boolean } {
  const event: GradedEvent = { ...buildIndexTestEvent(item, answer), at: new Date(now).toISOString() };
  const prev = deck[item.deviationId];
  const retention = prev && isGapReview(prev, now) ? retentionRow(item.deviationId, prev, event.correct, now) : null;
  const nextDeck = { ...deck, [item.deviationId]: reviewCard(prev, event.correct, now, { channel, answerShown }) };
  saveQuizSr(nextDeck);
  persistGrade(event, retention);
  return { event, nextDeck, correct: event.correct };
}
