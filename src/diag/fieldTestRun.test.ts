import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readFieldTestRun,
  resumeFieldTestRun,
  startFieldTestRun,
  stopFieldTestRun,
  setFieldTestCondition,
  goToFieldTestStep,
  countStampedSteps,
  markFieldTestStamped,
  subscribeFieldTestRun,
  fieldTestBefore,
  markFieldTestBeforeHandedBack,
  markFieldTestBeforeOwed,
  setFieldTestBefore,
  unspentFieldTestBefore,
  _resetFieldTestRunForTest,
  fieldTestRunAgeMs,
  fieldTestRunIsLive,
  fieldTestRunIsResumable,
  RUN_LIVE_MS,
  RUN_RESUMABLE_MS,
} from './fieldTestRun';
import { FIELD_TEST_STEPS } from './fieldTest';
import { readDiagnosticLog } from './diagnosticLog';

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
    markFieldTestStamped('wheel-gap');
    markFieldTestStamped('wheel-gap');
    const before = readFieldTestRun();

    // Drop the cached copy and keep the bytes -- a remount, or a mid-drive
    // reload by the update check.
    forgetInMemoryOnly();

    const after = readFieldTestRun();
    expect(after.stepIndex).toBe(4);
    expect(after.stamps['car:wheel-gap']).toBe(2);
    expect(after.condition).toBe(before.condition);
    // ...but NOT active. Restoring a run as active would mount the running
    // screen straight onto whichever step was open, and `mic-route` declares
    // `voice: true` -- so a stored run would open the microphone from a single
    // navigation tap. See the privacy test below.
    expect(after.active).toBe(false);
  });

  it('counts repeat stamps rather than swallowing them', () => {
    startFieldTestRun('car');
    markFieldTestStamped('good');
    markFieldTestStamped('good');
    markFieldTestStamped('bad');

    expect(readFieldTestRun().stamps).toEqual({ 'car:good': 2, 'car:bad': 1 });
  });

  /**
   * THE TEST THAT ENCODED THE ONE-TAP DESTROYER, replaced.
   *
   * It asserted that changing condition zeroed the position and emptied the
   * stamps -- pinning the behaviour as correct. The picker sits directly above
   * Resume on the start gate, which is exactly the screen an interrupted run
   * returns to, and it had no guard at all while Finish (which preserves
   * everything) had a two-tap one. A single mis-tap took a run at step 7 with
   * three stamps and made even the Resume button disappear, because its
   * `stepIndex > 0` guard no longer held.
   *
   * The justification for clearing was that the same step on a different route
   * is a different measurement. That is true and it is already handled: every
   * answer carries its own condition into the log, so the two measurements are
   * distinguishable without destroying the operator's place.
   */
  it('keeps the place and the ticks when the route changes', () => {
    startFieldTestRun('car');
    markFieldTestStamped('wheel-gap');
    goToFieldTestStep(3);

    setFieldTestCondition('speakerphone');

    const run = readFieldTestRun();
    expect(run.condition).toBe('speakerphone');
    // STILL KEYED 'car', because that is where it was measured. The ticks
    // survive the switch (see above) but they do not become freeway results
    // just because the operator pulled out of the car park.
    expect(run.stamps).toEqual({ 'car:wheel-gap': 1 });
    expect(run.stepIndex).toBe(3);
  });

  it('records where the route changed, so the two halves are separable', () => {
    startFieldTestRun('car');
    goToFieldTestStep(5);
    setFieldTestCondition('freeway');

    // The LAST one: the log is a ring buffer shared across this file's tests,
    // and an earlier test in the same run also changes condition.
    const all = readDiagnosticLog().filter((e) => e.event === 'condition-changed');
    const entry = all[all.length - 1];
    expect(entry?.detail?.from).toBe('car');
    expect(entry?.detail?.to).toBe('freeway');
    expect(entry?.detail?.atStep).toBe(5);
  });

  it('starting over is still how the ticks are cleared', () => {
    startFieldTestRun('car');
    markFieldTestStamped('wheel-gap');
    goToFieldTestStep(3);

    startFieldTestRun('speakerphone');

    const run = readFieldTestRun();
    expect(run.stamps).toEqual({});
    expect(run.stepIndex).toBe(0);
  });

  it('will not walk off either end of the protocol', () => {
    startFieldTestRun('car');
    goToFieldTestStep(-3);
    expect(readFieldTestRun().stepIndex).toBe(0);
    goToFieldTestStep(999);
    expect(readFieldTestRun().stepIndex).toBe(FIELD_TEST_STEPS.length - 1);
  });

  /**
   * Every condition runs the same steps now, so the ceiling is one number.
   * It was two: the driving run was a filtered subset, which is precisely
   * what left a moving operator with no wheel steps ("I never said I wanted
   * to completely drop using the buttons"). Asserted for a driving condition
   * specifically, so that reintroducing a per-condition filter fails here.
   */
  it('stops at the same last step whichever condition it is in', () => {
    startFieldTestRun('freeway');
    goToFieldTestStep(999);
    expect(readFieldTestRun().stepIndex).toBe(FIELD_TEST_STEPS.length - 1);
    startFieldTestRun('car');
    goToFieldTestStep(999);
    expect(readFieldTestRun().stepIndex).toBe(FIELD_TEST_STEPS.length - 1);
  });

  it('stops without forgetting where it got to', () => {
    startFieldTestRun('car');
    goToFieldTestStep(2);
    markFieldTestStamped('wheel-gap');

    stopFieldTestRun();

    const run = readFieldTestRun();
    expect(run.active).toBe(false);
    // Stopping is "put the panel away", not "throw the evidence out" -- the
    // Settings list still ticks what was done.
    expect(run.stepIndex).toBe(2);
    expect(run.stamps['car:wheel-gap']).toBe(1);
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
    // Restored, but parked at the gate rather than running -- see the privacy
    // test below.
    expect(run.active).toBe(false);
    expect(run.stepIndex).toBe(FIELD_TEST_STEPS.length - 1);
  });

  /** Same rescue, for a stored DRIVING run. */
  it('pulls a stored driving run back to the last step', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'freeway', stepIndex: 99, stamps: {} }),
    );
    forgetInMemoryOnly();

    expect(readFieldTestRun().stepIndex).toBe(FIELD_TEST_STEPS.length - 1);
  });

  /**
   * THE PRIVACY RULE, pinned.
   *
   * `mic-route` declares `voice: true`, and the running screen opens the
   * recogniser from whatever step it mounts on. So a run restored as active
   * would turn the microphone on because the operator opened a screen --
   * yesterday's abandoned run standing in for consent, and the orange iOS
   * indicator appearing with no tap that asked for it. The operator has hit a
   * stuck microphone once already.
   */
  it('never restores a run as active, whatever the storage says', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'car', stepIndex: 11, stamps: {} }),
    );
    forgetInMemoryOnly();

    expect(readFieldTestRun().active).toBe(false);
    // ...and the position is still there, so resuming costs one tap.
    expect(readFieldTestRun().stepIndex).toBe(11);
  });

  /**
   * Resuming and starting are different operations, and conflating them is
   * what made a stray Finish tap cost the whole run.
   */
  it('resumes where it was, while starting over clears the ticks', () => {
    startFieldTestRun('car');
    goToFieldTestStep(9);
    markFieldTestStamped('wheel-gap');
    stopFieldTestRun();

    resumeFieldTestRun();
    expect(readFieldTestRun().active).toBe(true);
    expect(readFieldTestRun().stepIndex).toBe(9);
    expect(readFieldTestRun().stamps['car:wheel-gap']).toBe(1);

    startFieldTestRun('car');
    expect(readFieldTestRun().stepIndex).toBe(0);
    expect(readFieldTestRun().stamps).toEqual({});
  });

  /**
   * `finish()` reports `Object.keys(stamps).length` as how many steps were
   * stamped, so ids left over from a release that removed a step made an
   * abandoned run look more complete than it was.
   */
  it('forgets stamps for steps the protocol no longer has', () => {
    const store = installStorage();
    store.set(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({
        active: true,
        condition: 'car',
        stepIndex: 0,
        stamps: { 'wheel-gap': 1, 'voice-which': 3 },
      }),
    );
    forgetInMemoryOnly();

    const stamps = readFieldTestRun().stamps;
    // Stored bare by a build from before the keys carried the condition, and
    // adopted onto the run's own condition rather than thrown away: losing a
    // resumed run's ticks is the failure this pruning exists to prevent.
    expect(stamps['car:wheel-gap']).toBe(1);
    // `voice-which` was deleted when the protocol stopped asking the operator
    // to identify the voice the app already records.
    expect(stamps['car:voice-which']).toBeUndefined();
    expect(stamps['voice-which']).toBeUndefined();
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
      JSON.stringify({
        active: true,
        condition: 'car',
        stepIndex: 0,
        stamps: { 'route-1': 'x', 'wheel-gap': 2 },
      }),
    );
    forgetInMemoryOnly();

    expect(readFieldTestRun().stamps).toEqual({ 'car:wheel-gap': 2 });
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

/* ------------------------------------------------------------------------ */
/* Another tab holding the same run                                          */
/* ------------------------------------------------------------------------ */

/**
 * The run is cached in a module variable and written back as a WHOLE blob, so
 * it is exactly the shape `crossTab.ts` exists for -- and it was not enrolled.
 * Two tabs is not a stretch on the device this runs on: the PWA and Safari can
 * both hold the app, and the field test survives navigation and reloads
 * precisely so it can be left open. The tab that was not looked at for a step
 * keeps the run it read ten minutes ago; the next stamp saves that snapshot
 * over the real one, and the ticks collected in the car are gone with nothing
 * to undo.
 */
describe('a run when another tab writes it', () => {
  type Handler = (event: unknown) => void;
  let handlers: Set<Handler>;
  const originalWindow = (globalThis as { window?: unknown }).window;

  beforeEach(() => {
    handlers = new Set();
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: (type: string, h: Handler) => {
          if (type === 'storage') handlers.add(h);
        },
        removeEventListener: (type: string, h: Handler) => {
          if (type === 'storage') handlers.delete(h);
        },
      },
      configurable: true,
      writable: true,
    });
    _resetFieldTestRunForTest();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  /** What the browser does in THIS tab when the OTHER tab writes the key. */
  function otherTabWrites(next: unknown): void {
    const raw = JSON.stringify(next);
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      raw,
    );
    for (const h of handlers) {
      h({ key: 'bjtrainer.fieldTestRun.v1', oldValue: null, newValue: raw });
    }
  }

  it('drops the snapshot it was holding and re-reads', () => {
    startFieldTestRun('car');
    goToFieldTestStep(2);
    expect(readFieldTestRun().stepIndex).toBe(2);

    otherTabWrites({ active: true, condition: 'car', stepIndex: 5, stamps: { 'route-1': 1 } });

    expect(readFieldTestRun().stepIndex).toBe(5);
    expect(readFieldTestRun().stamps).toEqual({ 'car:route-1': 1 });
  });

  it('does not then save its stale copy back over the newer run', () => {
    // The actual damage. Without the re-read, this stamp is written onto the
    // run this tab remembers -- step 2, no ticks -- and the other tab's five
    // steps of work is what lands in storage.
    startFieldTestRun('car');
    goToFieldTestStep(2);
    otherTabWrites({ active: true, condition: 'car', stepIndex: 5, stamps: { 'route-1': 1 } });

    markFieldTestStamped('mic-route');

    const saved = JSON.parse(
      (globalThis as unknown as { localStorage: Storage }).localStorage.getItem(
        'bjtrainer.fieldTestRun.v1',
      ) as string,
    );
    expect(saved.stepIndex).toBe(5);
    expect(saved.stamps).toEqual({ 'car:route-1': 1, 'car:mic-route': 1 });
  });

  it('tells whoever is rendering the panel', () => {
    // From the car this looks like the app moving on its own, so a subscriber
    // that is not told simply shows the wrong step until something else
    // happens to re-render it.
    startFieldTestRun('car');
    let calls = 0;
    subscribeFieldTestRun(() => {
      calls += 1;
    });
    otherTabWrites({ active: true, condition: 'car', stepIndex: 5, stamps: {} });
    expect(calls).toBe(1);
  });

  it('does not throw the tab that is driving out of its run', () => {
    // `coerce` refuses to restore a run as active, on purpose: a reload must
    // never reopen the microphone by itself. Applying that rule to a re-read
    // triggered by SOMEBODY ELSE'S write turned the other tab merely opening
    // the picker into this tab, mid-drive, falling back to the start gate and
    // handing the operator's settings back under them.
    startFieldTestRun('car');
    goToFieldTestStep(2);
    expect(readFieldTestRun().active).toBe(true);

    otherTabWrites({ active: false, condition: 'car', stepIndex: 5, stamps: {} });

    expect(readFieldTestRun().active, 'a second tab ended the drive').toBe(true);
    // ...and it still took the write's answer to everything it can answer.
    expect(readFieldTestRun().stepIndex).toBe(5);
  });

  it('leaves a tab that is not in a run out of one', () => {
    // The rule is "this tab keeps what only it knows", not "active is sticky".
    stopFieldTestRun();
    otherTabWrites({ active: true, condition: 'car', stepIndex: 5, stamps: {} });
    expect(readFieldTestRun().active).toBe(false);
  });

  it('says in the log that another tab did it', () => {
    startFieldTestRun('car');
    goToFieldTestStep(2);
    otherTabWrites({ active: true, condition: 'car', stepIndex: 5, stamps: {} });

    const entry = readDiagnosticLog()
      .filter((e) => e.category === 'test' && e.event === 'run-external-write')
      .at(-1);
    expect(entry, 'a step changing with nobody touching it must be explicable').toBeTruthy();
    expect(entry?.detail).toMatchObject({ from: 2, to: 5 });
  });
});

