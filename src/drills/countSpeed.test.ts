import { describe, it, expect } from 'vitest';
import {
  classifySpeed,
  secondsPerDeck,
  formatDuration,
  rampIntervalMs,
  RAMP_FLOOR_MS,
} from './countSpeed';

describe('classifySpeed', () => {
  // Cutoffs (see countSpeed.ts doc comment for sourcing):
  //   > 30s  -> learning
  //   <= 30s -> table-ready
  //   <= 22s -> pro
  //   <= 12s -> expert

  it('exactly 30s is table-ready (boundary inclusive on the fast side)', () => {
    expect(classifySpeed(30)).toBe('table-ready');
  });

  it('just above 30s is learning', () => {
    expect(classifySpeed(30.01)).toBe('learning');
  });

  it('just below 30s is table-ready', () => {
    expect(classifySpeed(29.99)).toBe('table-ready');
  });

  it('exactly 22s is pro', () => {
    expect(classifySpeed(22)).toBe('pro');
  });

  it('just above 22s is table-ready', () => {
    expect(classifySpeed(22.01)).toBe('table-ready');
  });

  it('just below 22s is pro', () => {
    expect(classifySpeed(21.99)).toBe('pro');
  });

  it('exactly 12s is expert', () => {
    expect(classifySpeed(12)).toBe('expert');
  });

  it('just above 12s is pro', () => {
    expect(classifySpeed(12.01)).toBe('pro');
  });

  it('just below 12s is expert', () => {
    expect(classifySpeed(11.99)).toBe('expert');
  });

  it('a very slow time is learning', () => {
    expect(classifySpeed(120)).toBe('learning');
  });

  it('a near-record time is expert', () => {
    expect(classifySpeed(8)).toBe('expert');
  });

  it('zero seconds is expert (degenerate but not a crash)', () => {
    expect(classifySpeed(0)).toBe('expert');
  });
});

describe('secondsPerDeck', () => {
  it('normalises 26 cards in 15s to ~30s/deck', () => {
    expect(secondsPerDeck(15_000, 26)).toBeCloseTo(30, 10);
  });

  it('a full 52-card deck in 52s stays 52s/deck', () => {
    expect(secondsPerDeck(52_000, 52)).toBeCloseTo(52, 10);
  });

  it('13 cards in 3.9s normalises to 15.6s/deck', () => {
    expect(secondsPerDeck(3_900, 13)).toBeCloseTo(15.6, 10);
  });

  it('scales linearly with elapsed time for a fixed card count', () => {
    expect(secondsPerDeck(30_000, 52)).toBeCloseTo(2 * secondsPerDeck(15_000, 52), 10);
  });

  it('returns 0 for zero cards shown (no division by zero)', () => {
    expect(secondsPerDeck(10_000, 0)).toBe(0);
  });

  it('returns 0 for negative cards shown (defensive, no crash)', () => {
    expect(secondsPerDeck(10_000, -5)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats 12400ms as "12.4s"', () => {
    expect(formatDuration(12_400)).toBe('12.4s');
  });

  it('formats 500ms as "0.5s"', () => {
    expect(formatDuration(500)).toBe('0.5s');
  });

  it('formats 0ms as "0.0s"', () => {
    expect(formatDuration(0)).toBe('0.0s');
  });

  it('formats a whole-second value with one decimal place', () => {
    expect(formatDuration(30_000)).toBe('30.0s');
  });

  it('rounds to one decimal place', () => {
    expect(formatDuration(12_449)).toBe('12.4s');
    expect(formatDuration(12_460)).toBe('12.5s');
  });

  it('never goes negative even if given a negative input (defensive)', () => {
    expect(formatDuration(-100)).toBe('0.0s');
  });
});

describe('rampIntervalMs', () => {
  it('card 0 returns the starting pace unchanged (above the floor)', () => {
    expect(rampIntervalMs(0, 900)).toBe(900);
  });

  it('decays monotonically non-increasing as cardIndex grows', () => {
    let prev = rampIntervalMs(0, 900);
    for (let i = 1; i < 60; i++) {
      const cur = rampIntervalMs(i, 900);
      expect(cur).toBeLessThanOrEqual(prev);
      prev = cur;
    }
  });

  it('never drops below the default floor (150ms)', () => {
    for (let i = 0; i < 200; i++) {
      expect(rampIntervalMs(i, 900)).toBeGreaterThanOrEqual(RAMP_FLOOR_MS);
    }
  });

  it('reaches the floor well before 200 cards for a typical starting pace', () => {
    expect(rampIntervalMs(200, 900)).toBe(RAMP_FLOOR_MS);
  });

  it('a starting pace already at/below the floor stays at the floor', () => {
    expect(rampIntervalMs(0, 100)).toBe(RAMP_FLOOR_MS);
    expect(rampIntervalMs(5, 100)).toBe(RAMP_FLOOR_MS);
  });

  it('respects a custom floor override', () => {
    expect(rampIntervalMs(200, 900, { floorMs: 250 })).toBe(250);
  });

  it('respects a custom decay override (slower decay = higher interval at the same index)', () => {
    const slow = rampIntervalMs(20, 900, { decay: 0.99 });
    const fast = rampIntervalMs(20, 900, { decay: 0.9 });
    expect(slow).toBeGreaterThan(fast);
  });

  it('treats a negative cardIndex as index 0 (defensive, no crash / no speed-up)', () => {
    expect(rampIntervalMs(-3, 900)).toBe(900);
  });

  it('is deterministic for the same inputs', () => {
    expect(rampIntervalMs(10, 900)).toBe(rampIntervalMs(10, 900));
  });
});
