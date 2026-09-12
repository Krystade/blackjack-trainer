import { describe, it, expect } from 'vitest';
import { applyEvents } from './stats';
import { EMPTY_STATS } from './types';
import type { GradedEvent } from '../engine/grade';

/**
 * V5-2 (docs/BACKLOG.md): accuracy under a deadline and accuracy without one
 * are different measurements and must not be pooled.
 *
 * Vékony, Plèche & Németh (npj Science of Learning 2022) instructed one group
 * for speed and one for accuracy, then put both on a neutral instruction: the
 * speed group's advantage vanished the moment the instruction did -- "only the
 * expression of knowledge was affected". A single pooled accuracy figure
 * therefore tracks the shotClockMs setting as much as it tracks learning.
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

describe('shot-clock split', () => {
  it('sorts answers into the bucket the deadline says', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ underShotClock: true, correct: true }),
      ev({ underShotClock: true, correct: false }),
      ev({ underShotClock: true, correct: false }),
      ev({ underShotClock: false, correct: true }),
      ev({ underShotClock: false, correct: true }),
    ]);
    expect(after.shotClockSplit).toEqual({
      timed: { right: 1, wrong: 2 },
      untimed: { right: 2, wrong: 0 },
    });
  });

  it('an event that never said lands in NEITHER bucket', () => {
    // The distinction that makes the measurement honest: table play and every
    // drill answer written before this field exists are unknown, not untimed.
    // Defaulting them into `untimed` would dilute the very number the split
    // exists to protect.
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ correct: true }),
      ev({ correct: false }),
    ]);
    expect(after.shotClockSplit).toBeUndefined();
  });

  it('mixes known and unknown events without contaminating the split', () => {
    const after = applyEvents(structuredClone(EMPTY_STATS), [
      ev({ correct: true }), // unknown
      ev({ underShotClock: false, correct: false }),
      ev({ correct: true }), // unknown
    ]);
    expect(after.shotClockSplit).toEqual({
      timed: { right: 0, wrong: 0 },
      untimed: { right: 0, wrong: 1 },
    });
    // The pooled view still counts all three -- the split is additive, not a
    // replacement.
    const pooled = after.categories.soft;
    expect(pooled.right + pooled.wrong).toBe(3);
  });

  it('accumulates across calls rather than resetting', () => {
    const first = applyEvents(structuredClone(EMPTY_STATS), [ev({ underShotClock: true })]);
    const second = applyEvents(first, [ev({ underShotClock: true, correct: false })]);
    expect(second.shotClockSplit).toEqual({
      timed: { right: 1, wrong: 1 },
      untimed: { right: 0, wrong: 0 },
    });
  });

  it('does not mutate the input stats blob', () => {
    // applyEvents is copy-on-write everywhere else; the new branch must be too,
    // or a caller holding the previous stats sees it change under them.
    const before = applyEvents(structuredClone(EMPTY_STATS), [ev({ underShotClock: true })]);
    const snapshot = structuredClone(before.shotClockSplit);
    applyEvents(before, [ev({ underShotClock: true, correct: false })]);
    expect(before.shotClockSplit).toEqual(snapshot);
  });

  it('a blob written before the field existed upgrades cleanly', () => {
    const legacy = structuredClone(EMPTY_STATS);
    delete (legacy as { shotClockSplit?: unknown }).shotClockSplit;
    const after = applyEvents(legacy, [ev({ underShotClock: false, correct: true })]);
    expect(after.shotClockSplit).toEqual({
      timed: { right: 0, wrong: 0 },
      untimed: { right: 1, wrong: 0 },
    });
  });
});
