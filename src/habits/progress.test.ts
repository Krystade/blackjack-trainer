import { afterEach, describe, expect, it } from 'vitest';
import {
  GOALS,
  IDLE_CAP_MS,
  DRIVE_SESSION_GAP_MS,
  addDays,
  backfillDays,
  computeStreak,
  emptyProgress,
  goalFor,
  heatmap,
  normalizeProgress,
  recordActivity,
  signatureDelta,
  statsSignature,
  weekStart,
  weekView,
  weeksWithAtLeast,
  type DayRecord,
  type ProgressState,
} from './progress';
import { EMPTY_STATS, type Stats } from '../store/types';
import { localDayKey } from '../store/practiceDays';

const goal = GOALS.normal;
const local = (m: number, d: number, h = 12, min = 0, s = 0) => new Date(2026, m - 1, d, h, min, s).getTime();

/** Answers `n` times, `stepMs` apart, from `start`. */
function burst(p: ProgressState, start: number, n: number, stepMs: number, drive = false): ProgressState {
  let s = p;
  for (let i = 0; i < n; i++) s = recordActivity(s, start + i * stepMs, { answers: 1, drive }, goal).state;
  return s;
}

const met = (...keys: string[]): Record<string, DayRecord> =>
  Object.fromEntries(keys.map((k) => [k, { answers: 60, activeMs: 0, met: true as const }]));

/** `n` consecutive met days ending `last`. */
function run(last: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(last, -(n - 1 - i)));
}

// Node re-reads TZ on assignment. Reached through globalThis: src/ has no node types.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
const savedTz = env.TZ;
afterEach(() => {
  env.TZ = savedTz;
});

describe('day keys', () => {
  it('buckets answers either side of local midnight into two days', () => {
    let p = recordActivity(emptyProgress(), local(10, 10, 23, 59, 50), { answers: 1, drive: false }, goal).state;
    p = recordActivity(p, local(10, 11, 0, 0, 20), { answers: 1, drive: false }, goal).state;
    expect(p.days['2026-10-10'].answers).toBe(1);
    expect(p.days['2026-10-11'].answers).toBe(1);
    // The 30 s gap is credited to the day of the answer that closed it.
    expect(p.days['2026-10-11'].activeMs).toBe(30_000);
    expect(p.days['2026-10-10'].activeMs).toBe(0);
  });

  it('steps calendar days across a DST change (23 h and 25 h days)', () => {
    env.TZ = 'America/Los_Angeles';
    // US DST 2026: starts 8 March, ends 1 November.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-11-02', -2)).toBe('2026-10-31');
    // A streak straddling both changes is unbroken.
    const keys = run('2026-03-10', 5);
    expect(computeStreak(met(...keys), '2026-03-10').current).toBe(5);
    const fall = run('2026-11-03', 5);
    expect(computeStreak(met(...fall), '2026-11-03').current).toBe(5);
  });

  it('uses the device time zone, so a zone change re-buckets by the new local day', () => {
    const t = Date.UTC(2026, 9, 10, 5, 0); // 05:00 UTC
    env.TZ = 'America/Los_Angeles';
    expect(localDayKey(new Date(t))).toBe('2026-10-09');
    env.TZ = 'Europe/London';
    expect(localDayKey(new Date(t))).toBe('2026-10-10');
  });

  it('weeks start on Monday', () => {
    expect(weekStart('2026-10-21')).toBe('2026-10-19'); // Wednesday
    expect(weekStart('2026-10-19')).toBe('2026-10-19');
    expect(weekStart('2026-10-25')).toBe('2026-10-19'); // Sunday
  });
});

