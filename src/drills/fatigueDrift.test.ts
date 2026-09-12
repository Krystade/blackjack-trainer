import { describe, it, expect } from 'vitest';
import {
  fatigueDrift,
  latencyDrift,
  sessionHalves,
  DEFAULT_FATIGUE_OPTS,
  type DatedLatency,
  type DatedResult,
} from './fatigueDrift';

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

/** Build a timed answer `n` minutes after T0 taking `ms`. */
const answer = (offsetMin: number, ms: number): DatedLatency => ({
  date: new Date(T0 + offsetMin * MIN).toISOString(),
  elapsedMs: ms,
});

describe('sessionHalves', () => {
  it('drops the odd middle row so the halves are the same size', () => {
    const halves = sessionHalves(Array.from({ length: 7 }, (_, i) => run(i, true)), {
      gapMs: 30 * MIN,
      minPerSession: 6,
    });
    expect(halves).toHaveLength(1);
    expect(halves[0]!.front).toHaveLength(3);
    expect(halves[0]!.back).toHaveLength(3);
    // The middle row belongs to neither half, so it appears in no half at all.
    const seen = [...halves[0]!.front, ...halves[0]!.back];
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it('splits on a break longer than the gap and keeps each session separate', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => run(i, true)),
      ...Array.from({ length: 6 }, (_, i) => run(200 + i, true)),
    ];
    expect(sessionHalves(rows, DEFAULT_FATIGUE_OPTS)).toHaveLength(2);
  });

  /**
   * Both analyses read this. If they each grouped rows themselves the two
   * readouts on the screen could report different session counts off the same
   * sitting, which is the kind of disagreement nobody debugs.
   */
  it('gives fatigueDrift and latencyDrift the same session count off the same timestamps', () => {
    const offsets = [0, 1, 2, 3, 4, 5, 200, 201, 202, 203, 204, 205];
    const acc = fatigueDrift(offsets.map((o) => run(o, true)));
    const pace = latencyDrift(offsets.map((o) => answer(o, 1000)));
    expect(acc.sessions).toBe(2);
    expect(pace.sessions).toBe(acc.sessions);
    expect(pace.samples).toBe(acc.samples);
  });
});

describe('latencyDrift (V3-5)', () => {
  it('returns nulls when there is no qualifying session', () => {
    const d = latencyDrift([answer(0, 1000), answer(1, 2000)]);
    expect(d.sessions).toBe(0);
    expect(d.frontMedianMs).toBeNull();
    expect(d.backMedianMs).toBeNull();
    expect(d.driftMs).toBeNull();
  });

  /** The finding the accuracy block cannot see: same score, worse pace. */
  it('reports a slowdown as a POSITIVE drift', () => {
    const d = latencyDrift([
      answer(0, 1000), answer(1, 1000), answer(2, 1000),
      answer(3, 3000), answer(4, 3000), answer(5, 3000),
    ]);
    expect(d.frontMedianMs).toBe(1000);
    expect(d.backMedianMs).toBe(3000);
    expect(d.driftMs).toBe(2000);
  });

  it('reports a speed-up as a negative drift, the opposite sign from fatigueDrift', () => {
    const d = latencyDrift([
      answer(0, 4000), answer(1, 4000), answer(2, 4000),
      answer(3, 1000), answer(4, 1000), answer(5, 1000),
    ]);
    expect(d.driftMs).toBe(-3000);
  });

  it('is flat when the pace holds', () => {
    const d = latencyDrift(Array.from({ length: 10 }, (_, i) => answer(i, 1500)));
    expect(d.driftMs).toBe(0);
    expect(d.samples).toBe(10);
  });

  /**
   * MEDIAN, NOT MEAN. One answer where the phone went down would move a mean
   * by more than a real slowdown does, and would invent a decrement that never
   * happened.
   */
  it('a single huge outlier late in a session does not manufacture a drift', () => {
    const d = latencyDrift([
      answer(0, 1000), answer(1, 1000), answer(2, 1000),
      answer(3, 1000), answer(4, 1000), answer(5, 120_000),
    ]);
    expect(d.driftMs).toBe(0);
    // The same rows through a mean would report a two-thirds-of-a-minute drift.
    const meanFront = (1000 + 1000 + 1000) / 3;
    const meanBack = (1000 + 1000 + 120_000) / 3;
    expect(meanBack - meanFront).toBeGreaterThan(39_000);
  });

  it('pools across sessions rather than averaging session averages', () => {
    const d = latencyDrift([
      // A short session: +1s of drift over 6 answers.
      answer(0, 1000), answer(1, 1000), answer(2, 1000),
      answer(3, 2000), answer(4, 2000), answer(5, 2000),
      // A second session with the same shape, far enough away to split.
      answer(200, 1000), answer(201, 1000), answer(202, 1000),
      answer(203, 2000), answer(204, 2000), answer(205, 2000),
    ]);
    expect(d.sessions).toBe(2);
    expect(d.samples).toBe(12);
    expect(d.driftMs).toBe(1000);
  });

  it('takes the mean of the middle two on an even count', () => {
    const d = latencyDrift([
      answer(0, 1000), answer(1, 2000), answer(2, 3000), answer(3, 4000),
      answer(4, 5000), answer(5, 6000), answer(6, 7000), answer(7, 8000),
    ]);
    expect(d.frontMedianMs).toBe(2500); // 1000,2000,3000,4000
    expect(d.backMedianMs).toBe(6500); // 5000,6000,7000,8000
  });

  it('is order-independent', () => {
    const rows = [answer(5, 3000), answer(0, 1000), answer(3, 3000), answer(1, 1000), answer(4, 3000), answer(2, 1000)];
    expect(latencyDrift(rows).driftMs).toBe(2000);
  });
});
