import { describe, it, expect, beforeEach } from 'vitest';
import { cellIdForHand, cellIdForEvent, CELL_WINDOW, HAND_WINDOW, countBits, handWindow, judgedAccuracy, judgedTally } from './cellStats';
import { applyEvents } from './stats';
import { undoGradedEvent, recordMisclick } from './undoEvent';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';
import type { GradedEvent } from '../engine/grade';
import { _setStorage, loadStats, saveStats } from './persist';
import { gradeFlashcardAnswer, gradeQuizAnswer, gradeMasteryAnswer } from '../drills/gradeAnswer';
import { generateAllCells } from '../drills/flashcards';
import type { Flashcard } from '../drills/flashcards';
import { drawQuizItem } from '../drills/deviationQuiz';
import { DEFAULT_RULES } from '../engine/ruleset';
import { correctPlay } from '../engine/strategy';

/**
 * B3 (spec 2026-10-13): per-cell accuracy, written wherever graded events are
 * applied, for every hand drill and Play, and withdrawn exactly by Wrong tap.
 */

describe('cellIdForHand', () => {
  it.each([
    ['hard-16-v-10', 'hard-16-v-10'],
    ['pair-A-v-A', 'pair-A-v-A'],
    // Play's table notation, ten-value faces folded into one rank.
    ['9,7 v 10', 'hard-16-v-10'],
    ['10,6 v K', 'hard-16-v-10'],
    ['5,4,7 v 9', 'hard-16-v-9'],
    ['A,6 v 2', 'soft-17-v-2'],
    ['A,5,A v 7', 'soft-17-v-7'],
    ['A,6,9 v 7', 'hard-16-v-7'],
    ['8,8 v A', 'pair-8-v-A'],
    ['K,Q v 5', 'pair-10-v-5'],
    ['A,A v 6', 'pair-A-v-6'],
  ])('%s -> %s', (hand, id) => {
    expect(cellIdForHand(hand)).toBe(id);
  });

  it.each([undefined, '', 'dealer A', '16 v 10', '16 v 10: stand at TC ≥ 0', '8 v 6', 'X,7 v 10'])(
    'names no cell for %s',
    (hand) => {
      expect(cellIdForHand(hand)).toBeNull();
    },
  );

  it('only hand decisions are tallied', () => {
    const insurance: GradedEvent = {
      kind: 'insurance', category: 'insurance', correct: true, classification: 'correct',
      taken: 'take', expected: 'take', reason: '', tc: 3, hand: '10,6 v A',
    };
    expect(cellIdForEvent(insurance)).toBeNull();
  });
});

const flash: GradedEvent = {
  kind: 'action', source: 'flashcard', category: 'hard', correct: false, classification: 'basic-error',
  taken: 'stand', expected: 'hit', reason: 'Basic hit', tc: 0, hand: 'hard-16-v-10',
  at: '2026-10-14T10:00:00.000Z',
};
// Table play: cards in table notation and no `at`.
const play: GradedEvent = {
  kind: 'action', source: 'table', category: 'hard', correct: true, classification: 'correct',
  taken: 'hit', expected: 'hit', reason: 'Basic hit', tc: 1, hand: '9,7 v 10',
};
const playPair: GradedEvent = { ...play, category: 'pairs', taken: 'split', expected: 'split', hand: '8,8 v A' };

