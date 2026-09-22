import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFieldTestRun,
  startFieldTestRun,
  stopFieldTestRun,
  setFieldTestCondition,
  goToFieldTestStep,
  markFieldTestStamped,
  subscribeFieldTestRun,
  _resetFieldTestRunForTest,
} from './fieldTestRun';
import { stepsForMotion } from './fieldTest';

/**
 * The one thing this module exists to guarantee: a run survives leaving the
 * screen it was started from.
 *
 * It has to, because every step of the protocol is performed somewhere the
 * protocol is not -- you cannot hear a drill speak from Settings. The
 * previous design held the run in Settings' React state, so following the
 * protocol destroyed it a step at a time. The operator stopped after four
 * (2026-09-19): "Can't have to go back and forth and have it reset all
 * progress."
 */

/** A localStorage good enough to prove persistence, and to make it fail. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

beforeEach(() => {
  installStorage();
  _resetFieldTestRunForTest();
});

afterEach(() => {
  _resetFieldTestRunForTest();
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe('a run', () => {
  it('starts inactive, so the panel is not up until asked for', () => {
    expect(readFieldTestRun().active).toBe(false);
  });

  it('starts at step one under the condition it was given', () => {
    startFieldTestRun('speakerphone');
    const run = readFieldTestRun();
    expect(run.active).toBe(true);
    expect(run.condition).toBe('speakerphone');
    expect(run.stepIndex).toBe(0);
    expect(run.stamps).toEqual({});
  });

  /**
   * THE WHOLE POINT. "Navigating away" is, to this module, the in-memory copy
   * being dropped -- which is what a React remount does. What comes back has
   * to be what was there.
   */
  it('survives the module losing its in-memory copy, which is what navigation costs', () => {
    startFieldTestRun('car');
    goToFieldTestStep(4);
    markFieldTestStamped('press-forward');
    markFieldTestStamped('press-forward');
    const before = readFieldTestRun();

    // Drop the cached copy and keep the bytes -- a remount, or a mid-drive
    // reload by the update check.
    forgetInMemoryOnly();

    const after = readFieldTestRun();
    expect(after).toEqual(before);
    expect(after.stepIndex).toBe(4);
    expect(after.stamps['press-forward']).toBe(2);
    expect(after.active).toBe(true);
  });

  it('counts repeat stamps rather than swallowing them', () => {
    startFieldTestRun('car');
    markFieldTestStamped('good');
    markFieldTestStamped('good');
    markFieldTestStamped('bad');

    expect(readFieldTestRun().stamps).toEqual({ good: 2, bad: 1 });
  });

  /**
   * The same step on a different route is a different measurement, so a tick
   * carried across would read as already done when it is not.
   */
  it('clears the ticks when the route changes', () => {
    startFieldTestRun('car');
    markFieldTestStamped('press-forward');
    goToFieldTestStep(3);

    setFieldTestCondition('speakerphone');

    const run = readFieldTestRun();
    expect(run.condition).toBe('speakerphone');
    expect(run.stamps).toEqual({});
    expect(run.stepIndex).toBe(0);
  });

  it('will not walk off either end of the protocol', () => {
    startFieldTestRun('car');
    goToFieldTestStep(-3);
    expect(readFieldTestRun().stepIndex).toBe(0);
    goToFieldTestStep(999);
    expect(readFieldTestRun().stepIndex).toBe(stepsForMotion('parked').length - 1);
  });

  /**
   * The end of the protocol is not one number. A driving run is the shorter
   * list (diag/fieldTest.ts), so a ceiling taken from the full set would let
   * a moving driver page past the last step they have into blank steps --
   * or, before this, into the parked wheel steps the split exists to keep
   * off the road.
   */
  it('stops at the end of the run it is actually in, not the longest one', () => {
    startFieldTestRun('freeway');
    goToFieldTestStep(999);
    const driving = stepsForMotion('driving').length;
    expect(readFieldTestRun().stepIndex).toBe(driving - 1);
    expect(driving).toBeLessThan(stepsForMotion('parked').length);
  });

  it('stops without forgetting where it got to', () => {
    startFieldTestRun('car');
    goToFieldTestStep(2);
    markFieldTestStamped('press-forward');

    stopFieldTestRun();

    const run = readFieldTestRun();
    expect(run.active).toBe(false);
    // Stopping is "put the panel away", not "throw the evidence out" -- the
    // Settings list still ticks what was done.
    expect(run.stepIndex).toBe(2);
    expect(run.stamps['press-forward']).toBe(1);
  });

  it('tells whoever is rendering it that something changed', () => {
    let calls = 0;
    const off = subscribeFieldTestRun(() => (calls += 1));
    startFieldTestRun('car');
    markFieldTestStamped('good');
    off();
    markFieldTestStamped('good');

    expect(calls).toBe(2);
  });
});

describe('a stored run that no longer fits', () => {
  /**
   * The step list changes between releases. A run saved when there were more
   * steps must not leave a reloaded app pointing past the end and rendering
   * nothing, which from the car is the panel having vanished mid-protocol.
   */
  it('is pulled back inside the protocol rather than dropped', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'car', stepIndex: 99, stamps: { good: 1 } }),
    );
    forgetInMemoryOnly();

    const run = readFieldTestRun();
    expect(run.active).toBe(true);
    expect(run.stepIndex).toBe(stepsForMotion('parked').length - 1);
  });

  /**
   * Same rescue, for a stored DRIVING run -- which is the case that needs the
   * condition resolved before the index is clamped, not after.
   */
  it('pulls a stored driving run back to its own last step', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'freeway', stepIndex: 99, stamps: {} }),
    );
    forgetInMemoryOnly();

    expect(readFieldTestRun().stepIndex).toBe(stepsForMotion('driving').length - 1);
  });

  it('survives outright garbage without taking the app down', () => {
    const store = installStorage();
    store.set('bjtrainer.fieldTestRun.v1', '{not json');
    forgetInMemoryOnly();

    expect(readFieldTestRun().active).toBe(false);
  });

  it('drops stamp counts that are not counts', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'car', stepIndex: 0, stamps: { a: 'x', b: 2 } }),
    );
    forgetInMemoryOnly();

    expect(readFieldTestRun().stamps).toEqual({ b: 2 });
  });
});

/**
 * Drop the module's cached copy while leaving storage alone.
 *
 * `_resetFieldTestRunForTest` clears both, because that is what a test usually
 * wants. Proving persistence needs the other half -- the state the app comes
 * back to after a remount -- so the bytes are captured first and put back.
 */
function forgetInMemoryOnly(): void {
  const s = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const raw = s.getItem('bjtrainer.fieldTestRun.v1');
  _resetFieldTestRunForTest();
  if (raw !== null) s.setItem('bjtrainer.fieldTestRun.v1', raw);
}
