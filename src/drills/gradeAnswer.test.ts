import { describe, it, expect, beforeEach, vi } from 'vitest';
import { drawFlashcard, generateAllCells } from './flashcards';
import type { Flashcard } from './flashcards';
import { drawQuizItem, quizCtxFor } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';
import {
  buildFlashcardEvent,
  buildQuizEvent,
  gradeFlashcardAnswer,
  gradeQuizAnswer,
  gradeMasteryAnswer,
  gradeIndexTestAnswer,
  loadFlashSr,
  loadQuizSr,
  FLASH_SR_KEY,
  SELF_REPORT_HAD,
  SELF_REPORT_MISSED,
  TIMEOUT_ANSWER,
} from './gradeAnswer';
import type { SrDeck } from './spacedRepetition';
import {
  BLIND_TAP_CHANNEL,
  CHANNEL_BASE_CAP,
  FLUENT_MS,
  MAX_BOX,
  SCREEN_CHANNEL,
  VOICE_CHANNEL,
  channelBit,
} from './spacedRepetition';
import { _setStorage, loadStats } from '../store/persist';
import { EMPTY_STATS } from '../store/types';
import { applyEvents } from '../store/stats';
import { DEFAULT_RULES } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';
import { drillLegalActions } from './legalActions';
import type { Card, Rank } from '../engine/cards';
import type { Action } from '../engine/deviations';
import { mulberry32 } from '../engine/cards';
import { buildIndexTestEvent, indexTestSet, indexTestItemFor } from './indexTest';
import { handCategoryProgress } from '../ui/screens/handProgress';
import { readiness } from '../ui/screens/readiness';

/**
 * R4 anti-drift guard (docs/BACKLOG.md): the mixed-session view and the two
 * standalone drill views (FlashcardsView / DeviationQuizView in Drills.tsx)
 * grade through ONE implementation -- the wrappers in gradeAnswer.ts. These
 * tests pin that implementation so a "mixed-mode flashcard/quiz item produces
 * the byte-identical GradedEvent + Stats write + SR-deck update as the
 * standalone drill for the same seed/hand/now" is guaranteed by construction:
 * given identical inputs the function is deterministic, and BOTH call sites
 * pass identical inputs. RV4: the shared path now schedules via the Leitner
 * SR deck (`now` is wall-clock epoch ms, passed by the component).
 *
 * An injected in-memory storage isolates each test's Stats write so the
 * loadStats() assertions read exactly what the graded event produced.
 */
const NOW = 1_700_000_000_000; // a fixed wall-clock so SR scheduling is deterministic in-test

function freshStorage() {
  const map = new Map<string, string>();
  _setStorage({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  });
}

beforeEach(() => {
  freshStorage();
});

