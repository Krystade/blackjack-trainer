import { describe, it, expect } from 'vitest';
import { HISTORY_CAP, capHistories } from './retention';
import { EMPTY_STATS } from './types';
import type { Stats } from './types';

function statsWith(n: number): Stats {
  const s = structuredClone(EMPTY_STATS);
  s.latencyHistory = Array.from({ length: n }, (_, i) => ({ category: 'hard' as const, elapsedMs: i }));
  s.countDrill.history = Array.from({ length: n }, (_, i) => ({
    date: String(i), cards: 52, intervalMs: 800, correct: true,
  }));
  return s;
}

describe('capHistories', () => {
  it('leaves a short history untouched', () => {
    const s = capHistories(statsWith(5));
    expect(s.latencyHistory).toHaveLength(5);
  });

  it('caps a long history to the limit', () => {
    // Root cause of the quota death spiral: 11 append-only arrays with no
    // retention policy. One year of ordinary use measured at 5.6MB, past the
    // ~5MB localStorage ceiling, after which EVERY save throws.
    expect(capHistories(statsWith(HISTORY_CAP + 500)).latencyHistory).toHaveLength(HISTORY_CAP);
  });

  it('keeps the MOST RECENT entries, discarding the oldest', () => {
    // Recency is what the Stats screen reports on; dropping the newest would
    // make the trend readouts lie.
    const capped = capHistories(statsWith(HISTORY_CAP + 3)).latencyHistory;
    expect(capped[capped.length - 1].elapsedMs).toBe(HISTORY_CAP + 2);
    expect(capped[0].elapsedMs).toBe(3);
  });

  it('caps nested drill histories too, not just the top-level ones', () => {
    expect(capHistories(statsWith(HISTORY_CAP + 10)).countDrill.history).toHaveLength(HISTORY_CAP);
  });

  it('does not mutate the input', () => {
    const original = statsWith(HISTORY_CAP + 10);
    capHistories(original);
    expect(original.latencyHistory).toHaveLength(HISTORY_CAP + 10);
  });

  it('survives a history that is not an array', () => {
    // A corrupt blob must not make the capper itself the thing that throws.
    const broken = statsWith(1);
    (broken.countDrill as { history: unknown }).history = null;
    expect(() => capHistories(broken)).not.toThrow();
  });
});