describe('active time', () => {
  it('credits gaps up to the idle cap and nothing for longer ones', () => {
    let p = burst(emptyProgress(), local(10, 1, 9), 3, 10_000); // two 10 s gaps
    expect(p.days['2026-10-01'].activeMs).toBe(20_000);
    p = recordActivity(p, local(10, 1, 9) + 20_000 + IDLE_CAP_MS, { answers: 1, drive: false }, goal).state;
    expect(p.days['2026-10-01'].activeMs).toBe(20_000 + IDLE_CAP_MS); // exactly at the cap: counts
    p = recordActivity(p, local(10, 1, 9) + 20_000 + IDLE_CAP_MS + IDLE_CAP_MS + 1, { answers: 1, drive: false }, goal).state;
    expect(p.days['2026-10-01'].activeMs).toBe(20_000 + IDLE_CAP_MS); // one ms over: the clock stopped
    expect(p.days['2026-10-01'].answers).toBe(5);
  });

  it('the first answer of all credits nothing', () => {
    const p = recordActivity(emptyProgress(), local(10, 1), { answers: 1, drive: false }, goal).state;
    expect(p.days['2026-10-01'].activeMs).toBe(0);
  });

  it('a row that reports its own duration is credited it, capped by the gap', () => {
    let p = recordActivity(emptyProgress(), local(10, 1, 9), { answers: 1, drive: false }, goal).state;
    p = recordActivity(p, local(10, 1, 9, 10), { answers: 1, drive: false, durationHintMs: 250_000 }, goal).state;
    expect(p.days['2026-10-01'].activeMs).toBe(250_000);
    p = recordActivity(p, local(10, 1, 9, 12), { answers: 1, drive: false, durationHintMs: 999_000 }, goal).state;
    expect(p.days['2026-10-01'].activeMs).toBe(250_000 + 120_000);
  });

  it('meets the goal on minutes or on answers, once', () => {
    // 10 minutes of answers 30 s apart is 21 answers -- met on time.
    let p = emptyProgress();
    let crossings = 0;
    for (let i = 0; i <= 20; i++) {
      const r = recordActivity(p, local(10, 2, 8) + i * 30_000, { answers: 1, drive: false }, goal);
      if (r.goalMet) crossings += 1;
      p = r.state;
    }
    expect(p.days['2026-10-02'].met).toBe(true);
    expect(crossings).toBe(1);
    // 60 answers far apart, no time at all -- met on answers at the 60th.
    let q = emptyProgress();
    for (let i = 0; i < 60; i++) {
      const r = recordActivity(q, local(10, 3, 8) + i * 120_000, { answers: 1, drive: false }, goal);
      q = r.state;
      expect(r.goalMet).toBe(i === 59);
    }
  });

  it('drive time and the longest contiguous drive', () => {
    let p = burst(emptyProgress(), local(10, 4, 7), 31, 30_000, true); // 15 min driving
    expect(p.drive.totalMs).toBe(15 * 60_000);
    expect(p.drive.bestRunMs).toBe(15 * 60_000);
    p = burst(p, local(10, 4, 9), 5, 30_000, true); // new run after a long stop
    expect(p.drive.runMs).toBe(2 * 60_000);
    expect(p.drive.bestRunMs).toBe(15 * 60_000);
    p = burst(p, local(10, 4, 9, 3), 3, 30_000, false);
    expect(p.drive.runMs).toBe(0);
    expect(p.days['2026-10-04'].driveMs).toBe(17 * 60_000);
  });

  it('a Drive session is wall time: 30 min of count runs 2.5 min apart is one session', () => {
    // 52 cards at 2 s: each run is 104 s of its own, then a 46 s gap.
    let p = emptyProgress();
    const t0 = local(10, 6, 7);
    for (let i = 0; i < 12; i++) {
      p = recordActivity(p, t0 + i * 150_000, { answers: 1, drive: true, durationHintMs: 104_000 }, goal).state;
    }
    // From the first run's start (t0 - 104 s) to the last answer.
    expect(p.drive.bestRunMs).toBe(11 * 150_000 + 104_000);
    expect(p.drive.bestRunMs).toBeGreaterThanOrEqual(15 * 60_000);
  });

  it('a pause over the idle cap keeps the session; one over the session gap ends it', () => {
    let p = burst(emptyProgress(), local(10, 6, 7), 5, 30_000, true); // 2 min
    p = recordActivity(p, local(10, 6, 7) + 120_000 + DRIVE_SESSION_GAP_MS, { answers: 1, drive: true }, goal).state;
    expect(p.drive.runMs).toBe(120_000 + DRIVE_SESSION_GAP_MS); // a 3-min junction: same drive
    expect(p.days['2026-10-06'].activeMs).toBe(120_000); // but no active minutes for it
    const last = local(10, 6, 7) + 120_000 + DRIVE_SESSION_GAP_MS;
    p = recordActivity(p, last + DRIVE_SESSION_GAP_MS + 1, { answers: 1, drive: true }, goal).state;
    expect(p.drive.runMs).toBe(0); // a new session
    expect(p.drive.bestRunMs).toBe(120_000 + DRIVE_SESSION_GAP_MS);
  });

  it('an undo takes the answer back off today', () => {
    let p = burst(emptyProgress(), local(10, 5), 3, 5000);
    p = recordActivity(p, local(10, 5, 12, 1), { answers: -1, drive: false }, goal).state;
    expect(p.days['2026-10-05'].answers).toBe(2);
    expect(p.answersTotal).toBe(2);
  });
});