describe('gradeAnswer shared grade path (R4 anti-drift)', () => {
  describe('flashcards', () => {
    it('buildFlashcardEvent is deterministic: identical inputs -> byte-identical event (mixed == standalone)', () => {
      const card = drawFlashcard('all', {}, 0, 12345, DEFAULT_RULES);
      const standalone = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 111);
      const mixed = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 111);
      expect(mixed).toEqual(standalone);
      expect(standalone.event.kind).toBe('action');
      expect(standalone.event.tc).toBe(0); // flashcards are ALWAYS count-free
      // A3: the reason is PROSE from the strategy engine, not the cell id.
      // It was `card.cellId`, so the correction panel and the spoken
      // correction both read "soft-20-v-A" where an explanation belongs --
      // while `withCount.reason` ("Basic stand vs dealer 9") sat right there,
      // already computed and discarded. The cell id is still carried as
      // `hand`, which is what it actually is.
      expect(standalone.event.reason).toMatch(/^Basic /);
      expect(standalone.event.reason).not.toBe(card.cellId);
      expect(standalone.event.hand).toBe(card.cellId);
      expect(standalone.event.elapsedMs).toBe(111);
    });

    it('gradeFlashcardAnswer: identical inputs -> identical event, correctAction, nextDeck, AND Stats write', () => {
      const card = drawFlashcard('all', {}, 0, 424242, DEFAULT_RULES);

      freshStorage();
      const a = gradeFlashcardAnswer(card, 'hit', DEFAULT_RULES, 250, {}, NOW);
      const statsAfterA = loadStats();

      freshStorage();
      const b = gradeFlashcardAnswer(card, 'hit', DEFAULT_RULES, 250, {}, NOW);
      const statsAfterB = loadStats();

      expect(b.event).toEqual(a.event);
      expect(b.correctAction).toEqual(a.correctAction);
      expect(b.nextDeck).toEqual(a.nextDeck);
      expect(statsAfterB).toEqual(statsAfterA);

      // A fresh-deck answer is never a gap review, so the Stats write is exactly
      // applyEvents(EMPTY, [event]) -- the same thing the standalone view writes.
      expect(statsAfterA).toEqual(applyEvents(EMPTY_STATS, [a.event]));
    });

    // E2 (W2-2), deliberate change: one correct answer after a miss no longer
    // promotes -- the learning step needs two, with another card between.
    it('gradeFlashcardAnswer: a miss schedules the cell due-now at box 0; the second correct answer after it promotes it to box 1 (SR)', () => {
      const card = drawFlashcard('all', {}, 0, 777, DEFAULT_RULES);
      const wrong = card.correct === 'stand' ? 'hit' : 'stand';

      const missed = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 10, {}, NOW);
      expect(missed.event.correct).toBe(false);
      expect(missed.nextDeck[card.cellId].box).toBe(0);
      expect(missed.nextDeck[card.cellId].dueAt).toBe(NOW); // box-0 interval is 0 -> due now

      const first = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 10, missed.nextDeck, NOW);
      expect(first.event.correct).toBe(true);
      expect(first.nextDeck[card.cellId].box).toBe(0); // the learning step: still box 0...
      expect(first.nextDeck[card.cellId].dueAt).toBe(NOW); // ...and due now

      // The same cell straight back, with no card between, banks nothing.
      const repeated = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 10, first.nextDeck, NOW, undefined, undefined, true);
      expect(repeated.nextDeck[card.cellId].box).toBe(0);

      const recovered = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 10, repeated.nextDeck, NOW);
      expect(recovered.nextDeck[card.cellId].box).toBe(1); // promoted one box
    });
  });

  describe('deviation quiz', () => {
    it('buildQuizEvent is deterministic: identical inputs -> byte-identical event (mixed == standalone)', () => {
      const item = drawQuizItem(98765, undefined, DEFAULT_RULES);
      const standalone = buildQuizEvent(item, 'stand', DEFAULT_RULES, 222);
      const mixed = buildQuizEvent(item, 'stand', DEFAULT_RULES, 222);
      expect(mixed).toEqual(standalone);
      expect(standalone.elapsedMs).toBe(222);
      expect(standalone.deviationId).toBe(item.deviationId);
    });

    it('gradeQuizAnswer: identical inputs -> identical event, nextDeck, AND Stats write', () => {
      const item = drawQuizItem(55555, undefined, DEFAULT_RULES);

      freshStorage();
      const a = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 300, {}, NOW);
      const statsAfterA = loadStats();

      freshStorage();
      const b = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 300, {}, NOW);
      const statsAfterB = loadStats();

      expect(b.event).toEqual(a.event);
      expect(b.nextDeck).toEqual(a.nextDeck);
      expect(statsAfterB).toEqual(statsAfterA);
      expect(statsAfterA).toEqual(applyEvents(EMPTY_STATS, [a.event]));
    });

    it('gradeQuizAnswer: only real items (with a deviationId) touch the SR deck; distractors never do', () => {
      // Force a distractor (distractorPct 100): it carries no deviationId, so
      // the SR deck must be returned unchanged.
      const distractor = drawQuizItem(31000, undefined, DEFAULT_RULES, 100);
      expect(distractor.deviationId).toBeUndefined();
      const before: SrDeck = { '16v10': { box: 2, dueAt: 0, lastSeenAt: 0, lapses: 1, reviews: 3 } };
      const graded = gradeQuizAnswer(distractor, distractor.correct, DEFAULT_RULES, 10, before, NOW);
      expect(graded.nextDeck).toEqual(before); // untouched
    });

    it('E2 gradeQuizAnswer: the learning step -- a repeat banks nothing, the second spaced correct promotes', () => {
      const item = drawQuizItem(55555, undefined, DEFAULT_RULES);
      const id = item.deviationId!;
      const wrong = item.correct === 'stand' ? 'hit' : 'stand';
      const missed = gradeQuizAnswer(item, wrong, DEFAULT_RULES, 10, {}, NOW).nextDeck;
      const first = gradeQuizAnswer(item, item.correct, DEFAULT_RULES, 10, missed, NOW).nextDeck;
      expect([first[id]!.box, first[id]!.learningStep]).toEqual([0, 1]);
      const repeated = gradeQuizAnswer(item, item.correct, DEFAULT_RULES, 10, first, NOW, undefined, undefined, true).nextDeck;
      expect([repeated[id]!.box, repeated[id]!.learningStep]).toEqual([0, 1]);
      expect(gradeQuizAnswer(item, item.correct, DEFAULT_RULES, 10, repeated, NOW).nextDeck[id]!.box).toBe(1);
    });
  });

  describe('cross-context byte-identity for the same seed/hand', () => {
    it('a flashcard graded via the shared path writes tc=0 and NO deviationId; a quiz item writes its tc + deviationId -- the discrimination is visible in the telemetry', () => {
      const card = drawFlashcard('all', {}, 0, 246810, DEFAULT_RULES);
      const flashEvent = gradeFlashcardAnswer(card, 'stand', DEFAULT_RULES, 5, {}, NOW).event;
      expect(flashEvent.tc).toBe(0);
      expect(flashEvent.deviationId).toBeUndefined();

      const item = drawQuizItem(1357, undefined, DEFAULT_RULES);
      const quizEvent = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 5, {}, NOW).event;
      expect(quizEvent.tc).toBe(item.tc);
      expect(quizEvent.deviationId).toBe(item.deviationId);
    });

    it('a gap review (learned cell recalled after its interval) records a retention row through the shared path', () => {
      const card = drawFlashcard('all', {}, 0, 999, DEFAULT_RULES);
      // Seed the cell as learned (box 2) and long overdue, so THIS grade is a gap review.
      const DAY = 24 * 60 * 60 * 1000;
      const deck: SrDeck = {
        [card.cellId]: { box: 2, dueAt: NOW - 5 * DAY, lastSeenAt: NOW - 12 * DAY, lapses: 0, reviews: 3 },
      };
      freshStorage();
      gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 5, deck, NOW);
      const stats = loadStats();
      expect(stats.retention.history).toHaveLength(1);
      const row = stats.retention.history[0]!;
      expect(row.key).toBe(card.cellId);
      expect(row.correct).toBe(true);
      expect(row.box).toBe(2); // the PRE-review box
      expect(row.gapMs).toBe(12 * DAY);
    });
  });

  describe('mastery', () => {
    it('gradeMasteryAnswer tags the event source as "mastery" and does NOT touch the flashcard SR deck', () => {
      freshStorage();
      const card = drawFlashcard('all', {}, 0, 55555, DEFAULT_RULES); // reused as the cell shape
      const result = gradeMasteryAnswer(card, 'hit', DEFAULT_RULES, 200, NOW);
      expect(result.event.source).toBe('mastery');

      const stats = loadStats();
      expect(stats.bySource?.mastery).toBeDefined();
      expect(stats.bySource?.flashcard).toBeUndefined();

      // No SR deck write: loadFlashSr() must still be empty after grading via
      // the mastery path (a plain flashcard grade WOULD populate it -- that's
      // gradeFlashcardAnswer's job, deliberately not this one's).
      expect(loadFlashSr()).toEqual({});
    });

    it('buildFlashcardEvent still defaults to source "flashcard" when no source is passed (existing callers unaffected)', () => {
      const card = drawFlashcard('all', {}, 0, 1, DEFAULT_RULES);
      const { event } = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 50);
      expect(event.source).toBe('flashcard');
    });
  });
});

/* ---------------------------------------------------------------- */
/* V3-8: what the mistake cost.                                      */
/* ---------------------------------------------------------------- */

/**
 * The contract these tests pin is stated in GradedEvent.evCost's doc: a number
 * ONLY for a `basic-error`, absent everywhere else. Absent is not zero, and the
 * distinction is load-bearing -- a zero that stood in for "unpriced" would land
 * in every average and quietly drag a learner's cost-per-mistake toward nothing.
 *
 * The gate is one line in priceMistake, and it is the kind of line that looks
 * obviously right and is easy to loosen later, so each abstention below is a
 * separate named test rather than one loop.
 */
function flash(cards: [Card, Card], up: Rank, cellId: string, correct: Action): Flashcard {
  return { cards, up, correct, cellId };
}

const H = (rank: Rank): Card => ({ rank, suit: 's' });

