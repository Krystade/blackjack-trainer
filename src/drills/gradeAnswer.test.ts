import { describe, it, expect, beforeEach } from 'vitest';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import {
  buildFlashcardEvent,
  buildQuizEvent,
  gradeFlashcardAnswer,
  gradeQuizAnswer,
} from './gradeAnswer';
import type { SrDeck } from './spacedRepetition';
import { _setStorage, loadStats } from '../store/persist';
import { EMPTY_STATS } from '../store/types';
import { applyEvents } from '../store/stats';
import { DEFAULT_RULES } from '../engine/ruleset';

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
});
