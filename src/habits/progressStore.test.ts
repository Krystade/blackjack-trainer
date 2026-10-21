import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/speech', () => ({
  speak: vi.fn(),
  estimateSpeechMs: (t: string) => t.length * 60,
}));

import { speak } from '../audio/speech';
import { _setStorage, exportAll, importAll, loadStats, saveSettings, saveStats } from '../store/persist';
import { DEFAULT_SETTINGS, EMPTY_STATS, type Stats } from '../store/types';
import { applyEvents } from '../store/stats';
import type { GradedEvent } from '../engine/grade';
import {
  PROGRESS_KEY,
  _resetHabitsForTest,
  _setHabitClockForTest,
  ensureBackfilled,
  installHabits,
  loadProgress,
  onHabitEvent,
  streakNow,
  type HabitEvent,
} from './progressStore';
import { _resetMomentForTest, pendingMoment, sayMomentAtPause, momentLine, MOMENT_TTL_MS } from './moment';
import { _resetEyesFreeForTest, isEyesFreeOn, setEyesFreeOn } from '../ui/eyesFreeSession';
import { HISTORY_CAP } from '../store/retention';

const ev = (correct = true): GradedEvent => ({
  kind: 'action',
  category: 'hard',
  correct,
  classification: correct ? 'correct' : 'basic-error',
  taken: 'hit',
  expected: 'hit',
  reason: '',
  tc: 0,
});

let map: Map<string, string>;
let now = 0;
let events: HabitEvent[] = [];

function answer(n = 1, stepMs = 5000): void {
  for (let i = 0; i < n; i++) {
    now += stepMs;
    saveStats(applyEvents(loadStats(), [ev()]));
  }
}

beforeEach(() => {
  map = new Map();
  _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  _resetHabitsForTest();
  _resetMomentForTest();
  _resetEyesFreeForTest();
  vi.mocked(speak).mockClear();
  now = new Date(2026, 9, 21, 9, 0).getTime();
  _setHabitClockForTest(() => now);
  events = [];
  installHabits({ isDrive: isEyesFreeOn });
  onHabitEvent((e) => events.push(e));
});
afterEach(() => {
  _setHabitClockForTest(null);
  _setStorage(null);
});