describe('evCost (V3-8: what the mistake cost)', () => {
  it('prices a plain basic-strategy error, and prices it dearly when it is dear', () => {
    // Hitting a hard 19 against a six. No index touches hard 19, so this is a
    // pure basic error, and it is close to the worst answer in the game.
    const card = flash([H('10'), H('9')], '6', 'hard-19-v-6', 'stand');
    const { event } = buildFlashcardEvent(card, 'hit', DEFAULT_RULES, 100);

    expect(event.classification).toBe('basic-error');
    expect(event.evCost).toBeDefined();
    expect(event.evCost!).toBeGreaterThan(0.4);
  });

  it('leaves a correct answer unpriced, because zero cost and no cost differ', () => {
    const card = flash([H('10'), H('9')], '6', 'hard-19-v-6', 'stand');
    const { event, correct } = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 100);

    expect(correct).toBe(true);
    expect(event.evCost).toBeUndefined();
  });

  /** The whole reason the feature exists: a wrong answer is not one size. */
  it('separates a trivial error from an expensive one by two orders of magnitude', () => {
    // Standing on soft 18 v 2 instead of doubling: the chart's play, given up.
    const trivial = buildFlashcardEvent(
      flash([H('A'), H('7')], '2', 'soft-18-v-2', 'double'),
      'stand',
      DEFAULT_RULES,
      100,
    ).event;
    // Doubling a pair of tens against an eight: one card on a made 20, at twice
    // the stake.
    const awful = buildFlashcardEvent(
      flash([H('10'), H('10')], '8', 'pair-10-v-8', 'stand'),
      'double',
      DEFAULT_RULES,
      100,
    ).event;

    expect(trivial.classification).toBe('basic-error');
    expect(awful.classification).toBe('basic-error');
    expect(trivial.evCost!).toBeLessThan(0.01);
    expect(awful.evCost!).toBeGreaterThan(2);
    expect(awful.evCost! / trivial.evCost!).toBeGreaterThan(100);
    // ...and binary grading calls these the same thing:
    expect(trivial.correct).toBe(awful.correct);
  });

  /**
   * The abstention that matters most, and it has to come from the quiz: the
   * flashcard drill always grades at a neutral count, where the only index that
   * applies (16 v 10 from TC 0 up) is masked by basic surrender anyway. The quiz
   * carries a real count, so 16 v 10 at +3 is a live index -- and the EV engine,
   * which cannot see a count at all, prices the index play as the WORSE one.
   * Pricing this would report a missed deviation as free, or as a gain.
   */
  it('refuses to price a missed deviation, because the EV engine is count-blind', () => {
    const item: QuizItem = {
      cards: [H('10'), H('6')],
      up: '10',
      tc: 3,
      deviationId: '16v10',
      isDeviationSide: true,
      correct: 'stand',
      label: '16 v 10: stand at TC >= 0',
      isDistractor: false,
    };
    const event = buildQuizEvent(item, 'hit', DEFAULT_RULES, 100);

    expect(event.classification).toBe('missed-deviation');
    expect(event.evCost).toBeUndefined();
  });

  /**
   * The mirror case: 12 v 4 is "hit at any negative count", so hitting at a
   * neutral count is a deviation taken below its threshold. A count-blind engine
   * prices that at neutral-count weights, which overstates what it cost at
   * whatever count the learner was actually looking at.
   */
  it('refuses to price a phantom deviation for the same reason', () => {
    // Wave A (s01): on a With-count card (tc shown). A plain card with no
    // count cannot phantom-deviate; see the s01 test below.
    const card = { ...flash([H('10'), H('2')], '4', 'hard-12-v-4', 'stand'), tc: 0 };
    const { event } = buildFlashcardEvent(card, 'hit', DEFAULT_RULES, 100);

    expect(event.classification).toBe('phantom-deviation');
    expect(event.evCost).toBeUndefined();
  });

  it('refuses to price a wrong-anyway answer, which also sits on a deviation cell', () => {
    // 16 v 10 at +3 again, answered with neither the index (stand) nor basic
    // strategy (hit). Still a cell where an index governs, so still unpriced.
    const item: QuizItem = {
      cards: [H('10'), H('6')],
      up: '10',
      tc: 3,
      deviationId: '16v10',
      isDeviationSide: true,
      correct: 'stand',
      label: '16 v 10: stand at TC >= 0',
      isDistractor: false,
    };
    const event = buildQuizEvent(item, 'double', DEFAULT_RULES, 100);

    expect(event.classification).toBe('wrong-anyway');
    expect(event.evCost).toBeUndefined();
  });

  it('leaves insurance unpriced: it is not a hand decision at all', () => {
    const item: QuizItem = {
      cards: null,
      up: 'A',
      tc: 5,
      deviationId: 'ins',
      isDeviationSide: true,
      correct: 'take-insurance',
      label: 'Insurance: take at TC >= +3',
      isDistractor: false,
    };
    const event = buildQuizEvent(item, 'decline-insurance', DEFAULT_RULES, 100);

    expect(event.kind).toBe('insurance');
    expect(event.correct).toBe(false);
    expect(event.evCost).toBeUndefined();
  });

  /**
   * The drills offer all five action zones on every hand, so "split" is a
   * pressable answer on a hand that cannot be split. That is a real mistake and
   * is graded as one -- but there is no EV for an action the hand does not have,
   * and a fabricated number would be worse than none.
   */
  it('cannot price an action the hand does not allow, and does not invent one', () => {
    const card = flash([H('10'), H('4')], '6', 'hard-14-v-6', 'stand');
    const { event } = buildFlashcardEvent(card, 'split', DEFAULT_RULES, 100);

    expect(event.classification).toBe('basic-error');
    expect(event.evCost).toBeUndefined();
  });

  /**
   * Measured against the CHARTED play, not the highest-EV line -- which is why
   * evCostBetween exists alongside evCostOf. Soft 13 v 5 is one of the two or
   * three cells where the hand-entered chart and the infinite-deck arithmetic
   * disagree by a rounding error (see engine/handEv.test.ts): the chart says
   * double, the arithmetic marginally prefers hitting. A learner who hit is
   * marked wrong by the chart, and the honest cost of that is nothing -- not a
   * negative number, and not the distance to some third best line.
   */
  it('measures against the play it marked correct, never below zero', () => {
    const card = flash([H('A'), H('2')], '5', 'soft-13-v-5', 'double');
    const { event } = buildFlashcardEvent(card, 'hit', DEFAULT_RULES, 100);

    expect(event.classification).toBe('basic-error');
    expect(event.evCost).toBe(0);

    // And on the same cell, a third answer separates the two measurements for
    // real: standing costs 0.2919 against the chart's double, but 0.2983 against
    // the arithmetic's preferred hit. Grading against the highest-EV line instead
    // would report the larger number, and would be charging the learner for the
    // chart's rounding error on top of their own mistake.
    const stood = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 100).event;
    expect(stood.evCost!).toBeCloseTo(0.2919, 4);
  });

  it('prices the quiz path too, through the same gate', () => {
    // A distractor item: no index applies, so the correct answer is plain basic
    // strategy and a wrong answer is a plain basic error.
    const item: QuizItem = {
      cards: [H('10'), H('9')],
      up: '6',
      tc: 0,
      isDeviationSide: false,
      correct: 'stand',
      label: 'hard 19 v 6',
      isDistractor: true,
    };
    const event = buildQuizEvent(item, 'hit', DEFAULT_RULES, 100);

    expect(event.classification).toBe('basic-error');
    expect(event.evCost!).toBeGreaterThan(0.4);

    const right = buildQuizEvent(item, 'stand', DEFAULT_RULES, 100);
    expect(right.evCost).toBeUndefined();
  });

  /**
   * A sweep, because the per-cell tests above each pin one cell and the Stats
   * surface will average over all of them. Every priced cost must be finite and
   * non-negative, and no correct answer anywhere may carry a number.
   */
  it('is finite and non-negative wherever it exists, across the whole chart', () => {
    const ctx = { canDouble: true, canSplit: true, canSurrender: true };
    const actions: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];
    let priced = 0;

    for (const cell of generateAllCells()) {
      const advice = correctPlay(cell.cards, cell.up, 0, ctx, DEFAULT_RULES);
      const card = flash(cell.cards, cell.up, cell.id, advice.action);
      for (const taken of actions) {
        const { event } = buildFlashcardEvent(card, taken, DEFAULT_RULES, 100);
        const where = `${cell.id} ${taken}`;
        if (event.correct) {
          expect(event.evCost, where).toBeUndefined();
          continue;
        }
        if (event.classification !== 'basic-error') {
          expect(event.evCost, where).toBeUndefined();
          continue;
        }
        if (event.evCost === undefined) continue; // an illegal split; see above
        expect(Number.isFinite(event.evCost), where).toBe(true);
        expect(event.evCost, where).toBeGreaterThanOrEqual(0);
        priced += 1;
      }
    }

    // Guard against a vacuous pass: 330 cells x 5 answers, most of them wrong.
    expect(priced).toBeGreaterThan(800);
  });
});

