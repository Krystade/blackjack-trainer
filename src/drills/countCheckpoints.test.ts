import { describe, it, expect } from 'vitest';
import {
  checkpointIndices,
  summarizeCheckpoints,
  type CheckpointResult,
} from './countCheckpoints';

function row(atGroup: number, cardsShown: number, actual: number, answer: number): CheckpointResult {
  return { atGroup, cardsShown, actual, answer };
}

describe('checkpointIndices', () => {
  it('asks for nothing when the setting is off', () => {
    expect(checkpointIndices(52, 'off', 1)).toEqual([]);
  });

  it("'one' stops once and 'few' stops twice", () => {
    expect(checkpointIndices(52, 'one', 1)).toHaveLength(1);
    expect(checkpointIndices(52, 'few', 1)).toHaveLength(2);
  });

  it('never stops on the first group -- nothing has been lost yet', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const at of checkpointIndices(52, 'few', seed)) expect(at).toBeGreaterThanOrEqual(1);
    }
  });

  it('never stops on the last group -- that is the final answer, already graded', () => {
    for (let seed = 1; seed <= 200; seed++) {
      for (const at of checkpointIndices(52, 'few', seed)) expect(at).toBeLessThanOrEqual(50);
    }
  });

  it('returns stops in ascending order, with no repeats', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const stops = checkpointIndices(52, 'few', seed);
      expect(stops).toEqual([...stops].sort((a, b) => a - b));
      expect(new Set(stops).size).toBe(stops.length);
    }
  });

  it('spreads two stops across the run rather than bunching them', () => {
    // Each checkpoint owns its own half of the valid span, so the second is
    // always past the midpoint and the first never is. Two stops in the first
    // third would localize nothing, which is the whole point of the feature.
    for (let seed = 1; seed <= 200; seed++) {
      const [a, b] = checkpointIndices(52, 'few', seed);
      expect(a).toBeLessThan(26);
      expect(b).toBeGreaterThanOrEqual(26);
    }
  });

  it('is deterministic in the seed, and different seeds move the stops', () => {
    expect(checkpointIndices(52, 'few', 7)).toEqual(checkpointIndices(52, 'few', 7));
    const seen = new Set<string>();
    for (let seed = 1; seed <= 50; seed++) seen.add(checkpointIndices(52, 'few', seed).join(','));
    // Vacuity guard: if the seed did nothing this would be 1.
    expect(seen.size).toBeGreaterThan(5);
  });

  it('yields fewer stops, or none, than asked for on a run too short to hold them', () => {
    // 3 groups: only index 1 is a valid stop, so 'few' cannot have two.
    expect(checkpointIndices(3, 'few', 1)).toEqual([1]);
    // 2 groups: first and last are both excluded, so there is nowhere to stop.
    expect(checkpointIndices(2, 'few', 1)).toEqual([]);
    expect(checkpointIndices(1, 'one', 1)).toEqual([]);
    expect(checkpointIndices(0, 'one', 1)).toEqual([]);
  });
});

describe('summarizeCheckpoints', () => {
  it('counts what was right', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 4), row(30, 31, -2, 1)], false);
    expect(r.correct).toBe(1);
    expect(r.total).toBe(2);
  });

  it('a clean run reports no drift segment and no cancellation', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 4), row(30, 31, -2, -2)], true);
    expect(r.cancelled).toBe(false);
    expect(r.firstDriftSegment).toBeNull();
  });

  it('RT#12: a correct final count over a wrong checkpoint is flagged as cancelled', () => {
    // The exact case the old grading called perfect: drifted at the first
    // checkpoint, and something later cancelled it back out.
    const r = summarizeCheckpoints([row(10, 11, 4, 5), row(30, 31, -2, -2)], true);
    expect(r.cancelled).toBe(true);
  });

  it('a wrong final count is not "cancelled" -- it is just wrong', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 5)], false);
    expect(r.cancelled).toBe(false);
  });

  it('a correct final count with every checkpoint right is not cancelled', () => {
    expect(summarizeCheckpoints([row(10, 11, 4, 4)], true).cancelled).toBe(false);
  });

  it('localizes the first drift to the segment between the last clean stop and it', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 4), row(30, 31, -2, 1)], true);
    expect(r.firstDriftSegment).toEqual({ fromCard: 12, toCard: 31 });
  });

  it('a drift at the FIRST checkpoint opens the segment at card 1', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 9), row(30, 31, -2, -2)], false);
    expect(r.firstDriftSegment).toEqual({ fromCard: 1, toCard: 11 });
  });

  it('reports the FIRST drift, not the last', () => {
    const r = summarizeCheckpoints([row(10, 11, 4, 9), row(30, 31, -2, 7)], false);
    expect(r.firstDriftSegment?.toCard).toBe(11);
  });

  it('no checkpoints is an empty report, never a false clean bill', () => {
    const r = summarizeCheckpoints([], true);
    expect(r.total).toBe(0);
    expect(r.correct).toBe(0);
    expect(r.cancelled).toBe(false);
    expect(r.firstDriftSegment).toBeNull();
  });
});
