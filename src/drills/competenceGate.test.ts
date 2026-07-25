import { describe, it, expect } from 'vitest';
import { computeUnlockedTier, tierAbove, SPEED_TIER_ORDER } from './competenceGate';
import type { SpeedTier } from './countSpeed';

/** Builds `n` history entries at `tier`, all sharing the same `correct` flag. */
function attempts(tier: SpeedTier, n: number, correct: boolean): { tier: SpeedTier; correct: boolean }[] {
  return Array.from({ length: n }, () => ({ tier, correct }));
}

/** Builds history entries at `tier` from an explicit correct/wrong sequence
 * (oldest first) -- used where the exact ORDER matters (e.g. avoiding an
 * incidental trailing miss-streak that would trip the separate easing rule
 * while a test is only trying to exercise the accuracy/window rule). */
function seq(tier: SpeedTier, corrects: boolean[]): { tier: SpeedTier; correct: boolean }[] {
  return corrects.map((correct) => ({ tier, correct }));
}

describe('SPEED_TIER_ORDER', () => {
  it('is ordered learning < table-ready < pro < expert', () => {
    expect(SPEED_TIER_ORDER).toEqual(['learning', 'table-ready', 'pro', 'expert']);
  });
});

describe('computeUnlockedTier', () => {
  it('returns learning for an empty history (nothing attempted yet)', () => {
    const result = computeUnlockedTier([]);
    expect(result.unlockedTier).toBe('learning');
    expect(result.canAdvance).toBe(false);
    expect(result.recentAccuracyPct).toBe(0);
  });

  it('unlocks pro after enough accurate recent attempts at table-ready (default thresholds)', () => {
    // 8 correct / 10 at table-ready = 80% -- meets the default 80% bar over the
    // default window of 10, with the default minAttempts (5) comfortably met.
    const history = [...attempts('table-ready', 8, true), ...attempts('table-ready', 2, false)];
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('pro');
    expect(result.canAdvance).toBe(true);
  });

  it('does not advance below the default minAttempts even at 100% accuracy', () => {
    // Only 3 attempts at table-ready, all correct -- below the default
    // minAttempts of 5, so the promotion must NOT happen yet.
    const history = attempts('table-ready', 3, true);
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('table-ready');
    expect(result.canAdvance).toBe(false);
  });

  it('does not advance when recent accuracy at the current tier is below the threshold', () => {
    // 5 correct / 10 at table-ready = 50%, below the default 80% bar. Ends on
    // a correct attempt (not a trailing miss streak) so this exercises ONLY
    // the accuracy/window rule, not the separate easing rule below.
    const history = seq('table-ready', [false, false, false, false, false, true, true, true, true, true]);
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('table-ready');
    expect(result.canAdvance).toBe(false);
  });

  it('eases back a tier on a recent miss streak', () => {
    // Held pro comfortably in the past, but the three MOST RECENT attempts at
    // pro are all wrong -- a miss streak should ease back to table-ready
    // regardless of the older, otherwise-healthy history.
    const history = [...attempts('pro', 7, true), ...attempts('pro', 3, false)];
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('table-ready');
    expect(result.canAdvance).toBe(false);
  });

  it('a miss streak at the floor tier (learning) never eases below it', () => {
    const history = attempts('learning', 3, false);
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('learning');
  });

  it('does not advance past expert -- there is no higher tier to unlock', () => {
    const history = [...attempts('expert', 8, true), ...attempts('expert', 2, false)];
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('expert');
    expect(result.canAdvance).toBe(false);
  });

  it('climbs each adjacent tier in turn: learning -> table-ready -> pro -> expert', () => {
    expect(computeUnlockedTier(attempts('learning', 8, true)).unlockedTier).toBe('table-ready');
    expect(computeUnlockedTier(attempts('table-ready', 8, true)).unlockedTier).toBe('pro');
    expect(computeUnlockedTier(attempts('pro', 8, true)).unlockedTier).toBe('expert');
  });

  it('only the most recent windowSize attempts at a tier count toward accuracy', () => {
    // 20 wrong attempts long ago, then 8 correct out of the most recent 10 --
    // the old failures must NOT drag down the recent window's accuracy.
    const history = [
      ...attempts('table-ready', 20, false),
      ...attempts('table-ready', 8, true),
      ...attempts('table-ready', 2, false),
    ];
    const result = computeUnlockedTier(history);
    expect(result.unlockedTier).toBe('pro');
  });

  it('respects a custom advanceThresholdPct override', () => {
    // 6/10 = 60% at table-ready, interleaved so it doesn't end on a trailing
    // miss streak -- fails the default 80% bar but clears a custom 50% bar.
    const history = seq('table-ready', [
      false, true, false, true, false, true, false, true, true, true,
    ]);
    expect(computeUnlockedTier(history).unlockedTier).toBe('table-ready');
    expect(
      computeUnlockedTier(history, { advanceThresholdPct: 50 }).unlockedTier,
    ).toBe('pro');
  });

  it('respects a custom minAttempts override', () => {
    const history = attempts('table-ready', 3, true);
    expect(computeUnlockedTier(history).unlockedTier).toBe('table-ready');
    expect(computeUnlockedTier(history, { minAttempts: 3 }).unlockedTier).toBe('pro');
  });

  it('respects a custom windowSize override', () => {
    // Most recent 4 attempts at table-ready are all correct; with a window of
    // 4 that is 100% (advances), but with the default window of 10 the older
    // failures pull accuracy below threshold.
    const history = [...attempts('table-ready', 6, false), ...attempts('table-ready', 4, true)];
    expect(computeUnlockedTier(history).unlockedTier).toBe('table-ready');
    expect(
      computeUnlockedTier(history, { windowSize: 4, minAttempts: 4 }).unlockedTier,
    ).toBe('pro');
  });

  it('reports recentAccuracyPct for the returned unlockedTier', () => {
    const history = attempts('table-ready', 5, true);
    const result = computeUnlockedTier(history, { minAttempts: 3 });
    expect(result.unlockedTier).toBe('pro');
    // Freshly promoted to pro -- no attempts recorded there yet.
    expect(result.recentAccuracyPct).toBe(0);
  });
});

describe('tierAbove', () => {
  it('returns the next tier up for each non-top tier', () => {
    expect(tierAbove('learning')).toBe('table-ready');
    expect(tierAbove('table-ready')).toBe('pro');
    expect(tierAbove('pro')).toBe('expert');
  });

  it('returns null for the top tier (nothing above expert)', () => {
    expect(tierAbove('expert')).toBeNull();
  });
});