/* ---------------------------------------------------------------- */
/* R1: the shot clock's timeout, through the shared grade path.      */
/* ---------------------------------------------------------------- */

/**
 * A timeout is a graded miss with its own classification, and every one of
 * those words is load-bearing:
 *
 *  - GRADED, so the card counts against the learner and returns to the review
 *    deck. A drill that quietly skips the cards you freeze on would let you
 *    grind the ones you already know.
 *  - a MISS, never a correct answer, whatever the hand was.
 *  - its OWN classification, so it never lands in the wrong-play taxonomy, is
 *    never priced by the EV engine (there is no second action to price against),
 *    and can be read separately from "I chose badly" -- freezing on a cell and
 *    misplaying it need different work.
 */
describe('shot-clock timeout (R1)', () => {
  const card: Flashcard = flash([H('10'), H('9')], '6', 'hard-19-v-6', 'stand');

  it('grades as a miss under its own classification, never as a wrong play', () => {
    const { event, correct } = buildFlashcardEvent(card, TIMEOUT_ANSWER, DEFAULT_RULES, 3000);

    expect(correct).toBe(false);
    expect(event.correct).toBe(false);
    expect(event.classification).toBe('timeout');
    expect(event.taken).toBe('timeout');
  });

  /**
   * The correct play still has to be reported: the whole value of a timeout is
   * being told what you could not produce.
   */
  it('still names the play that was wanted', () => {
    const { event, correctAction } = buildFlashcardEvent(card, TIMEOUT_ANSWER, DEFAULT_RULES, 3000);
    expect(event.expected).toBe('stand');
    expect(correctAction).toBe('stand');
    expect(event.reason).not.toBe('');
  });

  /**
   * Guarded twice over, and worth saying which is which: `priceMistake`'s gate
   * refuses anything that is not a `basic-error`, and independently of that the
   * EV engine has no price for an action called "timeout" and returns null.
   * Removing either one alone leaves this passing -- so this test pins the
   * CONTRACT, not the mechanism, and the mechanism's two halves are pinned in
   * gradeAnswer.ts's own gate tests and handEv.test.ts respectively.
   */
  it('is never priced: there is no second action to price against', () => {
    const { event } = buildFlashcardEvent(card, TIMEOUT_ANSWER, DEFAULT_RULES, 3000);
    expect(event.evCost).toBeUndefined();
  });

  /** The measured time, not the nominal limit -- see the drill views' handlers. */
  it('carries the elapsed time it was given', () => {
    const { event } = buildFlashcardEvent(card, TIMEOUT_ANSWER, DEFAULT_RULES, 31_412);
    expect(event.elapsedMs).toBe(31_412);
  });

  it('does the same thing on the quiz path, on a deviation cell', () => {
    const item: QuizItem = {
      cards: [H('10'), H('6')],
      up: '10',
      tc: 3,
      deviationId: '16v10',
      isDeviationSide: true,
      correct: 'stand',
      label: '16 v 10: stand at TC >= 0',
      isDistractor: false,
    };
    const event = buildQuizEvent(item, TIMEOUT_ANSWER, DEFAULT_RULES, 5000);

    // A deviation cell would otherwise classify as missed-deviation. It does
    // not: no play was chosen, so no play can be the one that was missed.
    expect(event.classification).toBe('timeout');
    expect(event.correct).toBe(false);
    expect(event.expected).toBe('stand');
  });

  it('does the same thing on an insurance item', () => {
    const item: QuizItem = {
      cards: null,
      up: 'A',
      tc: 5,
      deviationId: 'ins',
      isDeviationSide: true,
      correct: 'take-insurance',
      label: 'Insurance: take at TC >= +3',
      isDistractor: false,
    };
    const event = buildQuizEvent(item, TIMEOUT_ANSWER, DEFAULT_RULES, 5000);

    expect(event.kind).toBe('insurance');
    expect(event.correct).toBe(false);
    // NOT missed-deviation, which is what this was before the timeout branch
    // was added ahead of classifyInsurance: that function takes a boolean, so
    // "no answer" collapsed into "declined", and at TC +5 a decline is a missed
    // index -- crediting the learner with a decision they never made.
    expect(event.classification).toBe('timeout');
    expect(event.taken).toBe('timeout');
  });

  it('sends the card back into the review deck as a miss, and records it in Stats', () => {
    const deck: SrDeck = {};
    const result = gradeFlashcardAnswer(card, TIMEOUT_ANSWER, DEFAULT_RULES, 3000, deck, NOW);

    // Reviewed as a miss: a freshly-missed card sits in the bottom box.
    expect(result.nextDeck['hard-19-v-6']).toBeDefined();
    // Box 0 is the bottom of the Leitner ladder -- where any miss lands.
    expect(result.nextDeck['hard-19-v-6']!.box).toBe(0);

    const stats = loadStats();
    expect(stats.mistakes.timeout).toBe(1);
    expect(stats.mistakes['basic-error']).toBe(0);
    expect(stats.categories.hard.wrong).toBe(1);
    // Unpriced, so nothing lands in the EV-cost history.
    expect(stats.evCost.history).toHaveLength(0);
  });
});