/**
 * What the operator had before the run, kept where a reload cannot reach it.
 *
 * The screen used to capture this in a ref on its first render. That works
 * until the app reloads mid-drive -- which the update check does by design,
 * and which `resumeFieldTestRun` exists for. After the reload the screen
 * mounts fresh and captures the settings the PROTOCOL wrote as though they
 * were the operator's, so the restore hands back `volume: 1.5`,
 * `wheelMode: 'answer'` and whatever `useClips` the last step imposed --
 * permanently. Three separate reviewers reached this by three different
 * routes, so it lives with the run now.
 */
describe('a run remembers what it took', () => {
  const before = {
    volume: 0.4,
    useClips: true,
    muted: false,
    enabled: true,
    wheelMode: 'talk',
  } as const;

  it('refuses a wheel mode the app has no branch for', () => {
    // The one field validated by TYPE rather than by value, then cast into a
    // two-value union at the call site. `mergeSettings` spreads without
    // validating, so an arbitrary string out of an old or corrupt run blob was
    // persisted into settings and survived every reload.
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({
        active: true,
        condition: 'car',
        stepIndex: 0,
        stamps: {},
        before: { volume: 0.4, useClips: true, muted: false, enabled: true, wheelMode: 'nonsense' },
      }),
    );
    expect(fieldTestBefore()).toBeUndefined();
  });

  it('accepts the two wheel modes that exist', () => {
    for (const mode of ['answer', 'talk'] as const) {
      // The module caches the run once read, and the cache outlives a bare
      // setItem -- so without this the second iteration re-read the first
      // one's value and the loop asserted nothing.
      _resetFieldTestRunForTest();
      localStorage.setItem(
        'bjtrainer.fieldTestRun.v1',
        JSON.stringify({
          active: true,
          condition: 'car',
          stepIndex: 0,
          stamps: {},
          before: { volume: 0.4, useClips: true, muted: false, enabled: true, wheelMode: mode },
        }),
      );
      expect(fieldTestBefore()?.wheelMode).toBe(mode);
    }
  });

  it('keeps the operator settings handed to it at the start', () => {
    startFieldTestRun('car', before);
    expect(fieldTestBefore()).toEqual(before);
  });

  it('still has them after the app reloads mid-drive', () => {
    startFieldTestRun('car', before);
    goToFieldTestStep(4);
    forgetInMemoryOnly();
    expect(fieldTestBefore(), 'the reload lost what the run took').toEqual(before);
  });

  it('still has them after a pause, a reload and a resume', () => {
    startFieldTestRun('car', before);
    goToFieldTestStep(4);
    stopFieldTestRun();
    forgetInMemoryOnly();
    resumeFieldTestRun();
    expect(fieldTestBefore()).toEqual(before);
  });

  it('does not let a later step overwrite them', () => {
    // The whole point of taking the snapshot once: every step writes real
    // settings, so anything re-captured later is the protocol's own state.
    startFieldTestRun('car', before);
    goToFieldTestStep(6);
    markFieldTestStamped('route-1');
    setFieldTestCondition('freeway');
    expect(fieldTestBefore()).toEqual(before);
  });

  it('reports nothing rather than junk when the stored snapshot is incomplete', () => {
    // A run begun by an older build, or a hand-edited blob. Restoring half a
    // settings object would be worse than falling back to the screen's own.
    const s = (globalThis as unknown as { localStorage: Storage }).localStorage;
    s.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'car', stepIndex: 2, stamps: {}, before: { volume: 0.4 } }),
    );
    forgetInMemoryOnly();
    expect(fieldTestBefore()).toBeUndefined();
  });
});

