import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, type Stats } from '../store/types';
import { tallyDelta, tallySignature } from './tally';

const fresh = (): Stats => structuredClone(EMPTY_STATS);

function withEvents(s: Stats, correct: number, wrong: number): Stats {
  return { ...s, mistakes: { ...s.mistakes, correct: s.mistakes.correct + correct, 'basic-error': s.mistakes['basic-error'] + wrong } };
}

const countRow = (correct: boolean) => ({ date: '2026-10-22T10:00:00.000Z', cards: 52, intervalMs: 800, correct });

describe('tallyDelta: the answers and right answers one save added', () => {
  it('graded events: the rise in the total and in `correct`', () => {
    const before = fresh();
    const after = withEvents(before, 1, 0);
    expect(tallyDelta(tallySignature(before), after)).toEqual({ answers: 1, right: 1 });
    expect(tallyDelta(tallySignature(before), withEvents(before, 0, 1))).toEqual({ answers: 1, right: 0 });
  });

  it('a Wrong-tap undo takes one answer back (and its right, if it was right)', () => {
    const one = withEvents(fresh(), 1, 0);
    expect(tallyDelta(tallySignature(one), fresh())).toEqual({ answers: -1, right: -1 });
    const wrong = withEvents(fresh(), 0, 1);
    expect(tallyDelta(tallySignature(wrong), fresh())).toEqual({ answers: -1, right: 0 });
  });

  it('a reset (a large fall) is a new baseline, not answers', () => {
    const lots = withEvents(fresh(), 30, 10);
    expect(tallyDelta(tallySignature(lots), fresh())).toEqual({ answers: 0, right: 0 });
  });

  it('history drills: one row per answer, right from `correct` / `ok`', () => {
    const before = fresh();
    const after: Stats = {
      ...before,
      countDrill: { history: [countRow(true)] },
      betSizing: {
        history: [{ date: 'x', rc: 4, decksRemaining: 2, tc: 2, taken: 4, correct: 4, ok: true }, { date: 'x', rc: 0, decksRemaining: 2, tc: 0, taken: 2, correct: 1, ok: false }],
      },
    };
    expect(tallyDelta(tallySignature(before), after)).toEqual({ answers: 3, right: 2 });
  });

  it('a full history: the untrimmed save still shows the new row', () => {
    const full: Stats = { ...fresh(), countDrill: { history: Array.from({ length: 2000 }, () => countRow(false)) } };
    const untrimmed: Stats = { ...full, countDrill: { history: [...full.countDrill.history, countRow(true)] } };
    expect(tallyDelta(tallySignature(full), untrimmed)).toEqual({ answers: 1, right: 1 });
  });

  it('a shrinking history adds nothing', () => {
    const two: Stats = { ...fresh(), countDrill: { history: [countRow(true), countRow(true)] } };
    expect(tallyDelta(tallySignature(two), { ...two, countDrill: { history: [countRow(true)] } })).toEqual({ answers: 0, right: 0 });
  });
});