/* ================================================================== */
/* The wiring, not the arithmetic.                                    */
/*                                                                    */
/* spacedRepetition.test.ts already pins what a hesitant answer and a */
/* screen-only channel DO. These pin that the grade path actually     */
/* hands them over -- the failure mode being a scheduler that weighs  */
/* pace and channel perfectly while every real answer arrives         */
/* unmeasured and unattributed.                                       */
/* ================================================================== */

describe('the grade path carries pace and channel into the SR deck', () => {
  const NOW2 = 1_700_000_000_000;
  // Longer than the longest box interval: every review is due (C3).
  const DUE_GAP = 60 * 86_400_000;

  it('flashcards: the elapsed time it was given is the one the scheduler judges', () => {
    const card = drawFlashcard('all', {}, 0, 4242, DEFAULT_RULES);

    const fast = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 200, {}, NOW2);
    expect(fast.nextDeck[card.cellId]!.box).toBe(1);
    expect(fast.nextDeck[card.cellId]!.paceMs).toBe(200);

    // Same answer, same card, same deck -- only slower. It must not promote.
    const slow = gradeFlashcardAnswer(
      card,
      card.correct,
      DEFAULT_RULES,
      FLUENT_MS + 1,
      fast.nextDeck,
      NOW2,
    );
    expect(slow.nextDeck[card.cellId]!.box).toBe(1); // held, not promoted to 2
  });

  it('flashcards: the channel it was given is the one that sets the ceiling', () => {
    const card = drawFlashcard('all', {}, 0, 4242, DEFAULT_RULES);

    const grind = (channel: { eyesFree: boolean; handsFree: boolean }) => {
      let deck: SrDeck = {};
      for (let i = 0; i < 10; i++) {
        // C3: each answer lands after the last one's due date, so it can promote.
        deck = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 200, deck, NOW2 + i * DUE_GAP, channel)
          .nextDeck;
      }
      return deck[card.cellId]!;
    };

    expect(grind(SCREEN_CHANNEL).box).toBe(CHANNEL_BASE_CAP);
    expect(grind(VOICE_CHANNEL).box).toBe(MAX_BOX);
    expect(grind(BLIND_TAP_CHANNEL).channels).toBe(channelBit(BLIND_TAP_CHANNEL));
  });

  it('flashcards: an omitted channel defaults to the screen, not to unlimited', () => {
    const card = drawFlashcard('all', {}, 0, 4242, DEFAULT_RULES);
    let deck: SrDeck = {};
    for (let i = 0; i < 10; i++) {
      deck = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 200, deck, NOW2 + i * DUE_GAP).nextDeck;
    }
    // The wrappers are the app's boundary: a caller that forgot to say how the
    // answer arrived gets the conservative reading, never a free pass to the
    // top of the ladder.
    expect(deck[card.cellId]!.box).toBe(CHANNEL_BASE_CAP);
    expect(deck[card.cellId]!.channels).toBe(channelBit(SCREEN_CHANNEL));
  });

  it('the deviation quiz carries them too, so the two drills cannot drift', () => {
    const item = drawQuizItem(1234, undefined, DEFAULT_RULES);
    expect(item.deviationId).toBeTruthy();

    let deck: SrDeck = {};
    for (let i = 0; i < 10; i++) {
      deck = gradeQuizAnswer(
        item,
        item.correct,
        DEFAULT_RULES,
        200,
        deck,
        NOW2 + i * DUE_GAP,
        BLIND_TAP_CHANNEL,
      ).nextDeck;
    }
    const entry = deck[item.deviationId!]!;
    expect(entry.box).toBe(CHANNEL_BASE_CAP + 1);
    expect(entry.channels).toBe(channelBit(BLIND_TAP_CHANNEL));
    expect(entry.paceMs).toBe(200);
  });
});

/**
 * V3-5: every graded answer is dated from the same wall clock its SR review
 * runs on. Without this the two histories applyEvents writes carried no date,
 * so the Stats range picker silently did not apply to them and the pace-drift
 * analysis had nothing to group.
 */
describe('graded answers are dated (V3-5)', () => {
  const stamp = new Date(NOW).toISOString();

  it('a flashcard answer stamps the event and the persisted latency row', () => {
    freshStorage();
    const card = drawFlashcard('all', {}, 0, 4242, DEFAULT_RULES);
    const { event } = gradeFlashcardAnswer(card, 'stand', DEFAULT_RULES, 800, {}, NOW);
    expect(event.at).toBe(stamp);
    const row = loadStats().latencyHistory.at(-1)!;
    expect(row.date).toBe(stamp);
    // The retention row and the latency row agree, because they share `now`.
    expect(row.elapsedMs).toBe(800);
  });

  it('a deviation-quiz answer stamps the event and the persisted latency row', () => {
    freshStorage();
    const item = drawQuizItem(55555, undefined, DEFAULT_RULES);
    const { event } = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 300, {}, NOW);
    expect(event.at).toBe(stamp);
    expect(loadStats().latencyHistory.at(-1)!.date).toBe(stamp);
  });

  it('a mastery answer is dated too, from the clock its caller passes', () => {
    freshStorage();
    const cell = drawFlashcard('all', {}, 0, 909, DEFAULT_RULES);
    const { event } = gradeMasteryAnswer(cell, 'hit', DEFAULT_RULES, 300, NOW);
    expect(event.at).toBe(stamp);
    expect(loadStats().latencyHistory.at(-1)!.date).toBe(stamp);
    // ...and the mastery source survives being spread over.
    expect(event.source).toBe('mastery');
  });
});

/* ---------------------------------------------------------------------- */
/* RV3: the draw and the grade have to agree about what was on the table   */
/* ---------------------------------------------------------------------- */