/**
 * A stamp records that a step was answered UNDER A CONDITION, and until now
 * the key said only which step.
 *
 * `setFieldTestCondition` deliberately keeps the position and the ticks when
 * the operator parks and then drives -- that is the right behaviour, and it
 * was fixed on purpose. But with a bare step id those parked answers then
 * counted toward the freeway leg, because nothing in the key said otherwise.
 * `run-end stamped=` is the single number that says how much of the protocol
 * a leg covered, and on the commonest mid-run event it over-reported by
 * exactly the part measured somewhere else.
 */
describe('stamps under more than one condition', () => {
  it('counts a step toward the condition it was answered under', () => {
    startFieldTestRun('car');
    markFieldTestStamped('route-1');
    markFieldTestStamped('route-2');
    setFieldTestCondition('freeway');
    markFieldTestStamped('route-short');

    const { stamps } = readFieldTestRun();
    expect(
      countStampedSteps(stamps, 'freeway'),
      'steps answered in the car park were counted as freeway results',
    ).toBe(1);
    expect(countStampedSteps(stamps, 'car')).toBe(2);
  });

  it('keeps the same step separable when it is answered under both', () => {
    startFieldTestRun('car');
    markFieldTestStamped('route-1');
    setFieldTestCondition('freeway');
    markFieldTestStamped('route-1');

    const { stamps } = readFieldTestRun();
    expect(stamps['car:route-1']).toBe(1);
    expect(stamps['freeway:route-1']).toBe(1);
    expect(countStampedSteps(stamps, 'freeway')).toBe(1);
  });

  it('reports the leg being left, not the whole run, when the route changes', () => {
    startFieldTestRun('car');
    markFieldTestStamped('route-1');
    markFieldTestStamped('route-2');
    setFieldTestCondition('freeway');
    markFieldTestStamped('route-short');
    setFieldTestCondition('speakerphone');

    const all = readDiagnosticLog().filter((e) => e.event === 'condition-changed');
    const last = all[all.length - 1];
    expect(last?.detail?.from).toBe('freeway');
    expect(last?.detail?.stamped, 'the freeway leg was credited with the car park steps').toBe(1);
  });

  it('survives a reload with each leg still attributed to its own condition', () => {
    startFieldTestRun('car');
    markFieldTestStamped('route-1');
    setFieldTestCondition('freeway');
    markFieldTestStamped('route-2');
    forgetInMemoryOnly();

    const { stamps } = readFieldTestRun();
    expect(countStampedSteps(stamps, 'car')).toBe(1);
    expect(countStampedSteps(stamps, 'freeway')).toBe(1);
  });
});

