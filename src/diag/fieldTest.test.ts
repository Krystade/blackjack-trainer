import { describe, it, expect, beforeEach } from 'vitest';
import {
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  DEFAULT_FIELD_TEST_CONDITION,
  stepsForMotion,
  stepsForCondition,
  motionForCondition,
  stampFieldTest,
  applyFieldTestSetup,
  describeFieldTestSetup,
} from './fieldTest';
import type { Settings } from '../store/types';
import { readDiagnosticLog, clearDiagnosticLog } from './diagnosticLog';

describe('the protocol itself', () => {
  it('has unique step ids, because the log is keyed on them', () => {
    const ids = FIELD_TEST_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique condition ids for the same reason', () => {
    const ids = FIELD_TEST_CONDITIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('opens on a condition that exists', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain(DEFAULT_FIELD_TEST_CONDITION);
  });

  /**
   * Every step is an instruction, a stamp and an expectation. A step missing
   * the third is the failure this whole panel exists to prevent: something
   * done in the car that nobody can check against the log afterwards.
   */
  it('tells you what to do, what to press, and what should show up', () => {
    for (const step of FIELD_TEST_STEPS) {
      expect(step.instruction.length, step.id).toBeGreaterThan(0);
      expect(step.stamp.length, step.id).toBeGreaterThan(0);
      expect(step.expect.length, step.id).toBeGreaterThan(0);
    }
  });

  /**
   * Order is load-bearing: opening the microphone is what takes the wheel
   * away, so every wheel step that is supposed to WORK has to come first.
   *
   * Asserted WITHIN the parked run rather than across the whole list, because
   * that is where these steps now meet -- `spoke` is in the driving run, and
   * an ordering assertion over a list nobody follows end to end would be
   * checking a sequence that never happens.
   */
  it('tests the wheel before it opens the microphone, inside the parked run', () => {
    const order = stepsForMotion('parked').map((s) => s.id);
    expect(order).toContain('wheel-after-mic');
    for (const worksWithMicShut of ['press-forward', 'press-back', 'wheel-gap']) {
      expect(order.indexOf(worksWithMicShut), worksWithMicShut).toBeGreaterThanOrEqual(0);
      // ...and the one that is expected to FAIL comes after, on purpose.
      expect(order.indexOf(worksWithMicShut), worksWithMicShut).toBeLessThan(
        order.indexOf('wheel-after-mic'),
      );
    }
  });

  /**
   * The audio check is the precondition for everything below it in EITHER
   * run: a wheel press is pointless if nothing is playing, and so is a spoken
   * answer. A filter that dropped it from one run would leave that run's
   * first real step resting on something nobody established.
   */
  it('opens both runs with the audio check', () => {
    for (const motion of ['parked', 'driving'] as const) {
      expect(stepsForMotion(motion)[0]?.id, motion).toBe('audio-out');
    }
  });

  it('keeps the speakerphone control condition, which is the whole comparison', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain('speakerphone');
  });
});