describe('the grader asks the same question the draw asked', () => {
  const RULES = { ...DEFAULT_RULES, surrenderIndices: true };

  /**
   * B1. `drawQuizItem` asks a Fab 4 item with surrender AVAILABLE -- it has
   * to, or the engine can never return the play the item is about -- and
   * `item.correct` is `surrender`. The grader computed its expectation with
   * `canSurrender: false` hardcoded, so the correct answer was marked wrong
   * at every true count, on a feedback card printing "expected: surrender".
   */
  it('marks a correct surrender correct, on a surrender index', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const item = drawQuizItem(seed, 'sur15v10', RULES);
      if (item.correct !== 'surrender') continue;
      checked += 1;
      const right = gradeQuizAnswer(item, 'surrender', RULES, 100, {}, 0);
      expect(
        right.event.correct,
        `tc=${item.tc}: answered surrender, item says ${item.correct}, graded wrong`,
      ).toBe(true);
      const wrong = gradeQuizAnswer(item, 'hit', RULES, 100, {}, 0);
      expect(wrong.event.correct, `tc=${item.tc}: hitting scored on a surrender index`).toBe(
        false,
      );
    }
    // Vacuity guard: `sur15v10` surrenders at TC >= 0 and the draw spreads
    // the count either side of the index, so roughly half the seeds must
    // land on the deviation side. Zero means the loop asserted nothing.
    expect(checked, 'no surrender item was ever drawn, so this proves nothing').toBeGreaterThan(5);
  });

  /**
   * ...and the same item on the other side of its index, where the correct
   * play is `hit`, must still grade. A fix that simply turned surrender on
   * everywhere would pass the test above and fail this one.
   */
  it('still grades the non-deviation side of a surrender index', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const item = drawQuizItem(seed, 'sur15v10', RULES);
      if (item.correct === 'surrender') continue;
      checked += 1;
      const graded = gradeQuizAnswer(item, item.correct as string, RULES, 100, {}, 0);
      expect(graded.event.correct, `tc=${item.tc}: the item's own answer was graded wrong`).toBe(
        true,
      );
    }
    expect(checked, 'every draw was on the deviation side').toBeGreaterThan(5);
  });

  /**
   * B2. The action bar is built from the legal actions for the hand, but the
   * item is asked under a ctx of the draw's choosing. An action the ctx
   * excludes can never be the graded-correct answer -- offering it is a
   * button that is always wrong, and 16 v 10 at TC -2 on the DEFAULT profile
   * lit Surrender while the quiz graded `hit`.
   */
  it('never grades an answer the item could not have been asked with', () => {
    for (const rules of [
      { ...DEFAULT_RULES, surrenderIndices: false },
      { ...DEFAULT_RULES, surrenderIndices: true },
    ]) {
      for (let seed = 1; seed <= 200; seed += 1) {
        const item = drawQuizItem(seed, undefined, rules, 40);
        if (!item.cards) continue;
        const ctx = quizCtxFor(item, rules);
        const offered = drillLegalActions(item.cards, rules, item.up).filter(
          (a) => ctx.canSurrender || a !== 'surrender',
        );
        expect(
          offered,
          `seed ${seed}: the correct answer is ${item.correct}, which is not on offer`,
        ).toContain(item.correct);
      }
    }
  });

  /**
   * B3. "No index applies here -- basic strategy" is a claim, and
   * `isBasicOnly` is the only thing behind it. It asked with surrender
   * unavailable, where a Fab 4 index can never fire, so the cells that carry
   * one passed: 16 v 8 at TC +6 -- the highest-value surrender index there
   * is -- was presented under that sentence with `hit` graded correct.
   */
  it('puts no index-bearing cell behind "no index applies"', () => {
    const rules = { ...DEFAULT_RULES, surrenderIndices: true };
    const ctxOn = { canDouble: true, canSplit: true, canSurrender: true };
    let checked = 0;
    const wrong: string[] = [];
    for (let seed = 1; seed <= 400; seed += 1) {
      const item = drawQuizItem(seed, '16v9', rules, 100);
      if (!item.isDistractor || !item.cards) continue;
      checked += 1;
      const played = correctPlay(item.cards, item.up, item.tc, ctxOn, rules);
      if (played.source !== 'basic') {
        wrong.push(`tc=${item.tc} v ${item.up}: ${played.reason ?? played.source}`);
      }
    }
    expect(checked, 'no distractor was drawn, so this proves nothing').toBeGreaterThan(20);
    expect(
      wrong.slice(0, 5),
      `distractors sit on live index cells: ${wrong.slice(0, 5).join('; ')}`,
    ).toEqual([]);
  });
});

/* ---------------------------------------------------------------------- */
/* F4: the quiz has to be able to grade a self-check, like the flashcards  */
/* ---------------------------------------------------------------------- */

describe('a quiz item answered by self-report', () => {
  const RULES = { ...DEFAULT_RULES, surrenderIndices: true };

  /**
   * The wheel has two buttons and a quiz answer is a five-way choice, so the
   * wheel cannot state a play. What it can run is the shape the count drills
   * and the flashcards already use -- say the right play, ask whether you had
   * it -- and THAT answer is binary.
   *
   * `buildFlashcardEvent` has had the two self-report markers since that
   * shape shipped. `buildQuizEvent` sent everything that is not a timeout
   * into `classifyAction`, which asks which of the five plays was chosen:
   * `'self-report-had'` cast to an Action, graded as a basic error, and
   * written into Stats and the review deck as a play nobody made.
   */
  it('scores "I had it" as correct without inventing a play', () => {
    const item = drawQuizItem(7, '16v10', RULES);
    const event = buildQuizEvent(item, SELF_REPORT_HAD, RULES, 1000);
    expect(event.correct).toBe(true);
    expect(event.classification).toBe('correct');
    expect(event.taken).toBe(SELF_REPORT_HAD);
    expect(event.evCost, 'a self-report was priced as a misplay').toBeUndefined();
  });

  it('scores "I missed it" as wrong, and says which kind of answer it was', () => {
    const item = drawQuizItem(7, '16v10', RULES);
    const event = buildQuizEvent(item, SELF_REPORT_MISSED, RULES, 1000);
    expect(event.correct).toBe(false);
    // Not 'basic-error': the taxonomy is about which play was chosen, and no
    // play was. The flashcard path has called this 'self-report' since it
    // shipped and the two must agree -- Stats mixes them in one table.
    expect(event.classification).toBe('self-report');
  });

  it('does the same on an insurance item, which is the one with no hand', () => {
    const item = drawQuizItem(3, 'ins', RULES);
    expect(item.cards, 'this seed did not draw the insurance item').toBeNull();
    expect(buildQuizEvent(item, SELF_REPORT_HAD, RULES, 1000).correct).toBe(true);
    const missed = buildQuizEvent(item, SELF_REPORT_MISSED, RULES, 1000);
    expect(missed.correct).toBe(false);
    expect(missed.classification).toBe('self-report');
  });
});

describe('#27 a fallback flashcard grades under its ctx', () => {
  it('hard 11 v 5 as 2,4,5: hit is right, the event says so', () => {
    const card: Flashcard = {
      cards: [
        { rank: '2', suit: 's' },
        { rank: '4', suit: 'h' },
        { rank: '5', suit: 'd' },
      ],
      up: '5',
      correct: 'hit',
      cellId: 'hard-11-v-5',
      ctx: { canDouble: false, canSplit: false, canSurrender: false },
    };
    const hit = buildFlashcardEvent(card, 'hit', DEFAULT_RULES, 100);
    expect(hit.correct).toBe(true);
    expect(hit.correctAction).toBe('hit');
    expect(buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 100).correct).toBe(false);
  });

  it('8,8 v A with surrender off (Rp): split is right', () => {
    const card: Flashcard = {
      cards: [
        { rank: '8', suit: 's' },
        { rank: '8', suit: 'h' },
      ],
      up: 'A',
      correct: 'split',
      cellId: 'pair-8-v-A',
      ctx: { canDouble: true, canSplit: true, canSurrender: false },
    };
    expect(buildFlashcardEvent(card, 'split', DEFAULT_RULES, 100).correct).toBe(true);
    expect(buildFlashcardEvent(card, 'surrender', DEFAULT_RULES, 100).correct).toBe(false);
  });
});