describe('applyEvents writes cellStats', () => {
  it('counts a drill answer and a table hand on the same cell', () => {
    const s = applyEvents(structuredClone(EMPTY_STATS), [flash, play, playPair]);
    expect(s.cellStats).toEqual({
      'hard-16-v-10': { right: 1, wrong: 1, lastAt: '2026-10-14T10:00:00.000Z', recent: '01' },
      'pair-8-v-A': { right: 1, wrong: 0, lastAt: '', recent: '1' },
    });
  });

  it('dates an undated (table) event from the caller, and never from nowhere', () => {
    const later = '2026-10-14T11:00:00.000Z';
    const s = applyEvents(applyEvents(structuredClone(EMPTY_STATS), [flash]), [play], later);
    expect(s.cellStats!['hard-16-v-10']).toEqual({ right: 1, wrong: 1, lastAt: later, recent: '01' });
    // No `at` and no fallback: the previous date stands.
    const kept = applyEvents(applyEvents(structuredClone(EMPTY_STATS), [flash]), [play]);
    expect(kept.cellStats!['hard-16-v-10']!.lastAt).toBe(flash.at);
  });

  it('does not mutate its input', () => {
    const before = applyEvents(structuredClone(EMPTY_STATS), [flash]);
    const snapshot = JSON.stringify(before);
    applyEvents(before, [flash, play]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('Wrong tap reverses cellStats exactly', () => {
  function withCells(): Stats {
    const s = structuredClone(EMPTY_STATS);
    s.cellStats = {
      'hard-16-v-10': { right: 4, wrong: 2, lastAt: '2026-10-01T00:00:00.000Z' },
      'soft-18-v-9': { right: 1, wrong: 0, lastAt: '2026-10-02T00:00:00.000Z' },
    };
    return s;
  }

  it('a cell seen before: count AND date restored', () => {
    const before = withCells();
    const cellBefore = before.cellStats!['hard-16-v-10']!;
    expect(undoGradedEvent(applyEvents(before, [flash]), flash, cellBefore)).toEqual(before);
  });

  it('a cell seen for the first time is removed again', () => {
    const before = withCells();
    const event = { ...flash, hand: 'pair-9-v-7', category: 'pairs' as const };
    expect(undoGradedEvent(applyEvents(before, [event]), event, null)).toEqual(before);
  });

  it('a blob with no cellStats at all goes back to having none', () => {
    const before = structuredClone(EMPTY_STATS);
    expect(undoGradedEvent(applyEvents(before, [flash]), flash, null)).toEqual(before);
  });

  it('without the snapshot the count is still reversed', () => {
    const before = withCells();
    const undone = undoGradedEvent(applyEvents(before, [flash]), flash);
    expect(undone.cellStats!['hard-16-v-10']).toMatchObject({ right: 4, wrong: 2 });
  });
});

describe('through the real grade path', () => {
  const NOW = 1_760_000_000_000;

  beforeEach(() => {
    const map = new Map<string, string>();
    _setStorage({
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => {
        map.set(k, v);
      },
    });
    const seeded = loadStats();
    seeded.cellStats = { 'hard-16-v-10': { right: 2, wrong: 5, lastAt: '2026-09-01T00:00:00.000Z' } };
    saveStats(seeded);
  });

  function cardFor(id: string): Flashcard {
    const cell = generateAllCells().find((c) => c.id === id)!;
    const correct = correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action;
    return { cards: cell.cards, up: cell.up, correct, cellId: cell.id };
  }

  it('flashcards tally the cell and Wrong tap puts it back', () => {
    const before = loadStats();
    const card = cardFor('hard-16-v-10');
    const wrong = card.correct === 'stand' ? 'hit' : 'stand';
    const graded = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 1000, {}, NOW);
    expect(loadStats().cellStats!['hard-16-v-10']).toEqual({
      right: 2, wrong: 6, lastAt: new Date(NOW).toISOString(), recent: '0',
    });
    expect(graded.cellBefore).toEqual(before.cellStats!['hard-16-v-10']);
    expect(recordMisclick(loadStats(), graded.event, graded.cellBefore)).toEqual({ ...before, misclicks: 1 });
  });

  it('mastery tallies the cell', () => {
    const before = loadStats();
    const card = cardFor('soft-18-v-9');
    const graded = gradeMasteryAnswer(card, card.correct, DEFAULT_RULES, 900, NOW);
    expect(loadStats().cellStats!['soft-18-v-9']).toEqual({ right: 1, wrong: 0, lastAt: new Date(NOW).toISOString(), recent: '1' });
    expect(graded.cellBefore).toBeNull();
    expect(undoGradedEvent(loadStats(), graded.event, graded.cellBefore)).toEqual(before);
  });

  // Wave A F4: an index question is index knowledge. It goes to perIndex and
  // leaves the basic cell alone (this test pinned the opposite before F4).
  it('a quiz index item leaves the basic cell alone and counts toward the index', () => {
    const before = loadStats();
    const item = drawQuizItem(7, '16v10', DEFAULT_RULES, 0, {}, NOW);
    const wrong = item.correct === 'stand' ? 'hit' : 'stand';
    const graded = gradeQuizAnswer(item, wrong, DEFAULT_RULES, 2500, {}, NOW);
    expect(cellIdForEvent(graded.event)).toBe('hard-16-v-10');
    expect(loadStats().cellStats!['hard-16-v-10']).toEqual(before.cellStats!['hard-16-v-10']);
    expect(loadStats().perIndex['16v10']).toEqual({ right: 0, wrong: 1 });
    expect(graded.cellBefore).toBeNull();
    expect(recordMisclick(loadStats(), graded.event, graded.cellBefore)).toEqual({ ...before, misclicks: 1 });
  });

  it('an off-index (distractor) quiz hand still tallies the dealt cards', () => {
    const item = drawQuizItem(11, undefined, DEFAULT_RULES, 100, {}, NOW);
    expect(item.deviationId).toBeUndefined();
    const graded = gradeQuizAnswer(item, item.correct, DEFAULT_RULES, 2500, {}, NOW);
    const id = cellIdForEvent(graded.event)!;
    expect(id).not.toBeNull();
    expect(loadStats().cellStats![id]!.right).toBeGreaterThanOrEqual(1);
  });

  // Wave A F4b: a With-count card where the index applied is reviewed in the
  // quiz deck under the index; the flash cell's schedule is untouched.
  it('a With-count index card reviews the index, not the flash cell', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    };
    try {
      const base = cardFor('hard-12-v-3');
      const card: Flashcard = { ...base, tc: 3, correct: correctPlay(base.cards, base.up, 3, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action };
      const flashDeck = { 'hard-12-v-3': { box: 3, dueAt: NOW + 1e9, lastSeenAt: NOW - 1e6 } } as never;
      const wrong = card.correct === 'stand' ? 'hit' : 'stand';
      const graded = gradeFlashcardAnswer(card, wrong, DEFAULT_RULES, 1000, flashDeck, NOW);
      expect(graded.event.deviationId).toBeDefined();
      expect(graded.nextDeck).toBe(flashDeck);
      const quiz = JSON.parse(store.get('bjtrainer.quizsr.v1') ?? '{}') as Record<string, unknown>;
      expect(quiz[graded.event.deviationId!]).toBeDefined();
      expect(graded.indexReview?.key).toBe(graded.event.deviationId);
      expect(store.has('bjtrainer.flashsr.v1')).toBe(false);
      expect(loadStats().cellStats!['hard-12-v-3']).toBeUndefined();
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});

describe('W3: recent windows', () => {
  it('each cell is judged on its last CELL_WINDOW results, oldest first', () => {
    let s = structuredClone(EMPTY_STATS);
    for (let i = 0; i < CELL_WINDOW + 3; i++) s = applyEvents(s, [{ ...flash, correct: i < 3 }]);
    const t = s.cellStats!['hard-16-v-10']!;
    // One spare result is kept beyond the judged window (see 'Wrong tap' below).
    expect(t.recent).toBe('1' + '0'.repeat(CELL_WINDOW));
    expect(judgedTally(t, 5)).toEqual({ right: 0, wrong: CELL_WINDOW });
    expect(t.right + t.wrong).toBe(CELL_WINDOW + 3);
  });

  it('each hand type is judged on its last HAND_WINDOW results', () => {
    let s = structuredClone(EMPTY_STATS);
    for (let i = 0; i < HAND_WINDOW + 5; i++) s = applyEvents(s, [play]);
    s = applyEvents(s, [flash, playPair]);
    expect(handWindow(s.handRecent, 'hard')).toBe('1'.repeat(HAND_WINDOW - 1) + '0');
    expect(s.handRecent!.hard).toHaveLength(HAND_WINDOW + 1);
    expect(handWindow(s.handRecent, 'pair')).toBe('1');
    expect(s.handRecent!.soft).toBeUndefined();
  });

  it('judges a cell on its window once it holds 5 results, else on the lifetime tally', () => {
    expect(judgedAccuracy({ right: 2, wrong: 4, lastAt: '', recent: '11111' })).toBe(1);
    expect(judgedAccuracy({ right: 2, wrong: 4, lastAt: '', recent: '1111' })).toBeCloseTo(2 / 6);
    expect(judgedAccuracy({ right: 2, wrong: 4, lastAt: '' })).toBeCloseTo(2 / 6);
    expect(judgedAccuracy(undefined)).toBeUndefined();
  });

  it('Wrong tap restores both windows exactly while they are short', () => {
    const before = applyEvents(structuredClone(EMPTY_STATS), [play, flash, playPair]);
    const cellBefore = before.cellStats!['hard-16-v-10']!;
    expect(undoGradedEvent(applyEvents(before, [flash]), flash, cellBefore)).toEqual(before);
    // Without the snapshot the last result is still dropped.
    const undone = undoGradedEvent(applyEvents(before, [flash]), flash);
    expect(undone.cellStats!['hard-16-v-10']!.recent).toBe(cellBefore.recent);
    expect(undone.handRecent).toEqual(before.handRecent);
  });

  it('Wrong tap restores every judged figure exactly, even once the windows are full', () => {
    // 31 hard results. The hand window's oldest JUDGED result (30th from the
    // end) is a miss on 12 v 3; the 16 v 10 cell's oldest judged result (10th
    // from its end) is a miss too. An undo that lost either would lift it.
    const other: GradedEvent = { ...play, hand: '10,2 v 3' };
    const events: GradedEvent[] = [
      other,
      { ...other, correct: false },
      ...Array.from({ length: 18 }, () => other),
      play,
      { ...play, correct: false },
      ...Array.from({ length: 9 }, () => play),
    ];
    let before = structuredClone(EMPTY_STATS);
    for (const e of events) before = applyEvents(before, [e]);
    expect(handWindow(before.handRecent, 'hard')).toHaveLength(HAND_WINDOW);
    const cellBefore = before.cellStats!['hard-16-v-10']!;
    expect(judgedAccuracy(cellBefore)).toBeCloseTo(0.9);
    expect(countBits(handWindow(before.handRecent, 'hard'))).toEqual({ right: 28, wrong: 2 });

    // With the grader's snapshot (Flashcards, Mastery, the quiz) and without it.
    for (const snapshot of [cellBefore, undefined]) {
      const undone = undoGradedEvent(applyEvents(before, [flash]), flash, snapshot);
      expect(handWindow(undone.handRecent, 'hard')).toBe(handWindow(before.handRecent, 'hard'));
      const cell = undone.cellStats!['hard-16-v-10']!;
      expect(judgedTally(cell, 5)).toEqual(judgedTally(cellBefore, 5));
      expect(cell.right + cell.wrong).toBe(cellBefore.right + cellBefore.wrong);
    }
    // And the next answer lands exactly as if the withdrawn one never happened.
    const undone = undoGradedEvent(applyEvents(before, [flash]), flash);
    expect(handWindow(applyEvents(undone, [play]).handRecent, 'hard')).toBe(
      handWindow(applyEvents(before, [play]).handRecent, 'hard'),
    );
  });
});
