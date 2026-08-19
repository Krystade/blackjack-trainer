import { describe, it, expect } from 'vitest';
import { applyEvents } from './stats';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';
import type { GradedEvent } from '../engine/grade';

/**
 * `applyEvents` used to deep-copy the whole Stats blob with
 * `JSON.parse(JSON.stringify(stats))` on EVERY graded answer. Stats carries
 * several unbounded history arrays (countDrill, trueCount, deckEstimation,
 * timedCount, ... capped at 2000 entries each by retention.ts) that this
 * function never reads or writes, so the cost scaled with how much the user
 * had practised -- the people using the app most paid the most.
 *
 * These specs pin BOTH halves of the replacement: the purity the old clone
 * bought, and the structural sharing that makes it cheap. Without the
 * sharing assertions a future refactor could quietly reintroduce a deep
 * copy and every other test would still pass.
 */

function seededStats(): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.countDrill.history.push({ date: '2026-08-01', cards: 52, intervalMs: 1000, correct: true });
  s.trueCount.history.push({
    date: '2026-08-01',
    runningCount: 4,
    decksRemaining: 2,
    guess: 2,
    correctTc: 2,
    correct: true,
  });
  return s;
}

const event: GradedEvent = {
  category: 'hard',
  correct: false,
  classification: 'basic-error',
} as GradedEvent;

describe('applyEvents purity', () => {
  it('does not mutate the input', () => {
    const before = seededStats();
    const snapshot = JSON.stringify(before);
    applyEvents(before, [event]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('produces a new top-level object', () => {
    const before = seededStats();
    expect(applyEvents(before, [event])).not.toBe(before);
  });

  it('records the event in the result', () => {
    const before = seededStats();
    const after = applyEvents(before, [event]);
    expect(after.categories.hard.wrong).toBe(before.categories.hard.wrong + 1);
    expect(after.mistakes['basic-error']).toBe(before.mistakes['basic-error'] + 1);
  });

  it('leaves the input tallies untouched even across many events', () => {
    const before = seededStats();
    applyEvents(before, [event, event, event]);
    expect(before.categories.hard.wrong).toBe(0);
    expect(before.mistakes['basic-error']).toBe(0);
  });
});

describe('applyEvents structural sharing', () => {
  it('shares the drill history subtrees it never touches', () => {
    const before = seededStats();
    const after = applyEvents(before, [event]);

    // The whole point: these are the big arrays, and applyEvents has no
    // business copying them.
    expect(after.countDrill).toBe(before.countDrill);
    expect(after.countDrill.history).toBe(before.countDrill.history);
    expect(after.trueCount).toBe(before.trueCount);
    expect(after.deckEstimation).toBe(before.deckEstimation);
    expect(after.timedCount).toBe(before.timedCount);
  });

  it('copies the tally branches it does write', () => {
    const before = seededStats();
    const after = applyEvents(before, [event]);
    expect(after.categories).not.toBe(before.categories);
    expect(after.categories.hard).not.toBe(before.categories.hard);
    expect(after.mistakes).not.toBe(before.mistakes);
  });

  it('does not copy sibling tallies it never wrote', () => {
    const before = seededStats();
    const after = applyEvents(before, [event]);
    expect(after.categories.soft).toBe(before.categories.soft);
    expect(after.categories.pairs).toBe(before.categories.pairs);
  });

  it('appends to latencyHistory without sharing the array back', () => {
    const before = seededStats();
    const timed = { ...event, elapsedMs: 1200 } as GradedEvent;
    const after = applyEvents(before, [timed]);
    expect(after.latencyHistory).not.toBe(before.latencyHistory);
    expect(before.latencyHistory).toHaveLength(0);
    expect(after.latencyHistory).toHaveLength(1);
  });

  // An untimed event must not force a copy of the latency array at all.
  it('shares latencyHistory when nothing was timed', () => {
    const before = seededStats();
    const after = applyEvents(before, [event]);
    expect(after.latencyHistory).toBe(before.latencyHistory);
  });
});
