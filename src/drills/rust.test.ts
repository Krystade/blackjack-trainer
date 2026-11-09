import { describe, expect, it } from 'vitest';
import type { Stats } from '../store/types';
import { DAY, NOW, iso, stateAt } from '../ui/screens/ladderFixtures';
import { dueAfterDays } from './spacedRepetition';
import {
  EMPTY_RUST,
  RUST_INTERVALS_DAYS,
  advanceRust,
  normalizeRust,
  rustIntervalDays,
  rustMarks,
  type RustInputs,
  type RustStore,
} from './rust';

const INPUTS: RustInputs = { activeIds: [] };
/** Every rung passing on its own rule. */
const ALL_PASSED = ['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play'].map((id) => ({ id, passed: true }));
const countLive = [{ id: 'count', passed: true }];

const run = (daysAgo: number, correct: boolean, extra: Record<string, unknown> = {}) => ({
  date: iso(daysAgo),
  cards: 52,
  intervalMs: 550,
  correct,
  ...extra,
});

/** Count passing on five table-pace runs `daysAgo` days ago. */
function countStats(daysAgo: number): Stats {
  const s = stateAt(8);
  s.countDrill.history = [true, true, true, true, true].map((c) => run(daysAgo, c));
  return s;
}

const store = (count: RustStore['rungs']['count']): RustStore => ({ version: 1, rungs: { count } });

describe('advanceRust: the schedule', () => {
  it('first sight of a passed rung proves it when it was last practised, not now', () => {
    const fresh = advanceRust(EMPTY_RUST, countLive, countStats(3), INPUTS, NOW);
    expect(fresh.rungs.count).toEqual({ step: 0, provenAt: NOW - 3 * DAY });
    // Practised 20 days ago: already past its first 14 days, so rusty at once.
    const s = countStats(20);
    const out = advanceRust(EMPTY_RUST, countLive, s, INPUTS, NOW);
    expect(out.rungs.count).toMatchObject({ step: 0, provenAt: NOW - 20 * DAY, retest: { from: dueAfterDays(NOW - 20 * DAY, 14) } });
  });

  it('settles in one call: advancing again with the same inputs changes nothing', () => {
    for (const s of [countStats(3), countStats(20), stateAt(8)]) {
      const once = advanceRust(EMPTY_RUST, ALL_PASSED, s, INPUTS, NOW);
      expect(advanceRust(once, ALL_PASSED, s, INPUTS, NOW)).toBe(once);
    }
  });

  it('opens the re-test 14 days after the proof, from the due moment', () => {
    const s = countStats(20);
    const proven = NOW - 20 * DAY;
    const out = advanceRust(store({ step: 0, provenAt: proven }), countLive, s, INPUTS, NOW);
    expect(out.rungs.count?.retest?.from).toBe(dueAfterDays(proven, 14));
    expect(rustMarks(out, s, INPUTS, NOW).count?.state).toBe('rusty');
  });

  it('is not due at 13 days', () => {
    const s = countStats(13);
    const st = store({ step: 0, provenAt: NOW - 13 * DAY });
    expect(advanceRust(st, countLive, s, INPUTS, NOW)).toBe(st);
  });

  it('D2: an eyes-free short count run is practice -- it holds the re-test off', () => {
    const s = countStats(20);
    s.countDrill.history.push(run(3, false, { cards: 20, eyesFree: true, intervalMs: 2000 }));
    const st = store({ step: 0, provenAt: NOW - 20 * DAY });
    expect(advanceRust(st, countLive, s, INPUTS, NOW)).toBe(st);
  });

  it('intervals run 14, 30, 60, 120 and stay at 120', () => {
    expect([0, 1, 2, 3, 4, 9].map(rustIntervalDays)).toEqual([14, 30, 60, 120, 120, 120]);
    expect(RUST_INTERVALS_DAYS).toEqual([14, 30, 60, 120]);
    // Step 1 (one re-test passed) is not due at 29 days, due at 31.
    const st = store({ step: 1, provenAt: NOW - 29 * DAY });
    expect(advanceRust(st, countLive, countStats(40), INPUTS, NOW)).toBe(st);
    const late = store({ step: 1, provenAt: NOW - 31 * DAY });
    expect(advanceRust(late, countLive, countStats(40), INPUTS, NOW).rungs.count?.retest).toBeDefined();
  });

  it('never tracks a rung its own rule does not pass (a skipped rung never goes rusty)', () => {
    const live = [{ id: 'basic', passed: false }, { id: 'repair', passed: false }, { id: 'count', passed: true }];
    const out = advanceRust(EMPTY_RUST, live, countStats(1), INPUTS, NOW);
    expect(Object.keys(out.rungs)).toEqual(['count']);
  });

  it('tracks the six rungs with a re-test, never repair', () => {
    const out = advanceRust(EMPTY_RUST, ALL_PASSED, stateAt(8), { activeIds: [] }, NOW);
    expect(Object.keys(out.rungs).sort()).toEqual(['basic', 'betramp', 'count', 'deviations', 'play', 'tc']);
  });
});

