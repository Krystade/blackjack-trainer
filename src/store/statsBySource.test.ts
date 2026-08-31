import { describe, it, expect } from 'vitest';
import { applyEvents } from './stats';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';
import type { GradedEvent } from '../engine/grade';

/**
 * "I don't see flashcard stats in the stats window."
 *
 * There were none. `stats.categories` is written by BOTH the drill grade path
 * (flashcards + deviation quiz) and live table play, pooled into the same
 * hard/soft/pairs buckets -- so not only was there no flashcard section, the
 * numbers that did exist could not be separated. A 70% on "soft" might be
 * flashcards, might be the table, and nothing could tell you which.
 *
 * `source` splits the tally without disturbing the pooled one. It is OPTIONAL
 * and purely additive, exactly like `elapsedMs` before it: every producer
 * that predates it simply omits it, and a stats blob written before this
 * change must keep working untouched.
 */

function ev(patch: Partial<GradedEvent>): GradedEvent {
  return {
    kind: 'action',
    category: 'soft',
    correct: true,
    classification: 'none',
    taken: 'stand',
    expected: 'stand',
    reason: '',
    tc: 0,
    ...patch,
  } as GradedEvent;
}

describe('per-source tallies', () => {
  it('splits flashcard answers out from table play', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ source: 'flashcard', correct: true }),
      ev({ source: 'flashcard', correct: false }),
      ev({ source: 'table', correct: true }),
    ]);

    expect(after.bySource?.flashcard?.soft).toEqual({ right: 1, wrong: 1 });
    expect(after.bySource?.table?.soft).toEqual({ right: 1, wrong: 0 });
  });

  // The pooled view is what the existing "Accuracy by category" section reads,
  // and it must keep counting everything regardless of where it came from.
  it('still pools everything into categories', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ source: 'flashcard', correct: true }),
      ev({ source: 'table', correct: true }),
      ev({ source: 'quiz', correct: false }),
    ]);
    expect(after.categories.soft).toEqual({ right: 2, wrong: 1 });
  });

  it('keeps the three sources apart', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ source: 'flashcard', category: 'hard', correct: false }),
      ev({ source: 'quiz', category: 'hard', correct: true }),
    ]);
    expect(after.bySource?.flashcard?.hard).toEqual({ right: 0, wrong: 1 });
    expect(after.bySource?.quiz?.hard).toEqual({ right: 1, wrong: 0 });
  });

  // Every producer predating this field omits it. Those events must still be
  // counted in the pooled view and simply not appear in any per-source one.
  it('ignores events with no source rather than inventing one', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [ev({ correct: true })]);
    expect(after.categories.soft.right).toBe(1);
    expect(after.bySource?.flashcard?.soft?.right ?? 0).toBe(0);
    expect(after.bySource?.table?.soft?.right ?? 0).toBe(0);
  });

  it('accumulates onto a stats blob that already has sources', () => {
    const first = applyEvents(structuredClone(EMPTY_STATS), [ev({ source: 'flashcard' })]);
    const second = applyEvents(first, [ev({ source: 'flashcard' })]);
    expect(second.bySource!.flashcard!.soft.right).toBe(2);
  });

  /**
   * A blob written before this change has no `bySource` at all. Reading it
   * must not throw, and writing to it must create the branch rather than
   * mutating the absent one.
   */
  it('migrates a pre-existing blob that has no bySource', () => {
    const legacy = structuredClone(EMPTY_STATS) as Stats & { bySource?: unknown };
    delete legacy.bySource;

    const after = applyEvents(legacy as Stats, [ev({ source: 'flashcard' })]);
    expect(after.bySource?.flashcard?.soft).toEqual({ right: 1, wrong: 0 });
  });

  it('does not mutate the input', () => {
    const before = structuredClone(EMPTY_STATS);
    const snapshot = JSON.stringify(before);
    applyEvents(before, [ev({ source: 'flashcard' })]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  // The structural-sharing guarantee has to survive the new branch.
  it('still shares the history subtrees it never touches', () => {
    const before = structuredClone(EMPTY_STATS);
    const after = applyEvents(before, [ev({ source: 'flashcard' })]);
    expect(after.countDrill).toBe(before.countDrill);
    expect(after.trueCount).toBe(before.trueCount);
  });
});
