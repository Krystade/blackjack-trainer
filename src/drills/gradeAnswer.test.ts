import { describe, it, expect, beforeEach } from 'vitest';
import { drawFlashcard, generateAllCells } from './flashcards';
import type { Flashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import type { QuizItem } from './deviationQuiz';
import {
  buildFlashcardEvent,
  buildQuizEvent,
  gradeFlashcardAnswer,
  gradeQuizAnswer,
  gradeMasteryAnswer,
  loadFlashSr,
} from './gradeAnswer';
import type { SrDeck } from './spacedRepetition';
import { _setStorage, loadStats } from '../store/persist';
import { EMPTY_STATS } from '../store/types';
import { applyEvents } from '../store/stats';
import { DEFAULT_RULES } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';
import type { Card, Rank } from '../engine/cards';
import type { Action } from '../engine/deviations';

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

    it('gradeFlashcardAnswer: a miss schedules the cell due-now at box 0; a correct answer promotes it to box 1 (SR)', () => {
      const card = drawFlashcard('all', {}, 0, 777, DEFAULT_RULES);
      const wrong = card.correct === 'stand' ? 'hit' : 'stand';

      const missed = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 10, {}, NOW);
      expect(missed.event.correct).toBe(false);
      expect(missed.nextDeck[card.cellId].box).toBe(0);
      expect(missed.nextDeck[card.cellId].dueAt).toBe(NOW); // box-0 interval is 0 -> due now

      const recovered = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 10, missed.nextDeck, NOW);
      expect(recovered.event.correct).toBe(true);
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
      const result = gradeMasteryAnswer(card, 'hit', DEFAULT_RULES, 200);
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
    const card = flash([H('10'), H('2')], '4', 'hard-12-v-4', 'stand');
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