describe('streak and freezes', () => {
  const today = '2026-10-21';

  it('counts consecutive met days; today unmet breaks nothing', () => {
    expect(computeStreak(met(...run(today, 4)), today).current).toBe(4);
    expect(computeStreak(met(...run(addDays(today, -1), 4)), today).current).toBe(4);
    expect(computeStreak(met(...run(addDays(today, -1), 4)), today).todayMet).toBe(false);
  });

  it('a missed day with no freeze ends the streak', () => {
    const s = computeStreak(met(...run(addDays(today, -2), 3)), today);
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3);
  });

  it('earns a freeze per 7 met days and spends it on a missed day', () => {
    const days = met(...run(addDays(today, -2), 7)); // 7 days, then yesterday missed
    const s = computeStreak(days, today);
    expect(s.current).toBe(7);
    expect(s.freezes).toBe(0);
    expect(s.frozen.has(addDays(today, -1))).toBe(true);
  });

  it('6 met days earn no freeze', () => {
    const s = computeStreak(met(...run(addDays(today, -2), 6)), today);
    expect(s.current).toBe(0);
    expect(s.frozen.size).toBe(0);
  });

  it('holds at most two freezes', () => {
    const s = computeStreak(met(...run(today, 21)), today);
    expect(s.freezes).toBe(2);
    expect(s.maxFreezesHeld).toBe(2);
    expect(s.current).toBe(21);
  });

  it('two freezes cover two missed days; the third ends it', () => {
    const last = addDays(today, -4);
    const two = computeStreak(met(...run(addDays(today, -3), 14)), today); // missed -2, -1
    expect(two.current).toBe(14);
    expect(two.freezes).toBe(0);
    expect(two.frozen.size).toBe(2);
    const three = computeStreak(met(...run(last, 14)), today); // missed -3, -2, -1
    expect(three.current).toBe(0);
    expect(three.longest).toBe(14);
  });

  it('a frozen day keeps the streak but does not lengthen it', () => {
    const keys = [...run('2026-10-10', 7), '2026-10-12', '2026-10-13'];
    const s = computeStreak(met(...keys), '2026-10-13');
    expect(s.current).toBe(9);
    expect([...s.frozen]).toEqual(['2026-10-11']);
  });

  it('longest survives a break and is dated by the day each length was reached', () => {
    const keys = [...run('2026-10-05', 5), ...run('2026-10-20', 2)];
    const s = computeStreak(met(...keys), today);
    expect(s.longest).toBe(5);
    expect(s.current).toBe(2);
    expect(s.reachedOn[2]).toBe('2026-10-03');
  });
});