describe('the parked/driving split', () => {
  it('gives every step a run, so none is added without a decision', () => {
    for (const step of FIELD_TEST_STEPS) {
      expect(['parked', 'driving', 'either'], step.id).toContain(step.motion);
    }
  });

  it('puts every step in at least one run', () => {
    const covered = new Set([
      ...stepsForMotion('parked').map((s) => s.id),
      ...stepsForMotion('driving').map((s) => s.id),
    ]);
    for (const step of FIELD_TEST_STEPS) expect(covered, step.id).toContain(step.id);
  });

  /**
   * The load-bearing assignment. `wheel-gap` is what separates the shipped
   * fix from the 2026-09-19 bug, and it asks for a press into a silence you
   * have to HEAR arrive -- which at 70mph you cannot reliably locate, and
   * cannot safely stamp. If it ever migrates to the driving run the protocol
   * still looks complete and stops being able to answer its own question.
   */
  it('keeps the step that discriminates the fix in the parked run', () => {
    expect(stepsForMotion('parked').map((s) => s.id)).toContain('wheel-gap');
    expect(stepsForMotion('driving').map((s) => s.id)).not.toContain('wheel-gap');
  });

  /**
   * No wheel step belongs at speed. Button routing is decided by the
   * Bluetooth session, not by cabin noise, so driving buys nothing -- and
   * every one of these ends in tapping the screen.
   */
  it('keeps every wheel step out of the driving run', () => {
    const driving = stepsForMotion('driving').map((s) => s.id);
    for (const id of ['press-forward', 'press-back', 'wheel-gap', 'wheel-dead', 'wheel-after-mic']) {
      expect(driving, id).not.toContain(id);
    }
  });

  /** ...and conversely, the two that a driveway genuinely cannot answer. */
  it('keeps the microphone steps out of the parked run', () => {
    const parked = stepsForMotion('parked').map((s) => s.id);
    expect(parked).not.toContain('spoke');
    expect(parked).not.toContain('spoke-over');
  });

  /**
   * The safety property, stated as an inequality rather than a count so it
   * survives steps being added: whatever the protocol grows into, the run
   * performed at speed stays the smaller one.
   */
  it('asks for less at speed than it does parked', () => {
    expect(stepsForMotion('driving').length).toBeLessThan(stepsForMotion('parked').length);
    expect(stepsForMotion('driving').length).toBeGreaterThan(0);
  });

  it('offers a run of each kind to pick', () => {
    const motions = FIELD_TEST_CONDITIONS.map((c) => c.motion);
    expect(motions).toContain('parked');
    expect(motions).toContain('driving');
  });

  it('routes a condition to its own run', () => {
    expect(stepsForCondition('car')).toEqual(stepsForMotion('parked'));
    expect(stepsForCondition('freeway')).toEqual(stepsForMotion('driving'));
  });

  /**
   * An unknown condition -- a run saved under an id a later release dropped
   * -- must land in the stationary run. The failure direction matters: the
   * wrong guess here either shows a parked driver some extra steps, or asks
   * a moving one to do things the protocol deliberately keeps off the road.
   */
  it('falls back to parked for a condition it does not recognise', () => {
    expect(motionForCondition('a-condition-from-a-later-release')).toBe('parked');
  });

  it('keeps the speakerphone control on the same side as the route it controls', () => {
    expect(motionForCondition('speakerphone')).toBe(motionForCondition('freeway'));
  });
});

describe('stamping an intent', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  it('writes the step and the condition it was run under', () => {
    stampFieldTest('press-forward', 'car');
    const entry = readDiagnosticLog().find((e) => e.category === 'test');
    expect(entry?.event).toBe('press-forward');
    expect(entry?.detail?.condition).toBe('car');
  });

  it('carries the condition on every stamp, not once per run', () => {
    // A run gets abandoned and restarted and the log survives reloads, so a
    // condition written once would be read against the wrong half of the file.
    stampFieldTest('press-forward', 'car');
    stampFieldTest('press-back', 'speakerphone');
    const conditions = readDiagnosticLog()
      .filter((e) => e.category === 'test')
      .map((e) => e.detail?.condition);
    expect(conditions).toEqual(['car', 'speakerphone']);
  });
});

