import { describe, expect, it } from 'vitest';
import { GUIDED_RUNG_LABELS, PRESETS, SEGMENTS, planBlurb, planSession, segmentDef, type PlanInput } from './plan';
import { RUNG_LABELS } from '../ui/screens/nextStep';

// Track 1 (2026-11-07, D1): a session covers only the steps the user has
// REACHED -- passed, skipped, or at or before the current rung.

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
const sum = (p: ReturnType<typeof planSession>) => p.reduce((a, s) => a + s.minutes, 0);

const RUNGS = ['basic', 'repair', 'count', 'tc', 'deviations', 'betramp'] as const;
type R = (typeof RUNGS)[number];

/** The input guidedStart.planInputFor builds for a ladder whose passed rungs are `passed`. */
function ladderInput(passed: readonly R[], patch: Partial<PlanInput> = {}): PlanInput {
  const current = RUNGS.findIndex((r) => !passed.includes(r));
  const rungsPassed: PlanInput['rungsPassed'] = {};
  const rungsReached: NonNullable<PlanInput['rungsReached']> = {};
  RUNGS.forEach((r, i) => {
    rungsPassed[r] = passed.includes(r);
    rungsReached[r] = passed.includes(r) || current === -1 || i <= current;
  });
  return input({ rungsPassed, rungsReached, currentRung: current === -1 ? null : RUNGS[current], ...patch });
}

describe('reached steps only (D1)', () => {
  it('a new user plans warm-up and speed only, at every length, the freed minutes on the warm-up', () => {
    for (const preset of PRESETS) {
      const p = planSession(preset, ladderInput([]));
      expect(ids(p), `${preset}m`).toEqual(['warmup', 'speed']);
      expect(sum(p)).toBe(preset);
      expect(minutes(p).warmup!).toBeGreaterThan(minutes(p).speed!);
    }
    expect(minutes(planSession(15, ladderInput([])))).toEqual({ warmup: 11, speed: 4 });
  });

  it('Jack-shaped: everything passed but the count, current = count -- all six stay, count weak and longer', () => {
    const p = planSession(15, ladderInput(['basic', 'repair', 'tc', 'deviations', 'betramp']));
    expect(ids(p)).toEqual(SEGMENTS.map((s) => s.id));
    const count = p.find((s) => s.id === 'count')!;
    expect(count.weak).toBe(true);
    expect(count.minutes).toBeGreaterThan(minutes(planSession(15, input())).count!);
  });

  it('current = basic with every later rung passed: all six', () => {
    expect(ids(planSession(15, ladderInput(['repair', 'count', 'tc', 'deviations', 'betramp'])))).toEqual(SEGMENTS.map((s) => s.id));
  });

  it('current = count: warm-up, speed and count, and count takes the freed minutes', () => {
    const p = planSession(15, ladderInput(['basic', 'repair']));
    expect(ids(p)).toEqual(['warmup', 'speed', 'count']);
    expect(sum(p)).toBe(15);
    // Weights 2, 2, 6 alone give count 7 of 15; the freed 3+3+2 make it the lion's share.
    expect(minutes(p).count!).toBeGreaterThan(9);
  });

  it('a rusty rung is reached and planned as weak', () => {
    const p = planSession(15, ladderInput([...RUNGS], { rungsRusty: { count: true } }));
    expect(ids(p)).toContain('count');
    expect(p.find((s) => s.id === 'count')!.weak).toBe(true);
    // Track 3's case: an unpassed count below, a rusty deviations rung above it.
    const q = planSession(15, ladderInput(['basic', 'repair', 'tc', 'deviations', 'betramp'], { rungsRusty: { deviations: true } }));
    expect(q.find((s) => s.id === 'deviations')!.weak).toBe(true);
    // A rusty basic strategy makes the warm-up weak, with no cell due.
    expect(planSession(15, ladderInput([...RUNGS], { rungsRusty: { basic: true } }))[0]!.weak).toBe(true);
  });

  it('a skipped rung is reached and not weak', () => {
    const p = planSession(
      15,
      input({
        rungsPassed: {},
        rungsSkipped: { basic: true, repair: true },
        rungsReached: { basic: true, repair: true, count: true, tc: false, deviations: false, betramp: false },
        currentRung: 'count',
      }),
    );
    expect(ids(p)).toEqual(['warmup', 'speed', 'count']);
    expect(p.find((s) => s.id === 'speed')!.weak).toBe(false);
  });

  it("current = 'play' or null plans today's full six, unchanged", () => {
    const all = planSession(15, input());
    expect(planSession(15, input({ currentRung: 'play' }))).toEqual(all);
    expect(planSession(15, input({ currentRung: null }))).toEqual(all);
  });

  it('Drive with bets current: no bets segment, and the minutes still sum to the preset', () => {
    const p = planSession(15, ladderInput(['basic', 'repair', 'count', 'tc', 'deviations']), { drive: true });
    expect(ids(p)).not.toContain('bets');
    expect(sum(p)).toBe(15);
  });

  it('every plan lasts about its preset: an answer target never clamps it short (t1 #6)', () => {
    const targetMinutes = (p: ReturnType<typeof planSession>) =>
      p.reduce((a, s) => a + (s.target.kind === 'time' ? s.target.ms / 60_000 : s.target.n / segmentDef(s.id).perMinute!), 0);
    const states: PlanInput[] = [
      ladderInput([]),
      ladderInput([], { weakCells: ['hard-16-v-10'] }),
      ladderInput(['basic']),
      ladderInput(['basic', 'repair']),
      ladderInput(['basic', 'repair', 'count', 'tc']),
      ladderInput(['basic', 'repair', 'tc', 'deviations', 'betramp']),
      input(),
    ];
    for (const preset of PRESETS) {
      for (const [i, st] of states.entries()) {
        for (const drive of [false, true]) {
          const t = targetMinutes(planSession(preset, st, { drive }));
          expect(Math.abs(t - preset), `${preset}m state ${i}${drive ? ' drive' : ''}: ${t}`).toBeLessThanOrEqual(1);
        }
      }
    }
    // The case that clamped: a new user's 30-minute warm-up is timed, not 100 answers.
    const w = planSession(30, ladderInput([]))[0]!;
    expect(w.target).toEqual({ kind: 'time', ms: w.minutes * 60_000 });
  });
});

describe('planBlurb: says what this preset covers', () => {
  it('all reached: 5 minutes names exactly its three, 15 minutes all six', () => {
    expect(planBlurb(planSession(5, input()), input())).toBe('One tap, a routine: Warm-up, speed and running count. Weak spots get longer.');
    expect(planBlurb(planSession(15, input()), input())).toBe(
      'One tap, a routine: Warm-up, speed, running count, true count, deviations and bet sizing. Weak spots get longer.',
    );
  });

  it('a new user: warm-up and speed for now, and the count waits for the rung just before it', () => {
    const inp = ladderInput([]);
    expect(planBlurb(planSession(15, inp), inp)).toBe(
      "Warm-up and speed for now. Running count joins after weak cells and a full sweep.",
    );
  });

  it('current = tc: deviations joins after the true count', () => {
    const inp = ladderInput(['basic', 'repair', 'count']);
    expect(planBlurb(planSession(15, inp), inp)).toBe(
      "Warm-up, speed, running count and true count for now. Deviations joins after deck estimation and true count.",
    );
  });

  it('restates the ladder labels exactly', () => {
    const { play: _play, ...rest } = RUNG_LABELS;
    expect(GUIDED_RUNG_LABELS).toEqual(rest);
  });
});
