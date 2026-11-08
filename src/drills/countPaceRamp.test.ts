import { describe, it, expect } from 'vitest';
import {
  PACE_STEPS_MS,
  derivePaceSteps,
  paceRampStatus,
  rampDealMs,
  rampHistory,
  rampResultLine,
  rampSetupLine,
  stepOfPace,
} from './countPaceRamp';
import { TABLE_PACE_MS } from './countSpeed';
import { isQualifyingRun } from './fluencyGate';
import type { CountRunLike } from './fluencyGate';
import { EASY_FIRST_RUN, EASY_INTERVAL_MS } from './hiLoAid';

const at = (intervalMs: number, correct: boolean, extra: Partial<CountRunLike> = {}): CountRunLike => ({
  correct,
  cards: 52,
  intervalMs,
  ...extra,
});
/** Runs at `ms` from a string of R (right) and W (wrong), oldest first. */
const runs = (ms: number, pattern: string): CountRunLike[] => [...pattern].map((c) => at(ms, c === 'R'));

describe('the pace steps', () => {
  it('are the geometric ramp from Easy first run to table pace, on the stepper grid', () => {
    expect(derivePaceSteps()).toEqual([...PACE_STEPS_MS]);
    expect(PACE_STEPS_MS[0]).toBe(EASY_INTERVAL_MS);
  });

  it('end at table pace: the top step counts toward the rung, the one below does not', () => {
    expect(PACE_STEPS_MS[4]).toBeLessThanOrEqual(TABLE_PACE_MS);
    expect(PACE_STEPS_MS[3]).toBeGreaterThan(TABLE_PACE_MS);
    expect(isQualifyingRun(at(PACE_STEPS_MS[4], true))).toBe(true);
    expect(isQualifyingRun(at(PACE_STEPS_MS[3], true))).toBe(false);
  });

  it('credit a run to the fastest step at least as slow as it (conservative)', () => {
    const cases: [number, number][] = [
      [2500, 0], [2000, 0], [1999, 0], [1501, 0], [1500, 1], [1499, 1],
      [1100, 2], [800, 3], [551, 3], [550, 4], [300, 4],
    ];
    for (const [ms, step] of cases) expect([ms, stepOfPace(ms)]).toEqual([ms, step]);
  });
});

describe('rampHistory', () => {
  it('judges graded, set-pace, visual deck runs only', () => {
    const base = at(2000, true);
    expect(rampHistory([base])).toHaveLength(1);
    expect(rampHistory([{ ...base, manual: true, meanTapMs: 900 }])).toHaveLength(0);
    expect(rampHistory([{ ...base, selfReport: true }])).toHaveLength(0);
    expect(rampHistory([{ ...base, eyesFree: true, elapsedMs: 52 * 2000 }])).toHaveLength(0);
    expect(rampHistory([{ ...base, cards: 26 }])).toHaveLength(0);
  });

  it('reads a grouped run per card', () => {
    // Two cards every 2200 ms is 1100 ms a card: step 3.
    expect(rampHistory([at(2200, true, { group: 2 })])[0]!.tier).toBe('s3');
  });
});

describe('paceRampStatus', () => {
  it('starts a new user at step 1 with three right runs to go', () => {
    const s = paceRampStatus([]);
    expect(s).toMatchObject({ step: 1, ms: 2000, judged: 0, right: 0, next: { ms: 1500, need: 3 } });
  });

  it('steps up after 3 of 3 right', () => {
    expect(paceRampStatus(runs(2000, 'RR')).step).toBe(1);
    expect(paceRampStatus(runs(2000, 'RRR'))).toMatchObject({ step: 2, ms: 1500, judged: 0 });
  });

  it('holds on 2 right and 1 wrong, and steps up at 4 of the last 5', () => {
    expect(paceRampStatus(runs(2000, 'RWR')).step).toBe(1);
    expect(paceRampStatus(runs(2000, 'RWRR')).step).toBe(1);
    expect(paceRampStatus(runs(2000, 'RWRRR')).step).toBe(2);
  });

  it('eases one step after three misses in a row', () => {
    const h = [...runs(2000, 'RRR'), ...runs(1500, 'RRR'), ...runs(1100, 'WWW')];
    expect(paceRampStatus(h)).toMatchObject({ step: 2, ms: 1500 });
  });

  it('asks the gate how many more right runs unlock the next step', () => {
    // R,W,R,R is 75%: one more right makes 4 of 5.
    expect(paceRampStatus(runs(2000, 'RWRR')).next).toEqual({ ms: 1500, need: 1 });
    // W,R,R: 3 of 4 is still 75%, so it takes two.
    expect(paceRampStatus(runs(2000, 'WRR')).next).toEqual({ ms: 1500, need: 2 });
  });

  it('has nothing above the top step', () => {
    expect(paceRampStatus(runs(550, 'RRR')).next).toBeNull();
    expect(paceRampStatus(runs(300, 'RRR')).step).toBe(5);
  });

  it('ignores runs it does not judge', () => {
    const noise = [at(2000, true, { manual: true, meanTapMs: 400 }), at(2000, true, { eyesFree: true, elapsedMs: 52 * 2000 })];
    expect(paceRampStatus([...runs(2000, 'RR'), ...noise]).step).toBe(1);
  });
});

describe('the deal interval', () => {
  it('is the step a card, times the group (the timer runs per group)', () => {
    expect(rampDealMs({ ms: 1100 }, undefined)).toBe(1100);
    expect(rampDealMs({ ms: 1100 }, 2)).toBe(2200);
    // So a grouped ramp run is recorded at the step it was dealt at.
    expect(rampHistory([at(rampDealMs({ ms: 800 }, 3), true, { group: 3 })])[0]!.tier).toBe('s4');
  });
});

describe('the copy', () => {
  it('says the step and what unlocks the next', () => {
    expect(rampSetupLine(paceRampStatus([]))).toBe('Pace step 1 of 5 · 2000 ms a card. 3 more right runs at this pace unlock 1500 ms.');
    expect(rampSetupLine(paceRampStatus(runs(2000, 'RWRR')))).toBe('Pace step 1 of 5 · 2000 ms a card. 1 more right run at this pace unlocks 1500 ms.');
    expect(rampSetupLine(paceRampStatus(runs(550, 'RRR')))).toBe(
      'Pace step 5 of 5 · 550 ms a card: table pace. Deck runs at this pace count toward the step.',
    );
  });

  it('says what the run just did', () => {
    const before = paceRampStatus(runs(2000, 'RR'));
    expect(rampResultLine(before, paceRampStatus(runs(2000, 'RRR')))).toBe('Pace up: the next run deals at 1500 ms a card (step 2 of 5).');
    expect(rampResultLine(before, paceRampStatus(runs(2000, 'RRW')))).toBe('2000 ms a card: 2 more right runs unlock 1500 ms.');
    const high = [...runs(2000, 'RRR'), ...runs(1500, 'RRR'), ...runs(1100, 'WW')];
    expect(rampResultLine(paceRampStatus(high), paceRampStatus([...high, at(1100, false)]))).toBe(
      'Eased back to 1500 ms a card after three misses in a row.',
    );
  });
});

describe('Easy first run', () => {
  it('turns the ramp on and deals at its first step', () => {
    expect(EASY_FIRST_RUN.countPaceRamp).toBe(true);
    expect(EASY_FIRST_RUN.countIntervalMs).toBe(PACE_STEPS_MS[0]);
  });
});
