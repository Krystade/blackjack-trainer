import { describe, it, expect, beforeEach } from 'vitest';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import {
  buildFlashcardEvent,
  buildQuizEvent,
  gradeFlashcardAnswer,
  gradeQuizAnswer,
} from './gradeAnswer';
import { _setStorage, loadStats } from '../store/persist';
import { EMPTY_STATS } from '../store/types';
import { applyEvents } from '../store/stats';
import { DEFAULT_RULES } from '../engine/ruleset';

/**
 * R4 anti-drift guard (docs/BACKLOG.md): the mixed-session view and the two
 * standalone drill views (FlashcardsView / DeviationQuizView in Drills.tsx)
 * grade through ONE implementation -- the wrappers in gradeAnswer.ts. These
 * tests pin that implementation so a "mixed-mode flashcard/quiz item produces
 * the byte-identical GradedEvent + Stats write as the standalone drill for the
 * same seed/hand" is guaranteed by construction: given identical inputs the
 * function is deterministic, and BOTH call sites pass identical inputs.
 *
 * An injected in-memory storage isolates each test's Stats write so the
 * loadStats() assertions read exactly what the graded event produced.
 */
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
      // Both the standalone FlashcardsView and the mixed view draw a card and
      // feed it to buildFlashcardEvent; for the SAME seed/hand + answer they
      // must produce identical events. elapsedMs is passed in (captured by the
      // component) so the pure builder stays deterministic.
      const card = drawFlashcard('all', {}, 12345, DEFAULT_RULES);
      const standalone = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 111);
      const mixed = buildFlashcardEvent(card, 'stand', DEFAULT_RULES, 111);
      expect(mixed).toEqual(standalone);
      // Spot-check the event shape a flashcard must always carry.
      expect(standalone.event.kind).toBe('action');
      expect(standalone.event.tc).toBe(0); // flashcards are ALWAYS count-free
      expect(standalone.event.reason).toBe(card.cellId);
      expect(standalone.event.elapsedMs).toBe(111);
    });

    it('gradeFlashcardAnswer: identical inputs -> identical event, correctAction, nextWeights, AND Stats write', () => {
      const card = drawFlashcard('all', {}, 424242, DEFAULT_RULES);

      freshStorage();
      const a = gradeFlashcardAnswer(card, 'hit', DEFAULT_RULES, 250, {});
      const statsAfterA = loadStats();

      freshStorage();
      const b = gradeFlashcardAnswer(card, 'hit', DEFAULT_RULES, 250, {});
      const statsAfterB = loadStats();

      expect(b.event).toEqual(a.event);
      expect(b.correctAction).toEqual(a.correctAction);
      expect(b.nextWeights).toEqual(a.nextWeights);
      expect(statsAfterB).toEqual(statsAfterA);

      // The persisted Stats write is exactly applyEvents(EMPTY, [event]) --
      // the same thing the standalone view writes.
      expect(statsAfterA).toEqual(applyEvents(EMPTY_STATS, [a.event]));
    });

    it('gradeFlashcardAnswer: a miss bumps the cell weight, a correct answer decays it (R3 preserved)', () => {
      const card = drawFlashcard('all', {}, 777, DEFAULT_RULES);
      const wrong = card.correct === 'stand' ? 'hit' : 'stand';

      const missed = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 10, {});
      expect(missed.event.correct).toBe(false);
      expect(missed.nextWeights[card.cellId]).toBe(1); // bumpMiss from 0

      const recovered = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 10, missed.nextWeights);
      expect(recovered.event.correct).toBe(true);
      expect(recovered.nextWeights[card.cellId]).toBe(0); // decayMiss back to floor
    });
  });

  describe('deviation quiz', () => {
    it('buildQuizEvent is deterministic: identical inputs -> byte-identical event (mixed == standalone)', () => {
      const item = drawQuizItem(98765, undefined, DEFAULT_RULES);
      const standalone = buildQuizEvent(item, 'stand', DEFAULT_RULES, 222);
      const mixed = buildQuizEvent(item, 'stand', DEFAULT_RULES, 222);
      expect(mixed).toEqual(standalone);
      expect(standalone.elapsedMs).toBe(222);
      // A real quiz item carries its tested index + the count that matters.
      expect(standalone.deviationId).toBe(item.deviationId);
    });

    it('gradeQuizAnswer: identical inputs -> identical event, nextWeights, AND Stats write', () => {
      const item = drawQuizItem(55555, undefined, DEFAULT_RULES);

      freshStorage();
      const a = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 300, {});
      const statsAfterA = loadStats();

      freshStorage();
      const b = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 300, {});
      const statsAfterB = loadStats();

      expect(b.event).toEqual(a.event);
      expect(b.nextWeights).toEqual(a.nextWeights);
      expect(statsAfterB).toEqual(statsAfterA);
      expect(statsAfterA).toEqual(applyEvents(EMPTY_STATS, [a.event]));
    });

    it('gradeQuizAnswer: only real items (with a deviationId) perturb the index weight; distractors never do', () => {
      // Force a distractor (distractorPct 100): it carries no deviationId, so
      // the weight map must be returned unchanged.
      const distractor = drawQuizItem(31000, undefined, DEFAULT_RULES, 100);
      expect(distractor.deviationId).toBeUndefined();
      const before = { '16v10': 3 };
      const graded = gradeQuizAnswer(distractor, distractor.correct, DEFAULT_RULES, 10, before);
      expect(graded.nextWeights).toEqual(before); // untouched
    });
  });

  describe('cross-context byte-identity for the same seed/hand', () => {
    it('a flashcard graded via the shared path writes tc=0 and NO deviationId; a quiz item writes its tc + deviationId -- the discrimination is visible in the telemetry', () => {
      const card = drawFlashcard('all', {}, 246810, DEFAULT_RULES);
      const flashEvent = gradeFlashcardAnswer(card, 'stand', DEFAULT_RULES, 5, {}).event;
      expect(flashEvent.tc).toBe(0);
      expect(flashEvent.deviationId).toBeUndefined();

      const item = drawQuizItem(1357, undefined, DEFAULT_RULES);
      const quizEvent = gradeQuizAnswer(item, 'stand', DEFAULT_RULES, 5, {}).event;
      expect(quizEvent.tc).toBe(item.tc);
      expect(quizEvent.deviationId).toBe(item.deviationId);
    });
  });
});
