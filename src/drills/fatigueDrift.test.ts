import { describe, it, expect } from 'vitest';
import { fatigueDrift, DEFAULT_FATIGUE_OPTS, type DatedResult } from './fatigueDrift';

const T0 = Date.parse('2026-07-31T10:00:00.000Z');
const MIN = 60 * 1000;

/** Build a run `n` minutes after T0 with the given correctness. */
const run = (offsetMin: number, correct: boolean): DatedResult => ({
  date: new Date(T0 + offsetMin * MIN).toISOString(),
  correct,
});

describe('fatigueDrift (ET5)', () => {
  it('returns nulls when there is no qualifying session (too few runs)', () => {
    const d = fatigueDrift([run(0, true), run(1, false)]); // 2 < minPerSession
    expect(d.sessions).toBe(0);
    expect(d.frontAccuracy).toBeNull();
    expect(d.backAccuracy).toBeNull();
    expect(d.drift).toBeNull();
  });

  it('detects a decline: back-half accuracy below front-half within one session (negative drift)', () => {
    // 8 back-to-back runs: front 4 all correct, back 4 all wrong.
    const runs = [
      run(0, true), run(1, true), run(2, true), run(3, true),
      run(4, false), run(5, false), run(6, false), run(7, false),
    ];
    const d = fatigueDrift(runs);
    expect(d.sessions).toBe(1);
    expect(d.frontAccuracy).toBe(1);
    expect(d.backAccuracy).toBe(0);
    expect(d.drift).toBe(-1); // fatigue
    expect(d.samples).toBe(8);
  });

  it('a long break splits sessions; each is analyzed independently', () => {
    const gapMin = DEFAULT_FATIGUE_OPTS.gapMs / MIN;
    const session1 = [run(0, true), run(1, true), run(2, true), run(3, false), run(4, false), run(5, false)];
    // Second session starts well after the gap.
    const base = gapMin + 100;
    const session2 = [
      run(base, true), run(base + 1, true), run(base + 2, true),
      run(base + 3, true), run(base + 4, true), run(base + 5, true),
    ];
    const d = fatigueDrift([...session1, ...session2]);
    expect(d.sessions).toBe(2);
    // session1: front 3 correct, back 3 wrong; session2: all 6 correct.
    // Pooled front = 3/3 + 3/3 = 6/6 = 1.0; back = 0/3 + 3/3 = 3/6 = 0.5.
    expect(d.frontAccuracy).toBe(1);
    expect(d.backAccuracy).toBe(0.5);
    expect(d.drift).toBe(-0.5);
  });

  it('drops the odd middle run when a session has an odd count (symmetric halves)', () => {
    // 7 runs: front 3, back 3, middle (index 3) dropped.
    const runs = [
      run(0, true), run(1, true), run(2, true),
      run(3, false), // middle -> dropped
      run(4, false), run(5, false), run(6, false),
    ];
    const d = fatigueDrift(runs);
    expect(d.samples).toBe(6); // 7 - 1 dropped
    expect(d.frontAccuracy).toBe(1);
    expect(d.backAccuracy).toBe(0);
  });

  it('is order-independent (sorts by timestamp first)', () => {
    const runs = [run(5, false), run(0, true), run(3, false), run(1, true), run(4, false), run(2, true)];
    const d = fatigueDrift(runs);
    expect(d.frontAccuracy).toBe(1); // the three earliest are correct
    expect(d.backAccuracy).toBe(0);
  });

  it('no drift when performance is flat', () => {
    const runs = Array.from({ length: 10 }, (_, i) => run(i, true));
    const d = fatigueDrift(runs);
    expect(d.drift).toBe(0);
  });

  it('a larger gapMs merges runs into one long session', () => {
    const runs = [
      run(0, true), run(40, true), run(80, true), // 40-min spacing
      run(120, false), run(160, false), run(200, false),
    ];
    // Default 30-min gap: every run is its own session (no qualifying session).
    expect(fatigueDrift(runs).sessions).toBe(0);
    // 60-min gap: all one session, front correct / back wrong.
    const d = fatigueDrift(runs, { gapMs: 60 * MIN, minPerSession: 6 });
    expect(d.sessions).toBe(1);
    expect(d.drift).toBe(-1);
  });
});