describe('#53 a With-count flashcard grades at its TC', () => {
  const NO_LS = { ...DEFAULT_RULES, ls: false };
  const card = (tc: number): Flashcard => ({
    cards: [
      { rank: '10', suit: 's' },
      { rank: '6', suit: 'h' },
    ],
    up: '10',
    correct: tc >= 0 ? 'stand' : 'hit',
    cellId: 'hard-16-v-10',
    tc,
  });
  it('16 v 10 at TC +1: stand is right and counts toward the index; hit is a missed deviation', () => {
    const right = buildFlashcardEvent(card(1), 'stand', NO_LS, 100);
    expect(right.correct).toBe(true);
    expect(right.event.tc).toBe(1);
    expect(right.event.deviationId).toBe('16v10');
    const wrong = buildFlashcardEvent(card(1), 'hit', NO_LS, 100);
    expect(wrong.event.classification).toBe('missed-deviation');
  });
  it('16 v 10 at TC -2: standing is a phantom deviation', () => {
    const ev = buildFlashcardEvent(card(-2), 'stand', NO_LS, 100);
    expect(ev.correct).toBe(false);
    expect(ev.event.classification).toBe('phantom-deviation');
    // R9 (#8): filed under the index it reached for, like the quiz files it.
    expect(ev.event.deviationId).toBe('16v10');
  });
  it('a card without a TC records no deviation even where the engine applies one at 0', () => {
    const { tc: _tc, ...noCount } = card(0);
    void _tc;
    const ev = buildFlashcardEvent(noCount, 'stand', NO_LS, 100);
    expect(ev.event.tc).toBe(0);
    expect(ev.event.deviationId).toBeUndefined();
  });
});

describe('Wave A (s01): plain flashcards never say phantom deviation', () => {
  it('7,5 v 3 Stand with no count is a basic error, priced; with a count it stays phantom', () => {
    const plain = { cards: [{ rank: '7', suit: 's' }, { rank: '5', suit: 's' }], up: '3', correct: 'hit', cellId: 'hard-12-v-3' } as unknown as Flashcard;
    const e = buildFlashcardEvent(plain, 'stand', DEFAULT_RULES, 1000).event;
    expect(e.classification).toBe('basic-error');
    expect(e.evCost).toBeTypeOf('number');
    const counted = { ...plain, tc: 0 } as Flashcard;
    expect(buildFlashcardEvent(counted, 'stand', DEFAULT_RULES, 1000).event.classification).toBe('phantom-deviation');
  });
});

describe('Wave A review: a With-count card on a chart that already plays the index', () => {
  // 2D S17: basic doubles 9 v 2 at every count, so "9 v 2: double at TC >= +1"
  // is not an index here (the quiz leaves it out too).
  const TWO_D = { ...DEFAULT_RULES, decks: 2 as const, s17: true, ls: false };
  const nineVTwo = (tc: number): Flashcard => ({
    cards: [
      { rank: '5', suit: 's' },
      { rank: '4', suit: 'h' },
    ],
    up: '2',
    correct: 'double',
    cellId: 'hard-9-v-2',
    tc,
  });
  it('past the 6-deck threshold the answer carries no index id, so it is reviewed as the basic cell', () => {
    const right = buildFlashcardEvent(nineVTwo(2), 'double', TWO_D, 100);
    expect(right.correct).toBe(true);
    expect(right.event.deviationId).toBeUndefined();
    const wrong = buildFlashcardEvent(nineVTwo(2), 'hit', TWO_D, 100);
    expect(wrong.event.deviationId).toBeUndefined();
    expect(wrong.event.classification).toBe('basic-error');
  });
  it('6D keeps the index', () => {
    const six = { ...TWO_D, decks: 6 as const };
    expect(buildFlashcardEvent(nineVTwo(2), 'double', six, 100).event.deviationId).toBe('9v2');
  });
});

