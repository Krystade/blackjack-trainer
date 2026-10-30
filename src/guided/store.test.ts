import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/speech', () => ({
  speak: vi.fn(),
  estimateSpeechMs: (t: string) => t.length * 60,
}));

import { _setStorage, exportAll, importAll, loadStats, saveStats } from '../store/persist';
import { applyEvents } from '../store/stats';
import type { GradedEvent } from '../engine/grade';
import {
  _resetHabitsForTest,
  _setHabitClockForTest,
  checkAchievementsNow,
  ensureBackfilled,
  installHabits,
  loadProgress,
  onHabitEvent,
  onStatsSaved,
  type HabitEvent,
} from '../habits/progressStore';
import type { PlannedSegment } from './plan';
import { addTally, begin, finishSegment, newSession, pause, resume } from './session';
import { GUIDED_KEY, loadGuided, normalizeGuidedStore, readSession, recordFinished, saveActive } from './store';
import { tallyDelta, tallySignature } from './tally';

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

const PLAN: PlannedSegment[] = [
  { id: 'warmup', minutes: 2, target: { kind: 'answers', n: 5 }, weak: true, cells: ['hard-16-10'] },
  { id: 'count', minutes: 3, target: { kind: 'time', ms: 180_000 }, weak: false },
];

let map: Map<string, string>;
let now = 0;

beforeEach(() => {
  map = new Map();
  _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  _resetHabitsForTest();
  now = new Date(2026, 9, 22, 9, 0).getTime();
  _setHabitClockForTest(() => now);
  installHabits();
  ensureBackfilled();
});
afterEach(() => {
  _setHabitClockForTest(null);
  _setStorage(null);
});

describe('guided store', () => {
  it('keeps the session in progress, and reads it back field for field', () => {
    const s = begin(resume(pause(addTally(begin(newSession(15, true, PLAN, now, '2026-10-22')), { answers: 2, right: 1 }))));
    expect(s.progress[0]).toMatchObject({ windowAnswers: 2, windowMs: 0 });
    saveActive(s);
    expect(loadGuided().active).toEqual(s);
    saveActive(null);
    expect(loadGuided().active).toBeNull();
  });

  it('a malformed blob reads as an empty store, a malformed session as none', () => {
    map.set(GUIDED_KEY, '{not json');
    expect(loadGuided()).toEqual({ version: 1, active: null, history: [], completed: 0 });
    expect(readSession({ version: 1, plan: [{ id: 'nope' }], progress: [{}] })).toBeNull();
    expect(normalizeGuidedStore({ version: 1, active: { version: 1 }, history: 'x', completed: -3 })).toEqual({
      version: 1,
      active: null,
      history: [],
      completed: 0,
    });
  });

  it('a finished session leaves the resume slot, joins the history once, and counts when completed', () => {
    let s = addTally(begin(newSession(15, false, PLAN, now, '2026-10-22')), { answers: 5, right: 4 });
    s = finishSegment(addTally(begin(finishSegment(s)), { answers: 1, right: 1 }));
    saveActive(s);
    const store = recordFinished(s);
    expect(store.active).toBeNull();
    expect(store.history[0]!.rows).toEqual([
      { id: 'warmup', answers: 5, right: 4 },
      { id: 'count', answers: 1, right: 1 },
    ]);
    expect(store.completed).toBe(1);
    expect(recordFinished(s).completed).toBe(1);
    expect(loadGuided().history).toHaveLength(1);
  });

  it('is carried by a backup', () => {
    recordFinished(finishSegment(finishSegment(addTally(begin(newSession(5, false, PLAN, now, 'd')), { answers: 3, right: 3 }))));
    const blob = exportAll();
    map.clear();
    expect(importAll(blob).ok).toBe(true);
    expect(loadGuided().completed).toBe(1);
  });
});

describe('through the habit hooks', () => {
  it('every stats save reaches the guided listener, after the daily goal has been credited', () => {
    const seen: number[] = [];
    // What the habit record held each time the listener ran. Recorded, and
    // judged OUTSIDE the listener: tellSaveListeners swallows anything a
    // listener throws, so an expect() in there could never fail.
    const creditedWhenTold: number[] = [];
    let sig = tallySignature(loadStats());
    const off = onStatsSaved((written, replaced, untrimmed) => {
      const t = tallyDelta(sig, untrimmed);
      sig = tallySignature(written);
      if (!replaced) seen.push(t.answers);
      creditedWhenTold.push(loadProgress().days['2026-10-22']?.answers ?? 0);
    });
    for (let i = 0; i < 3; i++) {
      now += 4000;
      saveStats(applyEvents(loadStats(), [ev(i !== 1)]));
    }
    off();
    saveStats(applyEvents(loadStats(), [ev()]));
    expect(seen).toEqual([1, 1, 1]);
    // The day already held each answer when the listener heard of it.
    expect(creditedWhenTold).toEqual([1, 2, 3]);
    expect(loadProgress().days['2026-10-22']!.answers).toBe(4);
  });

  it('finishing a guided session earns "Guided start" through the achievement check', () => {
    const events: HabitEvent[] = [];
    onHabitEvent((e) => events.push(e));
    expect(loadProgress().earned['guided-1']).toBeUndefined();
    let s = addTally(begin(newSession(15, false, PLAN, now, '2026-10-22')), { answers: 5, right: 5 });
    s = finishSegment(addTally(begin(finishSegment(s)), { answers: 1, right: 0 }));
    recordFinished(s);
    checkAchievementsNow();
    expect(loadProgress().earned['guided-1']).toBeTruthy();
    expect(events).toContainEqual({ kind: 'unlock', ids: ['guided-1'] });
    expect(loadProgress().earned['guided-7']).toBeUndefined();
  });
});
