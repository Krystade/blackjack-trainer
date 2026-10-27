import { describe, expect, it } from 'vitest';
import { answerTarget, apportion, planSession, SEGMENTS, WARMUP_CELLS_MAX, type PlanInput } from './plan';

const ALL_PASSED: PlanInput['rungsPassed'] = { basic: true, repair: true, count: true, tc: true, deviations: true, betramp: true };
const input = (patch: Partial<PlanInput> = {}): PlanInput => ({
  rungsPassed: ALL_PASSED,
  dueCells: [],
  weakCells: [],
  dueIndexes: [],
  ...patch,
});
const ids = (p: ReturnType<typeof planSession>) => p.map((s) => s.id);
const minutes = (p: ReturnType<typeof planSession>) => Object.fromEntries(p.map((s) => [s.id, s.minutes]));

describe('apportion (largest remainder, each at least one)', () => {
  it('sums to the total exactly', () => {
    for (const total of [3, 5, 6, 15, 30]) {
      for (const w of [[1], [2, 2, 3], [4, 4, 6, 6, 6, 4], [1, 9, 1], [2, 2, 3, 3, 3, 2]]) {
        if (total < w.length) continue;
        const out = apportion(total, w);
        expect(out.reduce((a, b) => a + b, 0), `${total} over ${w}`).toBe(total);
        expect(Math.min(...out)).toBeGreaterThanOrEqual(1);
      }
    }
  });
  it('is proportional, ties to the earlier entry', () => {
    expect(apportion(15, [2, 2, 3, 3, 3, 2])).toEqual([2, 2, 3, 3, 3, 2]);
    expect(apportion(5, [4, 4, 6])).toEqual([2, 1, 2]);
  });
});

describe('planSession', () => {
  it('15 minutes, nothing weak: all six in order, on the base weights', () => {
    const p = planSession(15, input());
    expect(ids(p)).toEqual(SEGMENTS.map((s) => s.id));
    expect(minutes(p)).toEqual({ warmup: 2, speed: 2, count: 3, truecount: 3, deviations: 3, bets: 2 });
    expect(p.every((s) => !s.weak)).toBe(true);
  });

  it('a weak segment gets double weight (the adaptation rule)', () => {
    const strong = planSession(15, input());
    const weak = planSession(15, input({ rungsPassed: { ...ALL_PASSED, deviations: false } }));
    expect(weak.find((s) => s.id === 'deviations')!.weak).toBe(true);
    expect(minutes(weak).deviations).toBeGreaterThan(minutes(strong).deviations);
    // Weights 2,2,3,3,6,2 over 15 minutes: 9 spare after the minimum minute
    // each, shared 1,1,1.5,1.5,3,1 -- the half goes to the earlier tie.
    expect(minutes(weak)).toEqual({ warmup: 2, speed: 2, count: 3, truecount: 2, deviations: 4, bets: 2 });
  });

  it('the warm-up is weak when cells are due or weak, and carries them (due first, capped)', () => {
    const due = Array.from({ length: 10 }, (_, i) => `hard-${i + 5}-2`);
    const p = planSession(15, input({ dueCells: due, weakCells: ['soft-18-9', due[0]!, 'pair-8-10', 'pair-9-7', 'pair-2-2'] }));
    const w = p[0]!;
    expect(w.id).toBe('warmup');
    expect(w.weak).toBe(true);
    expect(w.cells).toHaveLength(WARMUP_CELLS_MAX);
    expect(w.cells!.slice(0, 10)).toEqual(due);
    expect(w.cells).toContain('soft-18-9');
    expect(new Set(w.cells).size).toBe(w.cells!.length);
  });

  it('5 minutes: warm-up plus the two weakest, weak before passed, ties in ladder order', () => {
    expect(ids(planSession(5, input()))).toEqual(['warmup', 'speed', 'count']);
    const p = planSession(5, input({ rungsPassed: { ...ALL_PASSED, tc: false, betramp: false } }));
    expect(ids(p)).toEqual(['warmup', 'truecount', 'bets']);
    expect(p.reduce((a, s) => a + s.minutes, 0)).toBe(5);
    // Only one weak: it and the first passed one.
    expect(ids(planSession(5, input({ rungsPassed: { ...ALL_PASSED, deviations: false } })))).toEqual(['warmup', 'speed', 'deviations']);
  });

  it('a rung missing from the ladder reads as not passed', () => {
    const p = planSession(5, input({ rungsPassed: { basic: true, repair: true, count: true, tc: true, deviations: true } }));
    expect(ids(p)).toEqual(['warmup', 'speed', 'bets']);
  });

  it('30 minutes: all six, twice the time', () => {
    const p = planSession(30, input());
    expect(minutes(p)).toEqual({ warmup: 4, speed: 4, count: 6, truecount: 6, deviations: 6, bets: 4 });
  });

  it('targets: answers for the hand drills, time for the counts', () => {
    const p = planSession(15, input({ dueIndexes: ['16v10', '15v10'] }));
    const by = Object.fromEntries(p.map((s) => [s.id, s]));
    expect(by.warmup!.target).toEqual({ kind: 'answers', n: 15 });
    expect(by.speed!.target).toEqual({ kind: 'answers', n: 20 });
    expect(by.count!.target).toEqual({ kind: 'time', ms: 3 * 60_000 });
    expect(by.truecount!.target).toEqual({ kind: 'time', ms: 3 * 60_000 });
    expect(by.deviations!.target).toEqual({ kind: 'answers', n: 20 });
    expect(by.deviations!.indexes).toEqual(['16v10', '15v10']);
    expect(by.bets!.target).toEqual({ kind: 'answers', n: 15 });
  });

  it('answer targets round to five, at least five, at most a hundred', () => {
    expect(answerTarget(1, 6)).toBe(5);
    expect(answerTarget(2, 8)).toBe(15);
    expect(answerTarget(30, 10)).toBe(100);
  });
});