describe('habit store, fed by stats saves', () => {
  it('counts each saved answer once and meets the goal once, at the 60th', () => {
    ensureBackfilled();
    answer(59, 120_000); // far apart: answers only, no minutes
    expect(loadProgress().days['2026-10-21']).toMatchObject({ answers: 59, activeMs: 0 });
    expect(events.filter((e) => e.kind === 'goal')).toHaveLength(0);
    answer(1, 120_000);
    expect(loadProgress().days['2026-10-21'].met).toBe(true);
    answer(3);
    const goals = events.filter((e) => e.kind === 'goal');
    expect(goals).toEqual([{ kind: 'goal', streak: 1 }]);
    expect(streakNow().current).toBe(1);
  });

  it('a second save of the same stats adds nothing', () => {
    ensureBackfilled();
    answer(1);
    saveStats(loadStats());
    saveStats(loadStats());
    expect(loadProgress().days['2026-10-21'].answers).toBe(1);
  });

  it('a Wrong-tap undo takes the answer back; a stats reset does not wipe the day', () => {
    ensureBackfilled();
    answer(3);
    const s = loadStats();
    saveStats({ ...s, mistakes: { ...s.mistakes, correct: s.mistakes.correct - 1 } });
    expect(loadProgress().days['2026-10-21'].answers).toBe(2);
    saveStats(structuredClone(EMPTY_STATS));
    expect(loadProgress().days['2026-10-21'].answers).toBe(2);
    answer(1);
    expect(loadProgress().days['2026-10-21'].answers).toBe(3);
  });

  it('eyes-free: queues ONE spoken line for the next pause; visual: none', () => {
    ensureBackfilled();
    setEyesFreeOn(true, 'test');
    answer(60, 2000);
    expect(pendingMoment()).toBe(momentLine(1));
    const added = sayMomentAtPause({ ...DEFAULT_SETTINGS.audio });
    expect(added).toBeGreaterThan(0);
    expect(speak).toHaveBeenCalledTimes(1);
    expect(vi.mocked(speak).mock.calls[0][0]).toBe('Daily goal done. A new streak starts today.');
    expect(vi.mocked(speak).mock.calls[0][1]?.interrupt).toBeUndefined();
    // Protected: the next prompt's interrupt waits behind it rather than cutting it off.
    expect(vi.mocked(speak).mock.calls[0][1]?.protect).toBe(true);
    expect(sayMomentAtPause({ ...DEFAULT_SETTINGS.audio })).toBe(0);
    expect(speak).toHaveBeenCalledTimes(1);
    // Drive time was credited.
    expect(loadProgress().drive.totalMs).toBe(59 * 2000);
  });

  it('muted: the line is dropped unsaid', () => {
    ensureBackfilled();
    setEyesFreeOn(true, 'test');
    answer(60, 2000);
    expect(sayMomentAtPause({ ...DEFAULT_SETTINGS.audio, muted: true })).toBe(0);
    expect(speak).not.toHaveBeenCalled();
    expect(pendingMoment()).toBeNull();
  });

  it('a line nobody paused for expires: next day, or after the TTL, it is never said', () => {
    ensureBackfilled();
    setEyesFreeOn(true, 'test');
    // Met on a path with no pause hook (pair cancel, history-only).
    for (let i = 0; i < 60; i++) {
      now += 2000;
      const cur = loadStats();
      saveStats({ ...cur, pairCancel: { history: [...cur.pairCancel.history, { date: new Date(now).toISOString(), net: 0, guess: 0, correct: true, cancelling: true }] } });
    }
    expect(pendingMoment()).toBe(momentLine(1));
    now = new Date(2026, 9, 22, 8, 0).getTime(); // next morning
    expect(sayMomentAtPause({ ...DEFAULT_SETTINGS.audio })).toBe(0);
    expect(speak).not.toHaveBeenCalled();
  });

  it('within the TTL the line is said; just past it, it is dropped', () => {
    ensureBackfilled();
    setEyesFreeOn(true, 'test');
    answer(60, 2000);
    now += MOMENT_TTL_MS;
    expect(pendingMoment()).toBe(momentLine(1));
    now += 1;
    expect(sayMomentAtPause({ ...DEFAULT_SETTINGS.audio })).toBe(0);
    expect(pendingMoment()).toBeNull();
    expect(speak).not.toHaveBeenCalled();
  });

  it('a line queued just before midnight is not said after it, even inside the TTL', () => {
    now = new Date(2026, 9, 21, 23, 57, 0).getTime();
    ensureBackfilled();
    setEyesFreeOn(true, 'test');
    answer(60, 2000); // met at 23:59:00
    expect(pendingMoment()).toBe(momentLine(1));
    now = new Date(2026, 9, 22, 0, 0, 10).getTime(); // 70 s later, a new day
    expect(sayMomentAtPause({ ...DEFAULT_SETTINGS.audio })).toBe(0);
    expect(speak).not.toHaveBeenCalled();
  });

  it('a history drill at the 2000-row cap still credits every answer', () => {
    const s = structuredClone(EMPTY_STATS);
    const row = (date: string) => ({ date, runningCount: 4, decksRemaining: 2, correctTc: 2, correct: true });
    s.trueCount = { history: Array.from({ length: HISTORY_CAP }, () => row('2026-01-01T10:00:00.000Z')) };
    map.set('bjtrainer.stats.v1', JSON.stringify(s));
    ensureBackfilled();
    for (let i = 0; i < 10; i++) {
      now += 5000;
      const cur = loadStats();
      expect(cur.trueCount.history).toHaveLength(HISTORY_CAP);
      saveStats({ ...cur, trueCount: { history: [...cur.trueCount.history, row(new Date(now).toISOString())] } });
    }
    expect(loadProgress().days['2026-10-21'].answers).toBe(10);
    expect(loadProgress().days['2026-10-21'].activeMs).toBe(45_000);
  });

  it('not eyes-free: no line is queued', () => {
    ensureBackfilled();
    answer(60, 2000);
    expect(pendingMoment()).toBeNull();
  });

  it('honours the goal setting', () => {
    saveSettings({ ...DEFAULT_SETTINGS, habits: { goal: 'easy' } });
    ensureBackfilled();
    answer(30, 120_000);
    expect(loadProgress().days['2026-10-21'].met).toBe(true);
  });

  it('emits an unlock when an achievement is crossed, and dates it', () => {
    ensureBackfilled();
    answer(100, 2000);
    const unlocks = events.filter((e): e is Extract<HabitEvent, { kind: 'unlock' }> => e.kind === 'unlock').flatMap((e) => e.ids);
    expect(unlocks).toContain('answers-100');
    expect(loadProgress().earned['answers-100']).toBe(new Date(now).toISOString());
  });

  it('a streak across days, a missed day with and without a freeze', () => {
    ensureBackfilled();
    for (let d = 0; d < 7; d++) {
      now = new Date(2026, 9, 1 + d, 9, 0).getTime();
      answer(60, 2000);
    }
    expect(streakNow().current).toBe(7);
    expect(streakNow().freezes).toBe(1);
    // Skip the 8th; on the 9th the freeze has covered it.
    now = new Date(2026, 9, 9, 9, 0).getTime();
    expect(streakNow().current).toBe(7);
    expect(streakNow().frozen.has('2026-10-08')).toBe(true);
    answer(60, 2000);
    expect(streakNow().current).toBe(8);
    // Skip the 10th with no freeze: on the 11th the streak is gone.
    now = new Date(2026, 9, 11, 9, 0).getTime();
    expect(streakNow().current).toBe(0);
    expect(streakNow().longest).toBe(8);
  });
});

