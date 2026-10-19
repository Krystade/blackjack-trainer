import { describe, it, expect } from 'vitest';
import { applyEvents } from './stats';
import { EMPTY_STATS, type Stats } from './types';
import type { GradedEvent } from '../engine/grade';

/**
 * Wave J: the back-counter's entry decision is tallied as its own category
 * (`wongIn`), apart from the wong exit, and its misses by direction. A blob
 * from before either existed must take the first entry without a NaN.
 */

function entry(taken: 'watch' | 'sit-in', correct: boolean): GradedEvent {
  return {
    source: 'table',
    kind: 'wongIn',
    category: 'wongIn',
    correct,
    classification: correct ? 'correct' : 'basic-error',
    taken,
    expected: correct ? taken : taken === 'watch' ? 'sit-in' : 'watch',
    reason: 'Back-count entry at tc 0 (enter at 1)',
    tc: 0,
    wongInTc: 1,
  };
}

/** A blob shaped exactly as one written before Wave J: no wongIn anywhere. */
function oldBlob(): Stats {
  const { ...categories } = EMPTY_STATS.categories;
  return {
    ...structuredClone(EMPTY_STATS),
    categories,
    bySource: { table: { ...structuredClone(EMPTY_STATS.categories) } },
  };
}

describe('wongIn tallies', () => {
  it('EMPTY_STATS carries no wongIn, so an old blob loads as it was saved', () => {
    expect('wongIn' in EMPTY_STATS.categories).toBe(false);
  });

  it('the first entry on an old blob writes the pooled and the table tally', () => {
    const after = applyEvents(oldBlob(), [entry('watch', true), entry('sit-in', false)]);
    expect(after.categories.wongIn).toEqual({ right: 1, wrong: 1 });
    expect(after.bySource?.table?.wongIn).toEqual({ right: 1, wrong: 1 });
    // The exit tally is untouched: entries are counted apart.
    expect(after.categories.wong).toEqual({ right: 0, wrong: 0 });
  });

  it('misses are split by direction: watching through a sit-in count is missed, sitting in short is early', () => {
    const after = applyEvents(oldBlob(), [
      entry('watch', false),
      entry('watch', false),
      entry('sit-in', false),
      entry('watch', true),
      entry('sit-in', true),
    ]);
    expect(after.wongInMisses).toEqual({ missed: 2, early: 1 });
  });

  it('no misses, no direction tally', () => {
    const after = applyEvents(oldBlob(), [entry('watch', true)]);
    expect(after.wongInMisses).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const before = oldBlob();
    const snapshot = structuredClone(before);
    applyEvents(before, [entry('watch', false)]);
    expect(before).toEqual(snapshot);
  });
});

describe('Wave J: hand-count misses of a two-hand ramp', () => {
  const bet = (correct: boolean, handsTaken?: number, handsExpected?: number): GradedEvent => ({
    source: 'table', kind: 'bet', category: 'bet', correct, classification: correct ? 'correct' : 'basic-error',
    taken: '8', expected: '8', reason: 'Spread bet at tc 4', tc: 4,
    ...(handsTaken === undefined ? {} : { handsTaken, handsExpected }),
  });
  it('counts the bets missed on the hand count, which are bet misses too', () => {
    const after = applyEvents(oldBlob(), [bet(false, 1, 2), bet(false, 2, 2), bet(true, 2, 2), bet(false, 2, 1), bet(false)]);
    expect(after.betHandsMisses).toBe(2);
    expect(after.categories.bet).toEqual({ right: 1, wrong: 4 });
  });
  it('none missed, nothing written', () => {
    expect(applyEvents(oldBlob(), [bet(false), bet(true, 2, 2)]).betHandsMisses).toBeUndefined();
  });
});
