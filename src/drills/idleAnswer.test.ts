import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '../engine/ruleset';
import { drawFlashcard } from './flashcards';
import { drawQuizItem } from './deviationQuiz';
import {
  buildFlashcardEvent,
  buildQuizEvent,
  gradeFlashcardAnswer,
  gradeQuizAnswer,
  TIMEOUT_ANSWER,
} from './gradeAnswer';
import { IDLE_ANSWER_MS, trackedElapsedMs } from './idleAnswer';

describe('#30 idle answers', () => {
  it('keeps timing up to the cap, drops it past, and never for a timeout', () => {
    expect(IDLE_ANSWER_MS).toBe(30_000);
    expect(trackedElapsedMs(30_000, false)).toBe(30_000);
    expect(trackedElapsedMs(30_001, false)).toBeUndefined();
    expect(trackedElapsedMs(45_000, true)).toBe(45_000);
    expect(trackedElapsedMs(undefined, false)).toBeUndefined();
  });

  it('a slow flashcard answer is graded but its event carries no elapsedMs', () => {
    const card = drawFlashcard('all', {}, 0, 12345, DEFAULT_RULES);
    const slow = buildFlashcardEvent(card, card.correct, DEFAULT_RULES, 31_000);
    expect(slow.correct).toBe(true);
    expect('elapsedMs' in slow.event).toBe(false);
    expect(buildFlashcardEvent(card, card.correct, DEFAULT_RULES, 2_000).event.elapsedMs).toBe(2_000);
    // A shot-clock timeout is not idle.
    expect(buildFlashcardEvent(card, TIMEOUT_ANSWER, DEFAULT_RULES, 31_000).event.elapsedMs).toBe(31_000);
  });

  it('a slow quiz answer is graded but untimed, insurance included', () => {
    const item = drawQuizItem(1, '16v10', DEFAULT_RULES);
    const ev = buildQuizEvent(item, item.correct, DEFAULT_RULES, 60_000);
    expect(ev.correct).toBe(true);
    expect('elapsedMs' in ev).toBe(false);
    const ins = drawQuizItem(1, 'ins', DEFAULT_RULES);
    expect('elapsedMs' in buildQuizEvent(ins, ins.correct, DEFAULT_RULES, 60_000)).toBe(false);
  });

  it('a slow answer still moves spaced repetition', () => {
    const card = drawFlashcard('all', {}, 0, 12345, DEFAULT_RULES);
    const res = gradeFlashcardAnswer(card, card.correct, DEFAULT_RULES, 31_000, {}, 1_000);
    expect(res.event.correct).toBe(true);
    expect(res.nextDeck[card.cellId]?.box).toBe(1);
    expect(res.nextDeck[card.cellId]?.paceMs).toBeUndefined();

    const item = drawQuizItem(1, '16v10', DEFAULT_RULES);
    const q = gradeQuizAnswer(item, item.correct, DEFAULT_RULES, 31_000, {}, 1_000);
    expect(q.nextDeck['16v10']?.reviews).toBe(1);
    expect('elapsedMs' in q.event).toBe(false);
  });
});