describe('backfill', () => {
  const history = (): Stats => ({
    ...structuredClone(EMPTY_STATS),
    mistakes: { ...EMPTY_STATS.mistakes, correct: 150 },
    countDrill: {
      history: [1, 2, 3].map((d) => ({ date: new Date(2026, 9, d, 10).toISOString(), cards: 52, intervalMs: 800, correct: true })),
    },
    latencyHistory: [1, 2, 3].flatMap((d) =>
      Array.from({ length: 60 }, (_, i) => ({ category: 'hard' as const, elapsedMs: 900, correct: true, date: new Date(2026, 9, d, 11, 0, i * 5).toISOString() })),
    ),
  });

  it('earns from history once, quietly, with one summary event; deterministic', () => {
    map.set('bjtrainer.stats.v1', JSON.stringify(history()));
    const a = ensureBackfilled();
    expect(Object.keys(a.days).sort()).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
    expect(a.earned['streak-3']).toBe('2026-10-03');
    expect(a.earned['answers-100']).toBe('');
    const summaries = events.filter((e) => e.kind === 'backfill');
    expect(summaries).toHaveLength(1);
    // A second call changes nothing and says nothing.
    const b = ensureBackfilled();
    expect(b).toEqual(a);
    expect(events.filter((e) => e.kind === 'backfill')).toHaveLength(1);
    // A fresh install from the same history gives the same record.
    map.delete(PROGRESS_KEY);
    expect(ensureBackfilled()).toEqual(a);
    // The history's answers are a baseline, not today's answers.
    answer(1);
    expect(loadProgress().days['2026-10-21'].answers).toBe(1);
  });

  it('rides in the backup and comes back on restore without counting as answers', () => {
    ensureBackfilled();
    answer(5);
    const backup = exportAll();
    expect(JSON.parse(backup).progress.days['2026-10-21'].answers).toBe(5);
    map.clear();
    expect(importAll(backup).ok).toBe(true);
    expect(loadProgress().days['2026-10-21'].answers).toBe(5);
    answer(1);
    expect(loadProgress().days['2026-10-21'].answers).toBe(6);
  });
});