describe('gradeIndexTestAnswer', () => {
  it('reviews the index in the quiz deck and tallies perIndex, not a chart cell', () => {
    // The SR decks live in window.localStorage, not the persist layer
    // freshStorage() swaps, so node needs a window for this assertion to bite.
    const ls = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) } });
    try {
      const rules = { ...DEFAULT_RULES };
      const dev = indexTestSet(rules).find((d) => d.id === '16v10')!;
      const item = indexTestItemFor(dev, rules, mulberry32(4));
      const r = gradeIndexTestAnswer(item, 0, {}, NOW);
      expect(r.correct).toBe(true);
      expect(r.nextDeck['16v10']?.reviews).toBe(1);
      expect(r.nextDeck['16v10']?.paceMs).toBeUndefined();
      expect(loadQuizSr()['16v10']?.reviews).toBe(1);
      const stats = loadStats();
      expect(stats.perIndex['16v10']).toEqual({ right: 1, wrong: 0 });
      expect(Object.keys(stats.cellStats ?? {})).toEqual([]);
      expect(ls.has(FLASH_SR_KEY)).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * R9 (#8, #25): an index answer is index knowledge. A With-count phantom
 * deviation (stand on 16 v 10 below its index) is filed under that index, like
 * the Deviation quiz files the same miss, and never charged to the basic cell
 * or the hard-totals category.
 */
describe('R9: With-count phantom deviations are index answers', () => {
  const NO_LS = { ...DEFAULT_RULES, ls: false };
  const sixteenVTen = (tc: number) => ({ ...flash([H('10'), H('6')], '10', 'hard-16-v-10', 'hit'), tc });

  it('a Stand on 16 v 10 at TC −1 carries the index it deviated toward', () => {
    const { event } = buildFlashcardEvent(sixteenVTen(-1), 'stand', NO_LS, 900);
    expect(event.classification).toBe('phantom-deviation');
    expect(event.deviationId).toBe('16v10');
  });

  it('a plain basic error on the same card carries no index', () => {
    const { event } = buildFlashcardEvent(sixteenVTen(-1), 'double', NO_LS, 900);
    expect(event.classification).not.toBe('phantom-deviation');
    expect(event.deviationId).toBeUndefined();
  });

  it('the miss lands in perIndex only: no cell tally, no hard-category tally', () => {
    const { event } = buildFlashcardEvent(sixteenVTen(-1), 'stand', NO_LS, 900);
    const s = applyEvents(EMPTY_STATS, [event]);
    expect(s.perIndex['16v10']).toEqual({ right: 0, wrong: 1 });
    expect(s.cellStats?.['hard-16-v-10']).toBeUndefined();
    expect(s.categories.hard).toEqual({ right: 0, wrong: 0 });
  });

  it('grading it reviews the index in the quiz deck and leaves the flash deck alone', () => {
    const ls = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) } });
    try {
      const r = gradeFlashcardAnswer(sixteenVTen(-1), 'stand', NO_LS, 900, {}, NOW);
      expect(r.event.correct).toBe(false);
      expect(r.nextDeck['hard-16-v-10']).toBeUndefined();
      expect(loadQuizSr()['16v10']?.reviews).toBe(1);
      expect(ls.has(FLASH_SR_KEY)).toBe(false);
      expect(loadStats().cellStats?.['hard-16-v-10']).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('R9: Index-test answers never count toward basic-strategy categories', () => {
  it('a hard-total index answer moves perIndex, not categories.hard', () => {
    const ls = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v) } });
    try {
      const rules = { ...DEFAULT_RULES };
      for (const id of ['16v10', '12v3', 'TTv5'] as const) {
        const dev = indexTestSet(rules).find((d) => d.id === id)!;
        gradeIndexTestAnswer(indexTestItemFor(dev, rules, mulberry32(4)), 0, {}, NOW);
      }
      const stats = loadStats();
      expect(stats.categories.hard).toEqual({ right: 0, wrong: 0 });
      expect(stats.categories.pairs).toEqual({ right: 0, wrong: 0 });
      expect(Object.keys(stats.perIndex).sort()).toEqual(['12v3', '16v10', 'TTv5']);
      // #25: no "answers from before per-hand tracking" on a fresh profile.
      expect(handCategoryProgress(stats).every((c) => !c.legacy)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/**
 * R9's scope was first the Index test and With-count index/phantom answers,
 * with the Deviation quiz still counting in its hand category. H1 (wave H):
 * a real-index quiz answer is index knowledge too -- four 16 v 10 misses at
 * TC +3 showed Home "0% accuracy" on a profile whose 16 v 10 cell was 30/0.
 * Drills that count graded answers read `bySource`, which still counts them.
 * A distractor is a basic-strategy question and keeps counting.
 */
describe('H1: a Deviation-quiz index answer is index-only', () => {
  const ITEM: QuizItem = {
    cards: [H('10'), H('6')],
    up: '10',
    tc: 3,
    deviationId: '16v10',
    isDeviationSide: true,
    correct: 'stand',
    label: '16 v 10: stand at TC ≥ 0',
    isDistractor: false,
  };

  it('a 16 v 10 quiz miss leaves categories.hard unchanged and bumps perIndex', () => {
    const event = buildQuizEvent(ITEM, 'hit', DEFAULT_RULES, 100);
    expect(event.category).toBe('hard');
    expect(event.indexOnly).toBe(true);
    const seeded = { ...EMPTY_STATS, categories: { ...EMPTY_STATS.categories, hard: { right: 30, wrong: 0 } } };
    const s = applyEvents(seeded, [event, event, event, event]);
    expect(s.categories.hard).toEqual({ right: 30, wrong: 0 });
    expect(s.perIndex['16v10']).toEqual({ right: 0, wrong: 4 });
    // The quiz's own tally (Stats > Drills, double-tap specs) still counts it.
    expect(s.bySource?.quiz?.hard).toEqual({ right: 0, wrong: 4 });
  });

  it('an insurance quiz answer is index-only: perIndex.ins only, never categories (fix round)', () => {
    const ins: QuizItem = { cards: null, up: 'A', tc: 4, deviationId: 'ins', isDeviationSide: true, correct: 'take-insurance', label: 'Insurance', isDistractor: false } as QuizItem;
    const event = buildQuizEvent(ins, 'decline-insurance', DEFAULT_RULES, 100);
    expect(event.indexOnly).toBe(true);
    const seeded = { ...EMPTY_STATS, categories: { ...EMPTY_STATS.categories, hard: { right: 30, wrong: 0 } } };
    const s = applyEvents(seeded, [event, event, event, event]);
    expect(s.categories.insurance).toEqual({ right: 0, wrong: 0 });
    expect(s.perIndex.ins).toEqual({ right: 0, wrong: 4 });
    expect(s.bySource?.quiz?.insurance).toEqual({ right: 0, wrong: 4 });
    // Home's accuracy reads categories: still 100% over 30 decisions.
    const r = readiness(s);
    expect(r.accuracyPct).toBe(100);
    expect(r.decisions).toBe(30);
    expect(r.indexAnswers).toBe(4);
  });

  it('an Index-test insurance answer stays out of categories too (it had leaked since R9)', () => {
    const rules = { ...DEFAULT_RULES };
    const dev = indexTestSet(rules).find((d) => d.id === 'ins')!;
    const event = buildIndexTestEvent(indexTestItemFor(dev, rules, mulberry32(4)), 0);
    expect(event.category).toBe('insurance');
    expect(event.indexOnly).toBe(true);
    const s = applyEvents(EMPTY_STATS, [event]);
    expect(s.categories.insurance).toEqual({ right: 0, wrong: 0 });
    expect((s.perIndex.ins?.right ?? 0) + (s.perIndex.ins?.wrong ?? 0)).toBe(1);
    expect(readiness(s).decisions).toBe(0);
  });

  it('a distractor (no deviationId) still counts in its hand category', () => {
    const distractor: QuizItem = { ...ITEM, tc: -3, deviationId: undefined, isDeviationSide: false, correct: 'hit', isDistractor: true };
    const event = buildQuizEvent(distractor, 'stand', DEFAULT_RULES, 100);
    expect(event.indexOnly).toBeUndefined();
    expect(applyEvents(EMPTY_STATS, [event]).categories.hard).toEqual({ right: 0, wrong: 1 });
  });

  it('Index-test and With-count index events are marked index-only', () => {
    const rules = { ...DEFAULT_RULES };
    const dev = indexTestSet(rules).find((d) => d.id === '16v10')!;
    expect(buildIndexTestEvent(indexTestItemFor(dev, rules, mulberry32(4)), 0).indexOnly).toBe(true);
    const NO_LS = { ...DEFAULT_RULES, ls: false };
    const card = { ...flash([H('10'), H('6')], '10', 'hard-16-v-10', 'hit'), tc: -1 };
    expect(buildFlashcardEvent(card, 'stand', NO_LS, 900).event.indexOnly).toBe(true);
  });

  it('a With-count card that HITS its index is index-only too (not just a phantom)', () => {
    const NO_LS = { ...DEFAULT_RULES, ls: false };
    const card = { ...flash([H('10'), H('6')], '10', 'hard-16-v-10', 'hit'), tc: 2 };
    const { event } = buildFlashcardEvent(card, 'stand', NO_LS, 900);
    expect(event.deviationId).toBe('16v10');
    const s = applyEvents(EMPTY_STATS, [event]);
    expect(s.categories.hard).toEqual({ right: 0, wrong: 0 });
    expect(s.perIndex['16v10']).toEqual({ right: 1, wrong: 0 });
  });
});