/**
 * Handing the settings back is not a once-per-run event, and treating it as
 * one broke restoring them.
 *
 * The screen restores on Finish, and again from the cleanup that covers
 * leaving by the tab bar, and again whenever React tears the subtree down and
 * puts it back. The first version DELETED the snapshot on the first of those,
 * so every later one had nothing to restore from and fell through to a whole
 * settings blob frozen on the screen — which after a mid-drive reload is the
 * protocol's own state. Reproduced end to end: a run handed back
 * `useClips: true` when the operator's own value was `false`.
 *
 * So the snapshot is marked, not deleted, and the two questions it used to
 * answer with one bit are now asked separately: "what did the operator have"
 * (always answerable) and "is this run still holding it" (not).
 */
describe('a snapshot that has been handed back', () => {
  const before = {
    volume: 0.4,
    useClips: true,
    muted: false,
    enabled: true,
    wheelMode: 'talk',
  } as const;

  it('can still be read, so giving it back twice gives back the same thing', () => {
    startFieldTestRun('car', before);
    markFieldTestBeforeHandedBack();
    expect(
      fieldTestBefore(),
      'a second restore had nothing to restore from and would have guessed',
    ).toEqual(before);
  });

  it('is no longer what a new run would seize', () => {
    // The other half of the pair, and the reason the mark exists at all: the
    // operator changes a setting between the car-park leg and the freeway leg,
    // and the freeway leg must not start from a snapshot taken before it.
    startFieldTestRun('car', before);
    markFieldTestBeforeHandedBack();
    expect(unspentFieldTestBefore()).toBeUndefined();
  });

  it('is what a new run would seize until it has been handed back', () => {
    startFieldTestRun('car', before);
    expect(unspentFieldTestBefore(), 'a fresh run does not owe what it took').toEqual(before);
  });

  it('is owed again once the protocol takes the settings back', () => {
    // A remount: the cleanup hands them back and the step effect immediately
    // seizes them again. Nothing was really handed back, and the next "Start
    // over" must not capture the protocol's own volume as the operator's.
    startFieldTestRun('car', before);
    markFieldTestBeforeHandedBack();
    markFieldTestBeforeOwed();
    expect(unspentFieldTestBefore()).toEqual(before);
  });

  it('is owed again when a resume re-takes it', () => {
    startFieldTestRun('car', before);
    markFieldTestBeforeHandedBack();
    const second = { ...before, volume: 0.9 } as const;
    setFieldTestBefore(second);
    expect(unspentFieldTestBefore(), 'the re-taken snapshot was born spent').toEqual(second);
  });

  it('is still spent after the app reloads', () => {
    // The mark has to survive the same reload the snapshot does, or a run
    // paused, reloaded and started over reverts whatever changed in between.
    startFieldTestRun('car', before);
    markFieldTestBeforeHandedBack();
    forgetInMemoryOnly();
    expect(unspentFieldTestBefore()).toBeUndefined();
    expect(fieldTestBefore(), 'the reload lost the values as well').toEqual(before);
  });

  it('is not marked when there is nothing to mark', () => {
    startFieldTestRun('car');
    markFieldTestBeforeHandedBack();
    expect(readFieldTestRun().beforeHandedBack).toBeUndefined();
  });

  it('leaves an unspent snapshot alone when nothing handed it back', () => {
    startFieldTestRun('car', before);
    markFieldTestBeforeOwed();
    expect(unspentFieldTestBefore()).toEqual(before);
  });
});