describe('advanceRust: judging the re-test', () => {
  const from = NOW - 6 * DAY;
  const open = (step: number, needsWork?: true) =>
    store({ step, provenAt: NOW - 40 * DAY, retest: { from, baseline: { n: 0, right: 0 } }, ...(needsWork ? { needsWork } : {}) });
  const withFresh = (results: boolean[], extra: Record<string, unknown> = {}) => {
    const s = countStats(40);
    s.countDrill.history.push(...results.map((c, i) => run(5 - i * 0.1, c, extra)));
    return s;
  };

  it('waits for five fresh table-pace runs', () => {
    const st = open(0);
    expect(advanceRust(st, countLive, withFresh([true, true, true, true]), INPUTS, NOW)).toBe(st);
  });

  it('4 of 5 passes: next interval, proven now, re-test closed', () => {
    const out = advanceRust(open(1), countLive, withFresh([true, false, true, true, true]), INPUTS, NOW).rungs.count!;
    expect(out).toMatchObject({ step: 2, provenAt: NOW });
    expect(out.retest).toBeUndefined();
    expect(out.needsWork).toBeUndefined();
    expect(out.last).toMatchObject({ passed: true, n: 5, right: 4 });
  });

  it('2 of 5 fails: back to the first interval, needs work, a fresh re-test from now', () => {
    const out = advanceRust(open(2), countLive, withFresh([true, false, false, true, false]), INPUTS, NOW).rungs.count!;
    expect(out.step).toBe(0);
    expect(out.needsWork).toBe(true);
    expect(out.retest?.from).toBe(NOW);
    expect(out.last).toMatchObject({ passed: false, n: 5, right: 2 });
  });

  it('a passed needs-work re-test starts again at 14 days', () => {
    const out = advanceRust(open(0, true), countLive, withFresh([true, true, true, true, true]), INPUTS, NOW).rungs.count!;
    expect(out).toMatchObject({ step: 0, provenAt: NOW });
    expect(out.needsWork).toBeUndefined();
  });

  it('D2: only qualifying runs are evidence -- eyes-free slow runs, short runs and older runs are not', () => {
    const st = open(0);
    const s = withFresh([true, true, true, true, true], { intervalMs: 2000, eyesFree: true });
    s.countDrill.history.push(...[1, 2, 3, 4, 5].map((i) => run(4 - i * 0.1, true, { cards: 30 })));
    s.countDrill.history.push(...[1, 2, 3, 4, 5].map(() => run(7, true)));
    expect(advanceRust(st, countLive, s, INPUTS, NOW)).toBe(st);
  });

  it('a rung its own rule fails is never tracked or brought due, but its open re-test is judged', () => {
    const failing = [{ id: 'count', passed: false }];
    expect(advanceRust(EMPTY_RUST, failing, countStats(20), INPUTS, NOW)).toBe(EMPTY_RUST);
    const due = store({ step: 0, provenAt: NOW - 40 * DAY });
    expect(advanceRust(due, failing, countStats(40), INPUTS, NOW)).toBe(due);
    const out = advanceRust(open(1), failing, withFresh([false, false, true, false, true]), INPUTS, NOW).rungs.count!;
    expect(out).toMatchObject({ step: 0, needsWork: true, last: { n: 5, right: 2 } });
  });

  it('basic is judged per category on answers since the baseline, never pooled', () => {
    const s = stateAt(8);
    s.categories.hard = { right: 100, wrong: 0 };
    s.categories.soft = { right: 100, wrong: 0 };
    s.categories.pairs = { right: 100, wrong: 0 };
    const baseline = {
      n: 300,
      right: 300,
      parts: { hard: { n: 100, right: 100 }, soft: { n: 100, right: 100 }, pairs: { n: 100, right: 100 } },
    };
    const st: RustStore = { version: 1, rungs: { basic: { step: 0, provenAt: 0, retest: { from, baseline } } } };
    const live = [{ id: 'basic', passed: true }];
    // 20 fresh hard and soft, 10 pairs at 8/10: pooled 48/50 = 96%, pairs 80%.
    s.categories.hard = { right: 120, wrong: 0 };
    s.categories.soft = { right: 120, wrong: 0 };
    s.categories.pairs = { right: 108, wrong: 2 };
    expect(advanceRust(st, live, s, INPUTS, NOW).rungs.basic).toMatchObject({ step: 0, needsWork: true });
    s.categories.pairs = { right: 109, wrong: 0 };
    expect(advanceRust(st, live, s, INPUTS, NOW)).toBe(st); // pairs 9 fresh: not judged yet
  });

  it('deviations need every active index answered again', () => {
    const s = stateAt(8);
    s.perIndex = { '16v10': { right: 10, wrong: 0 }, '15v10': { right: 10, wrong: 0 } } as Stats['perIndex'];
    const baseline = { n: 20, right: 20, parts: { '16v10': { n: 10, right: 10 }, '15v10': { n: 10, right: 10 } } };
    const st: RustStore = { version: 1, rungs: { deviations: { step: 0, provenAt: 0, retest: { from, baseline } } } };
    const inputs = { activeIds: ['16v10', '15v10'] };
    const live = [{ id: 'deviations', passed: true }];
    s.perIndex = { '16v10': { right: 22, wrong: 0 }, '15v10': { right: 10, wrong: 0 } } as Stats['perIndex'];
    expect(advanceRust(st, live, s, inputs, NOW)).toBe(st);
    s.perIndex = { '16v10': { right: 20, wrong: 0 }, '15v10': { right: 12, wrong: 0 } } as Stats['perIndex'];
    expect(advanceRust(st, live, s, inputs, NOW).rungs.deviations).toMatchObject({ step: 1, provenAt: NOW });
  });
});