describe('week and heatmap', () => {
  it('shows met, frozen, missed, today and future dots for the current week', () => {
    const today = '2026-10-22'; // Thursday
    const days = met('2026-10-19', '2026-10-20');
    const w = weekView(days, today, new Set(['2026-10-21']));
    expect(w.dots.map((d) => d.state)).toEqual(['met', 'met', 'frozen', 'today', 'future', 'future', 'future']);
    expect(w.met).toBe(2);
    expect(weekView(days, '2026-10-24', new Set()).dots[3].state).toBe('missed');
  });

  it('days before anything was recorded are not misses', () => {
    const w = weekView({ '2026-10-21': { answers: 3, activeMs: 0 } }, '2026-10-22', new Set());
    expect(w.dots.map((d) => d.state)).toEqual(['before', 'before', 'missed', 'today', 'future', 'future', 'future']);
    expect(weekView({}, '2026-10-22', new Set()).dots[0].state).toBe('before');
  });

  it('counts weeks with at least n met days', () => {
    expect(weeksWithAtLeast(met(...run('2026-10-25', 7)), 7)).toBe(1);
    expect(weeksWithAtLeast(met(...run('2026-10-24', 7)), 7)).toBe(0); // straddles two weeks
    expect(weeksWithAtLeast(met(...run('2026-10-24', 7)), 5)).toBe(1);
  });

  it('heatmap is 12 Monday-first columns ending this week, with levels', () => {
    const today = '2026-10-21';
    const days: Record<string, DayRecord> = { '2026-10-20': { answers: 60, activeMs: 0, met: true }, '2026-10-19': { answers: 30, activeMs: 0 } };
    const cols = heatmap(days, today, goal, new Set());
    expect(cols).toHaveLength(12);
    expect(cols[11][0].key).toBe('2026-10-19');
    expect(cols[11][0].level).toBe(2);
    expect(cols[11][1].level).toBe(4);
    expect(cols[11][3].future).toBe(true);
    expect(cols[0][0].key).toBe(addDays('2026-10-19', -77));
  });
});

describe('answer signature', () => {
  const withRuns = (n: number): Stats => ({
    ...EMPTY_STATS,
    countDrill: { history: Array.from({ length: n }, () => ({ date: '2026-10-01T10:00:00Z', cards: 52, intervalMs: 800, correct: true })) },
  });

  it('a new event or history row is one added answer; a run carries its own duration', () => {
    const a = statsSignature(withRuns(2));
    const b = withRuns(3);
    b.mistakes = { ...b.mistakes, correct: 1 };
    const d = signatureDelta(a, statsSignature(b), b);
    expect(d.added).toBe(2);
    expect(d.durationHintMs).toBe(52 * 800);
  });

  it('no baseline is no answers, a small fall is an undo, a big fall is a reset', () => {
    const s = withRuns(1);
    expect(signatureDelta(undefined, statsSignature(s), s).added).toBe(0);
    const before = { ...statsSignature(s), events: 10 };
    const after = { ...statsSignature(s), events: 9 };
    expect(signatureDelta(before, after, s).undone).toBe(1);
    expect(signatureDelta({ ...before, events: 500 }, after, s).undone).toBe(0);
    expect(signatureDelta({ ...before, events: 11 }, after, s).undone).toBe(0);
  });
});

describe('backfill', () => {
  const stats: Stats = {
    ...EMPTY_STATS,
    latencyHistory: Array.from({ length: 61 }, (_, i) => ({
      category: 'hard' as const,
      elapsedMs: 900,
      correct: true,
      date: new Date(local(10, 6, 10) + i * 5000).toISOString(),
    })),
    countDrill: { history: [{ date: new Date(local(10, 7, 10)).toISOString(), cards: 52, intervalMs: 800, correct: true }] },
    practiceDays: ['2026-10-08'],
  };

  it('rebuilds answers, active time and met days, deterministically', () => {
    const a = backfillDays(stats, goal);
    expect(a['2026-10-06']).toEqual({ answers: 61, activeMs: 300_000, met: true });
    expect(a['2026-10-07'].answers).toBe(1);
    expect(a['2026-10-08']).toEqual({ answers: 0, activeMs: 0 });
    expect(backfillDays(stats, goal)).toEqual(a);
    expect(backfillDays(stats, GOALS.hard)['2026-10-06'].met).toBeUndefined();
  });
});

describe('storage shape', () => {
  it('normalises junk and keeps good fields', () => {
    expect(normalizeProgress(null)).toEqual(emptyProgress());
    expect(normalizeProgress({ version: 2 })).toEqual(emptyProgress());
    const p = normalizeProgress({ version: 1, days: { bad: {}, '2026-10-01': { answers: 3, activeMs: -5, met: true } }, earned: { x: '2026-10-01', y: 4 } });
    expect(p.days).toEqual({ '2026-10-01': { answers: 3, activeMs: 0, met: true } });
    expect(p.earned).toEqual({ x: '2026-10-01' });
  });

  it('goalFor defaults to normal', () => {
    expect(goalFor(undefined)).toEqual(GOALS.normal);
    expect(goalFor('easy')).toEqual({ minutes: 5, answers: 30 });
    expect(goalFor('hard')).toEqual({ minutes: 20, answers: 120 });
  });
});