/**
 * Is somebody standing in this run right now?
 *
 * Two callers ask, and they have to agree: the update check, which reloads the
 * app from a visibility change and must not do that mid-protocol, and the
 * app's opening screen, which should come back to the field test after a
 * reload rather than dropping the operator on Home — but only while the run
 * is recent, or one abandoned drive owns every launch for a month.
 */
describe('how long ago the run was touched', () => {
  it('stamps every write, so no caller can forget to', () => {
    const before = Date.now();
    startFieldTestRun('car');
    const at = readFieldTestRun().touchedAt;
    expect(typeof at, 'a run was written with no sign of life on it').toBe('number');
    expect(at as number).toBeGreaterThanOrEqual(before);
  });

  it('counts a run being worked on as live', () => {
    startFieldTestRun('car');
    goToFieldTestStep(3);
    expect(fieldTestRunIsLive()).toBe(true);
    expect(fieldTestRunIsResumable()).toBe(true);
  });

  it('stops calling it live once the drive is over', () => {
    startFieldTestRun('car');
    goToFieldTestStep(3);
    const later = Date.now() + RUN_LIVE_MS + 1;
    expect(fieldTestRunIsLive(later), 'an abandoned run blocks updates forever').toBe(false);
    // ...but it is still worth coming back to for a while.
    expect(fieldTestRunIsResumable(later)).toBe(true);
  });

  it('expires as something to come back to, so one drive does not own every launch', () => {
    startFieldTestRun('car');
    goToFieldTestStep(3);
    expect(fieldTestRunIsResumable(Date.now() + RUN_RESUMABLE_MS + 1)).toBe(false);
  });

  it('is neither at step one, where a reload has nothing to hand back', () => {
    startFieldTestRun('car');
    expect(readFieldTestRun().stepIndex).toBe(0);
    expect(fieldTestRunIsLive()).toBe(false);
    expect(fieldTestRunIsResumable()).toBe(false);
  });

  it('is neither when no run was ever written', () => {
    expect(fieldTestRunAgeMs()).toBeUndefined();
    expect(fieldTestRunIsLive()).toBe(false);
    expect(fieldTestRunIsResumable()).toBe(false);
  });

  it('survives the reload it exists to be read across', () => {
    startFieldTestRun('car');
    goToFieldTestStep(3);
    const stored = JSON.parse(
      (globalThis as unknown as { localStorage: { getItem: (k: string) => string } }).localStorage.getItem(
        'bjtrainer.fieldTestRun.v1',
      ),
    ) as { touchedAt?: number };
    expect(
      typeof stored.touchedAt,
      'the stamp never reached storage, so a reload cannot read it',
    ).toBe('number');
    // ...and it is the value the in-memory run reports, not a second clock.
    expect(stored.touchedAt).toBe(readFieldTestRun().touchedAt);
  });
});