describe('a step that sets itself up', () => {
  /**
   * The complaint this answers, in full: "I need it to set the settings"
   * (2026-09-19). A step whose preconditions are only DESCRIBED gets run
   * under the wrong ones, and a run under the wrong preconditions is
   * indistinguishable in the log from a correct one.
   */
  it('turns on everything the wheel needs, which is the point of the protocol', () => {
    const step = FIELD_TEST_STEPS.find((s) => s.id === 'press-forward')!;
    expect(step.setup).toBeDefined();
    expect(step.setup?.audioEnabled).toBe(true);
    // Without clips there is no media element, so no wheel button can reach
    // the app at all -- see audio/carControls.ts. A wheel step run with live
    // TTS proves nothing.
    expect(step.setup?.useClips).toBe(true);
    // And the microphone flips the car to its hands-free route, which takes
    // the wheel away.
    expect(step.setup?.voice).toBe(false);
  });

  /**
   * Eyes-free is the switch that decides whether the app speaks at all, and
   * it used to live inside each drill's own React state -- unreachable from
   * here. A step-one that turned audio on and left this off would be a silent
   * step one, and every step below it would be measuring nothing.
   */
  it('turns on the toggle that actually makes a drill speak', () => {
    const step = FIELD_TEST_STEPS.find((s) => s.id === 'audio-out')!;
    expect(step.setup?.eyesFree).toBe(true);
  });

  it('opens the microphone only for the steps that are about the microphone', () => {
    const wantsMic = FIELD_TEST_STEPS.filter((s) => s.setup?.voice === true).map((s) => s.id);
    expect(wantsMic).toEqual(['spoke', 'spoke-over', 'wheel-after-mic']);
  });

  it('applies exactly what a step asked for and nothing else', () => {
    const base = {
      theme: 'dark',
      drill: { wheelMode: 'talk', shotClockMs: 4000 },
      audio: { enabled: false, useClips: false, muted: true, volume: 0.7 },
    } as unknown as Settings;

    const next = applyFieldTestSetup(base, {
      audioEnabled: true,
      useClips: true,
      muted: false,
      wheelMode: 'answer',
    });

    expect(next.audio.enabled).toBe(true);
    expect(next.audio.useClips).toBe(true);
    expect(next.audio.muted).toBe(false);
    expect(next.drill.wheelMode).toBe('answer');
    // Untouched settings survive: this runs mid-session over whatever the
    // operator had, and a protocol that reset their volume would be its own
    // little disaster in a moving car.
    expect(next.audio.volume).toBe(0.7);
    expect(next.drill.shotClockMs).toBe(4000);
    expect(next.theme).toBe('dark');
  });

  it('leaves a setting alone when the step did not name it', () => {
    const base = {
      drill: { wheelMode: 'talk' },
      audio: { enabled: false, useClips: true, muted: true },
    } as unknown as Settings;

    const next = applyFieldTestSetup(base, { audioEnabled: true });

    expect(next.audio.enabled).toBe(true);
    expect(next.audio.muted).toBe(true);
    expect(next.audio.useClips).toBe(true);
    expect(next.drill.wheelMode).toBe('talk');
  });

  it('changes nothing at all for a step with no setup', () => {
    const base = { audio: { enabled: false } } as unknown as Settings;
    expect(applyFieldTestSetup(base, undefined)).toBe(base);
  });

  /**
   * The operator has to be able to tell "the app set this" from "the app
   * assumed this", or a run under the wrong settings looks exactly like a
   * correct one.
   */
  it('says out loud what it changed', () => {
    const text = describeFieldTestSetup({ audioEnabled: true, useClips: true, voice: false });
    expect(text).toContain('audio on');
    expect(text).toContain('recorded voice on');
    expect(text).toContain('microphone OFF');
  });

  it('distinguishes a microphone it opened from one it shut', () => {
    expect(describeFieldTestSetup({ voice: true })).toContain('microphone ON');
    expect(describeFieldTestSetup({ voice: false })).toContain('microphone OFF');
  });

  it('says so plainly when a step changes nothing', () => {
    expect(describeFieldTestSetup(undefined)).toMatch(/Nothing changed/);
  });
});

describe('the gap the 2026-09-19 drive found', () => {
  /**
   * "Buttons worked only when the bot was talking." That is the app losing
   * the phone's now-playing slot the moment a clip ends (audio/audioFocus.ts).
   * A protocol that only ever presses the wheel DURING speech cannot tell the
   * difference between fixed and still broken, so the silent press is its own
   * step, and it comes after the two that press during speech.
   */
  it('presses the wheel in silence as well as during speech', () => {
    const order = FIELD_TEST_STEPS.map((s) => s.id);
    expect(order).toContain('wheel-gap');
    expect(order.indexOf('wheel-gap')).toBeGreaterThan(order.indexOf('press-forward'));
    expect(order.indexOf('wheel-gap')).toBeLessThan(order.indexOf('spoke'));
  });
});
