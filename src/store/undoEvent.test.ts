import { describe, it, expect, beforeEach } from 'vitest';
import { undoGradedEvent, recordMisclick } from './undoEvent';
import { applyEvents } from './stats';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';
import type { GradedEvent } from '../engine/grade';
import { _setStorage, loadStats } from './persist';
import { gradeFlashcardAnswer, gradeQuizAnswer, gradeMasteryAnswer } from '../drills/gradeAnswer';
import { generateAllCells } from '../drills/flashcards';
import type { Flashcard } from '../drills/flashcards';
import type { QuizItem } from '../drills/deviationQuiz';
import { drawQuizItem } from '../drills/deviationQuiz';
import { DEFAULT_RULES } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';
import { restoreSrCard, LEARNED_BOX, BOX_INTERVALS_MS } from '../drills/spacedRepetition';
import type { SrDeck } from '../drills/spacedRepetition';

/**
 * #22 "Wrong tap": undoing an event must leave Stats exactly as if the
 * answer had never been given. Every branch `applyEvents` writes is
 * exercised, on a blob that already holds unrelated history, so a test
 * passes only if the undo removes the right row rather than any row.
 */

function busyStats(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.categories.hard = { right: 7, wrong: 3 };
  s.categories.pairs = { right: 2, wrong: 1 };
  s.perIndex = { '16v10': { right: 4, wrong: 2 } };
  s.mistakes['basic-error'] = 3;
  s.latencyHistory.push(
    { category: 'hard', elapsedMs: 1200, date: '2026-10-01T00:00:00.000Z' },
    { category: 'pairs', elapsedMs: 900 },
  );
  s.evCost.history.push({ category: 'hard', hand: 'hard-16-v-10', taken: 'stand', expected: 'hit', units: 0.03 });
  s.retention.history.push({ date: '2026-10-01T00:00:00.000Z', key: 'hard-16-v-10', box: 2, gapMs: 5, correct: true });
  s.countDrill.history.push({ date: '2026-10-01', cards: 52, intervalMs: 700, correct: true });
  return s;
}

const wrongFlash: GradedEvent = {
  kind: 'action',
  source: 'flashcard',
  category: 'hard',
  correct: false,
  classification: 'basic-error',
  taken: 'stand',
  expected: 'hit',
  reason: 'Basic hit vs dealer 10',
  tc: 0,
  hand: 'hard-16-v-10',
  elapsedMs: 1500,
  evCost: 0.03,
  underShotClock: true,
  at: '2026-10-14T10:00:00.000Z',
};

const wrongQuiz: GradedEvent = {
  kind: 'action',
  source: 'quiz',
  category: 'hard',
  correct: false,
  classification: 'missed-deviation',
  taken: 'hit',
  expected: 'stand',
  reason: '16 v 10: stand at TC 0+',
  deviationId: '16v10',
  tc: 1,
  hand: '16 v 10',
  elapsedMs: 2100,
  underShotClock: false,
  at: '2026-10-14T10:00:01.000Z',
};

const correctMastery: GradedEvent = {
  kind: 'action',
  source: 'mastery',
  category: 'pairs',
  correct: true,
  classification: 'correct',
  taken: 'split',
  expected: 'split',
  reason: 'Basic split',
  tc: 0,
  hand: 'pair-8-v-10',
  at: '2026-10-14T10:00:02.000Z',
};

const wrongTableIndex: GradedEvent = {
  kind: 'action',
  source: 'table',
  category: 'hard',
  correct: false,
  classification: 'missed-deviation',
  taken: 'hit',
  expected: 'stand',
  reason: '16 v 10: stand at TC 0+',
  deviationId: '16v10',
  tc: 1,
  hand: '16 v 10',
  evCost: 0.02,
};

describe('undoGradedEvent is the inverse of applyEvents for one event', () => {
  for (const [name, event] of [
    ['a wrong flashcard (latency, EV cost, shot clock, new source bucket)', wrongFlash],
    ['a wrong quiz answer (perIndex, untimed shot-clock bucket)', wrongQuiz],
    ['a correct, untimed mastery answer', correctMastery],
    ['D-R2: a wrong table index play (table-only tallies, sourced EV row)', wrongTableIndex],
  ] as const) {
    it(`${name}: on a busy blob`, () => {
      const before = busyStats();
      expect(undoGradedEvent(applyEvents(before, [event]), event)).toEqual(before);
    });

    it(`${name}: on an empty blob`, () => {
      const before = structuredClone(EMPTY_STATS);
      expect(undoGradedEvent(applyEvents(before, [event]), event)).toEqual(before);
    });

    it(`${name}: after other events, removing only its own trace`, () => {
      const others = applyEvents(busyStats(), [wrongQuiz, correctMastery, wrongFlash, wrongTableIndex].filter((e) => e !== event));
      expect(undoGradedEvent(applyEvents(others, [event]), event)).toEqual(others);
    });
  }

  it('keeps a perIndex entry or source bucket that still holds other answers', () => {
    const once = applyEvents(structuredClone(EMPTY_STATS), [wrongQuiz]);
    const twice = applyEvents(once, [wrongQuiz]);
    expect(undoGradedEvent(twice, wrongQuiz)).toEqual(once);
  });

  it('removes the matching latency row, not merely the last one', () => {
    const applied = applyEvents(busyStats(), [wrongFlash]);
    applied.latencyHistory.push({ category: 'soft', elapsedMs: 400, date: '2026-10-14T10:00:05.000Z' });
    const undone = undoGradedEvent(applied, wrongFlash);
    expect(undone.latencyHistory.map((r) => r.elapsedMs)).toEqual([1200, 900, 400]);
  });

  it('does not mutate its input', () => {
    const applied = applyEvents(busyStats(), [wrongFlash]);
    const snapshot = JSON.stringify(applied);
    undoGradedEvent(applied, wrongFlash);
    expect(JSON.stringify(applied)).toBe(snapshot);
  });
});

