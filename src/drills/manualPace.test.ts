import { describe, expect, it } from 'vitest';
import { formatClock, manualPace, paceBests } from './manualPace';

describe('manual count pace (owner 2026-11-06)', () => {
  it('reads the averages, the spread and where the longest pause was', () => {
    const p = manualPace([500, 500, 1500, 500, 600, 600, 600, 600])!;
    expect(p.meanMs).toBe(675);
    expect(p.maxMs).toBe(1500);
    expect(p.maxAtCard).toBe(3);
    expect(p.firstHalfMs).toBe(750);
    expect(p.secondHalfMs).toBe(600);
    expect(p.secondsPerDeck).toBe(35.1);
    expect(p.medianMs).toBe(600);
    expect(p.sdMs).toBeGreaterThan(0);
  });

  it('an idle gap is the longest pause but stays out of the averages', () => {
    const p = manualPace([500, 500, 60_000, 500])!;
    expect(p.meanMs).toBe(500);
    expect(p.maxMs).toBe(60_000);
    expect(p.maxAtCard).toBe(3);
  });

  it('no gaps, no pace', () => {
    expect(manualPace([])).toBeUndefined();
  });

  it('bests come from earlier correct manual runs of the same length only', () => {
    const pace = (meanMs: number) => ({ ...manualPace([meanMs])!, maxMs: meanMs * 2 });
    const best = paceBests(
      [
        { cards: 52, correct: true, manual: true, pace: pace(600) },
        { cards: 52, correct: true, manual: true, pace: pace(550) },
        { cards: 52, correct: false, manual: true, pace: pace(300) },
        { cards: 104, correct: true, manual: true, pace: pace(200) },
        { cards: 52, correct: true, pace: pace(100) },
      ],
      52,
    );
    expect(best.meanMs).toBe(550);
    expect(best.maxMs).toBe(1100);
  });

  it('formats the run clock', () => {
    expect(formatClock(0)).toBe('0:00.0');
    expect(formatClock(12_345)).toBe('0:12.3');
    expect(formatClock(75_000)).toBe('1:15.0');
  });
});