/**
 * A run read back from storage, when the build that reads it is not the build
 * that wrote it.
 *
 * Releases rename things. `before.wheelMode` is validated by value; the
 * condition was taken on trust, and it is the field the whole analysis is
 * keyed on — the stamps, the motion warning, and which column of the log a
 * step belongs to.
 */
describe('a run written by a build that called things something else', () => {
  it('reads an unknown condition as the default rather than carrying it', () => {
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'motorway', stepIndex: 3, stamps: {} }),
    );
    expect(readFieldTestRun().condition).toBe('car');
  });

  it('says in the log that it did, because a relabelled run is not a detail', () => {
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({ active: true, condition: 'motorway', stepIndex: 3, stamps: {} }),
    );
    readFieldTestRun();
    const entry = readDiagnosticLog()
      .filter((e) => e.category === 'test' && e.event === 'run-condition-unknown')
      .at(-1);
    expect(entry, 'the run changed condition with nothing saying so').toBeTruthy();
    expect(entry?.detail).toMatchObject({ was: 'motorway', read_as: 'car' });
  });

  it('carries the ticks across instead of stranding them under a dead prefix', () => {
    // `countStampedSteps` matches on `<condition>:`, so stamps left under the
    // old name are invisible: the operator resumes and the run says nothing
    // has been done.
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({
        active: true,
        condition: 'motorway',
        stepIndex: 3,
        stamps: { 'motorway:route-1': 1, 'motorway:route-2': 2 },
      }),
    );
    const restored = readFieldTestRun();
    expect(restored.stamps).toEqual({ 'car:route-1': 1, 'car:route-2': 2 });
    expect(countStampedSteps(restored.stamps, restored.condition)).toBe(2);
  });

  it('leaves a condition it does know alone', () => {
    localStorage.setItem(
      'bjtrainer.fieldTestRun.v1',
      JSON.stringify({
        active: true,
        condition: 'freeway',
        stepIndex: 3,
        stamps: { 'freeway:route-1': 1 },
      }),
    );
    const complaints = () =>
      readDiagnosticLog().filter((e) => e.event === 'run-condition-unknown').length;
    const before = complaints();
    const restored = readFieldTestRun();
    expect(restored.condition).toBe('freeway');
    expect(restored.stamps).toEqual({ 'freeway:route-1': 1 });
    expect(complaints() - before, 'a known condition was reported as unknown').toBe(0);
  });
});