describe('recordMisclick', () => {
  it('undoes the event and counts the misclick', () => {
    const before = busyStats();
    const after = recordMisclick(applyEvents(before, [wrongFlash]), wrongFlash);
    expect(after).toEqual({ ...before, misclicks: 1 });
  });

  it('adds to an existing misclick count', () => {
    const before = { ...busyStats(), misclicks: 4 };
    expect(recordMisclick(applyEvents(before, [wrongFlash]), wrongFlash).misclicks).toBe(5);
  });

  it('removes the retention row the same answer wrote, and no other', () => {
    const before = busyStats();
    const applied = applyEvents(before, [wrongFlash]);
    applied.retention = {
      history: [
        ...applied.retention.history,
        { date: wrongFlash.at!, key: 'hard-16-v-10', box: 3, gapMs: 99, correct: false },
      ],
    };
    expect(recordMisclick(applied, wrongFlash)).toEqual({ ...before, misclicks: 1 });
  });
});

describe('through the real grade path', () => {
  const NOW = 1_700_000_000_000;

  function freshStorage() {
    const map = new Map<string, string>();
    _setStorage({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    });
  }

  beforeEach(freshStorage);

  function cardFor(id: string): Flashcard {
    const cell = generateAllCells().find((c) => c.id === id)!;
    const correct = correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action;
    return { cards: cell.cards, up: cell.up, correct, cellId: cell.id };
  }

  it('a wrong flashcard on a gap review: Stats and the SR card both go back', () => {
    const card = cardFor('hard-16-v-10');
    // A learned card, due now: grading it writes a retention row.
    const prev = { box: LEARNED_BOX, dueAt: NOW - 1, lastSeenAt: NOW - BOX_INTERVALS_MS[LEARNED_BOX]!, lapses: 0, reviews: 3 };
    const deck: SrDeck = { 'hard-12-v-2': { ...prev, box: 4 }, [card.cellId]: prev };
    const statsBefore = loadStats();

    const wrong = card.correct === 'stand' ? 'hit' : 'stand';
    const graded = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 1800, deck, NOW, undefined, true);
    expect(loadStats().retention.history).toHaveLength(1);
    expect(graded.nextDeck[card.cellId]).not.toEqual(prev);

    expect(recordMisclick(loadStats(), graded.event)).toEqual({ ...statsBefore, misclicks: 1 });
    expect(restoreSrCard(graded.nextDeck, card.cellId, prev)).toEqual(deck);
  });

  it('a never-seen flashcard leaves the deck again', () => {
    const card = cardFor('pair-8-v-10');
    const graded = gradeFlashcardAnswer(card, 'stand', DEFAULT_RULES, 1000, {}, NOW);
    expect(restoreSrCard(graded.nextDeck, card.cellId, undefined)).toEqual({});
  });

  it('a wrong quiz answer', () => {
    const item: QuizItem = drawQuizItem(7, '16v10', DEFAULT_RULES, 0, {}, NOW);
    const statsBefore = loadStats();
    const wrong = item.correct === 'stand' ? 'hit' : 'stand';
    const graded = gradeQuizAnswer(item, wrong, DEFAULT_RULES, 2500, {}, NOW);
    expect(graded.event.correct).toBe(false);
    expect(recordMisclick(loadStats(), graded.event)).toEqual({ ...statsBefore, misclicks: 1 });
  });

  it('a wrong mastery answer', () => {
    const card = cardFor('soft-18-v-9');
    const statsBefore = loadStats();
    const wrong = card.correct === 'stand' ? 'double' : 'stand';
    const graded = gradeMasteryAnswer(card, wrong, DEFAULT_RULES, 900, NOW);
    expect(graded.event.correct).toBe(false);
    expect(recordMisclick(loadStats(), graded.event)).toEqual({ ...statsBefore, misclicks: 1 });
  });
});
