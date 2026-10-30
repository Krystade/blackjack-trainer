import { describe, it, expect } from 'vitest';
import { countFluency, isCountFluent, COUNT_RUNS_JUDGED, FLUENCY_MIN_CARDS } from './fluencyGate';

const run = (correct: boolean, extra: { cards?: number; manual?: boolean } = {}) => ({
  correct,
  cards: extra.cards ?? FLUENCY_MIN_CARDS,
  ...(extra.manual === undefined ? {} : { manual: extra.manual }),
});

describe('countFluency (F15: the one rule for Home and the Drills picker)', () => {
  it('is not fluent with too few runs, even all right', () => {
    expect(isCountFluent([])).toBe(false);
    expect(isCountFluent(Array.from({ length: COUNT_RUNS_JUDGED - 1 }, () => run(true)))).toBe(false);
  });

  it('is fluent at 4 of the last 5', () => {
    expect(isCountFluent([run(true), run(true), run(false), run(true), run(true)])).toBe(true);
    expect(isCountFluent([run(true), run(true), run(false), run(false), run(true)])).toBe(false);
  });

  it('judges only the last five: old misses and old hits age out', () => {
    expect(isCountFluent([run(false), run(false), run(true), run(true), run(true), run(true), run(false)])).toBe(true);
    expect(isCountFluent([run(true), run(true), run(true), run(true), run(false), run(false)])).toBe(false);
  });

  it('counts only paced runs of at least one deck', () => {
    const short = Array.from({ length: 10 }, () => run(true, { cards: FLUENCY_MIN_CARDS - 1 }));
    const manual = Array.from({ length: 10 }, () => run(true, { manual: true }));
    expect(isCountFluent(short)).toBe(false);
    expect(isCountFluent(manual)).toBe(false);
    expect(countFluency([...short, ...manual, run(true)])).toEqual({ judged: 1, right: 1, fluent: false });
  });
});

// R7 (review of C12): a self-reported run (no number given) is the operator's
// own verdict, not a graded count, so it never counts toward fluency -- in
// countFluency itself, for every reader (Drills, CountDrillView, nextStep).
describe('self-reported runs (R7)', () => {
  it('do not qualify, however many', () => {
    const self = Array.from({ length: COUNT_RUNS_JUDGED }, () => ({ ...run(true), selfReport: true as const }));
    expect(isCountFluent(self)).toBe(false);
    expect(countFluency([...self, run(true)])).toEqual({ judged: 1, right: 1, fluent: false });
  });
});