/**
 * I9: the cross-tab listener, installed on a read that happened too early.
 *
 * The first read of the run can easily come from somewhere with no window —
 * a module-scope import, a node test, a server render. `subscribeToExternalWrites`
 * is inert there by design, but the flag saying "installed" was set anyway, so
 * the page went on to its whole life with no listener and no way to get one.
 */
describe('the cross-tab listener when the first read is too early', () => {
  const originalWindow = (globalThis as { window?: unknown }).window;

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });

  it('installs once a window exists, rather than latching on the inert call', () => {
    delete (globalThis as { window?: unknown }).window;
    readFieldTestRun(); // the too-early read

    const handlers = new Set<(e: unknown) => void>();
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener: (type: string, h: (e: unknown) => void) => {
          if (type === 'storage') handlers.add(h);
        },
        removeEventListener: () => {},
      },
      configurable: true,
      writable: true,
    });

    readFieldTestRun();
    expect(handlers.size, 'the page can no longer see another tab at all').toBe(1);

    const raw = JSON.stringify({ active: true, condition: 'car', stepIndex: 5, stamps: {} });
    localStorage.setItem('bjtrainer.fieldTestRun.v1', raw);
    for (const h of handlers) h({ key: 'bjtrainer.fieldTestRun.v1', oldValue: null, newValue: raw });
    expect(readFieldTestRun().stepIndex).toBe(5);
  });
});