describe('rustMarks: the copy', () => {
  it('says when it was passed and what keeps it', () => {
    const st = store({ step: 0, provenAt: NOW - 20 * DAY, retest: { from: NOW - 6 * DAY, baseline: { n: 0, right: 0 } } });
    const m = rustMarks(st, countStats(20), INPUTS, NOW).count!;
    expect(m.why).toBe('Passed 20 days ago and not practised since. 5 table-pace runs, 4 right, to keep it.');
    expect(m.progress).toBe('Re-test due');
  });

  it('names a missed re-test and how it went', () => {
    const st = store({
      step: 0,
      provenAt: NOW - 40 * DAY,
      needsWork: true,
      retest: { from: NOW, baseline: { n: 0, right: 0 } },
      last: { at: NOW, passed: false, step: 1, n: 5, right: 2 },
    });
    const m = rustMarks(st, countStats(40), INPUTS, NOW).count!;
    expect(m.state).toBe('needsWork');
    expect(m.why).toBe('Missed its re-test: 2 of 5. 5 table-pace runs, 4 right to pass it again.');
  });
});

describe('normalizeRust', () => {
  it('drops what it cannot read', () => {
    expect(normalizeRust(null)).toEqual(EMPTY_RUST);
    expect(normalizeRust({ rungs: { count: { step: 'x' }, repair: { step: 0, provenAt: 1 }, tc: { step: 1, provenAt: 5, needsWork: true } } })).toEqual({
      version: 1,
      rungs: { tc: { step: 1, provenAt: 5 } },
    });
  });
});
