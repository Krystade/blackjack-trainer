import { describe, it, expect, beforeEach } from 'vitest';
import {
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  DEFAULT_FIELD_TEST_CONDITION,
  ROUTE_ANSWERS,
  motionForCondition,
  stampFieldTest,
  logFieldTestStep,
  logFieldTestRunStart,
  logFieldTestRunEnd,
  applyFieldTestSetup,
  describeFieldTestSetup,
} from './fieldTest';
import type { Settings } from '../store/types';
import { readDiagnosticLog, clearDiagnosticLog } from './diagnosticLog';
import spokenPhrases from '../../scripts/spoken-phrases.json';

const ids = () => FIELD_TEST_STEPS.map((s) => s.id);

describe('the protocol itself', () => {
  it('has unique step ids, because the log is keyed on them', () => {
    expect(new Set(ids()).size).toBe(ids().length);
  });

  it('has unique condition ids for the same reason', () => {
    const c = FIELD_TEST_CONDITIONS.map((x) => x.id);
    expect(new Set(c).size).toBe(c.length);
  });

  it('opens on a condition that exists', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain(DEFAULT_FIELD_TEST_CONDITION);
  });

  /**
   * Every step must be answerable. A step with no responses is a dead end in
   * a moving car: the operator reaches it, has nothing to tap, and the run
   * stops there -- which is how the 2026-09-19 run ended.
   */
  it('gives every step something to say and something to tap', () => {
    for (const step of FIELD_TEST_STEPS) {
      expect(step.title.length, step.id).toBeGreaterThan(0);
      expect(step.instruction.length, step.id).toBeGreaterThan(0);
      expect(step.responses.length, step.id).toBeGreaterThan(0);
    }
  });

  it('keeps every response id unique within its step, since the id is the record', () => {
    for (const step of FIELD_TEST_STEPS) {
      const r = step.responses.map((x) => x.id);
      expect(new Set(r).size, step.id).toBe(r.length);
    }
  });

  it('keeps the speakerphone control condition, which is the whole comparison', () => {
    expect(FIELD_TEST_CONDITIONS.map((c) => c.id)).toContain('speakerphone');
  });

  it('offers both a stationary and a moving condition', () => {
    const motions = FIELD_TEST_CONDITIONS.map((c) => c.motion);
    expect(motions).toContain('parked');
    expect(motions).toContain('driving');
  });

  it('falls back to parked for a condition it does not recognise', () => {
    expect(motionForCondition('a-condition-from-a-later-release')).toBe('parked');
  });

  it('keeps the speakerphone control on the same side as the route it controls', () => {
    expect(motionForCondition('speakerphone')).toBe(motionForCondition('freeway'));
  });
});

describe('the test speaks for itself', () => {
  /**
   * The rewrite's whole premise, and the operator's complaint in one line:
   * "I don't know why we have to go to a drill in the first place." A step
   * that asks about the sound has to PRODUCE the sound, or following it means
   * running a drill alongside the test -- which is what happened twice, and
   * what filled both logs with flashcard grading instead of evidence.
   */
  it('produces its own audio for every step that asks a question about audio', () => {
    for (const step of FIELD_TEST_STEPS) {
      const asksAboutSound = step.responses.some((r) => r.kind === 'route');
      if (asksAboutSound) {
        expect(step.say, `${step.id} asks where the sound came from`).toBeTruthy();
      }
    }
  });

  /**
   * Every spoken line must be a whole sentence, because a clip IS a sentence:
   * clips.ts splits on terminal punctuation and looks each piece up exactly.
   * A line without it can never match a clip, so it would drop to the phone's
   * own voice -- and a route/voice question asked about an utterance that
   * could only ever be live TTS answers a question nobody asked.
   */
  it('ends every spoken line in terminal punctuation, so a clip can match it', () => {
    for (const step of FIELD_TEST_STEPS) {
      for (const line of step.say ?? []) expect(line.trim(), step.id).toMatch(/[.?!]$/);
    }
  });

  /**
   * THE TEST THAT CATCHES THE MISTAKE THIS FILE WAS WRITTEN WITH.
   *
   * The first draft of the rewrite used lines I made up -- "You have eight.
   * Dealer shows nine." and so on. Every one of them typechecked, rendered,
   * and passed every other assertion here; and not one of them was in the
   * phrase manifest, so not one of them had a recorded clip. The whole
   * protocol would have run on live TTS: every "where did that come from"
   * asked about an utterance that could only take the fallback path, and
   * "was that the recorded voice?" asked about an utterance that never could
   * have been. Two more drives, and no more answers than the first two.
   *
   * scripts/spoken-phrases.json is the list the clips are GENERATED from, so
   * membership in it is the real precondition, not a proxy for one.
   */
  it('speaks only lines that actually have a recorded clip', () => {
    const haveClips = new Set(spokenPhrases as string[]);
    for (const step of FIELD_TEST_STEPS) {
      for (const line of step.say ?? []) {
        expect(
          haveClips.has(line),
          `${step.id} says a line with no clip, so it can only ever use the phone voice: ${line}`,
        ).toBe(true);
      }
    }
  });

  /**
   * ...and its mirror. The calibration step's second line must NOT have a
   * clip, because its entire job is to demonstrate the fallback: give it one
   * and the step plays the recorded voice twice and teaches the operator that
   * the two sound identical, which is worse than not asking.
   */
  it('keeps the calibration line unclipped, which is what it is for', () => {
    const haveClips = new Set(spokenPhrases as string[]);
    const withFallback = FIELD_TEST_STEPS.filter((s) => s.sayUnclipped);
    expect(withFallback.length).toBe(1);
    for (const step of withFallback) {
      expect(haveClips.has(step.sayUnclipped!), step.id).toBe(false);
      expect(step.sayUnclipped!.trim(), step.id).toMatch(/[.?!]$/);
      // And it is paired with a clipped line, or there is nothing to compare.
      expect(step.say?.length, step.id).toBeGreaterThan(0);
    }
  });

  it('offers a repeat for every line it speaks, since a line missed in traffic is a step wasted', () => {
    for (const step of FIELD_TEST_STEPS) {
      if (step.say || step.sayUnclipped) expect(step.sayAgain, step.id).toBe(true);
    }
  });
});

describe('the buttons are back in every condition', () => {
  /**
   * THE REGRESSION GUARD FOR THE MISTAKE THIS REWRITE UNDOES. The previous
   * protocol filtered steps by motion and I put every wheel step in the
   * parked run, reasoning that button routing is noise-independent. The
   * operator drove a freeway with nothing to press: "I never said I wanted to
   * completely drop using the buttons so I don't know why they were removed."
   *
   * There is no filter any more, so this asserts the property that filter
   * violated: the wheel steps exist, and they are reachable from wherever the
   * operator is. If a `stepsFor…` filter is ever reintroduced this test has
   * to be reckoned with first.
   */
  it('carries wheel steps, and carries them for every condition alike', () => {
    const wheelSteps = FIELD_TEST_STEPS.filter((s) => s.wheel);
    expect(wheelSteps.length).toBeGreaterThanOrEqual(4);
    // One list, no per-condition subsetting: what a driving operator is
    // offered is exactly what a parked one is.
    for (const condition of FIELD_TEST_CONDITIONS) {
      expect(ids(), condition.id).toContain('wheel-gap');
      expect(ids(), condition.id).toContain('wheel-talking');
    }
  });

  /**
   * "Buttons worked only when the bot was talking" (2026-09-19). That is the
   * app losing the now-playing slot when a clip ends. A protocol that only
   * ever presses during speech cannot tell fixed from still-broken, so the
   * silent press is its own step and comes after the speaking one.
   */
  it('presses the wheel in silence as well as during speech, in that order', () => {
    expect(ids().indexOf('wheel-gap')).toBeGreaterThan(ids().indexOf('wheel-talking'));
  });

  /**
   * Order is load-bearing: opening the microphone flips the car to its
   * hands-free profile and takes the wheel with it. Every wheel step expected
   * to WORK has to come before the microphone opens, or it fails for a reason
   * that has nothing to do with the wheel.
   */
  it('tests the wheel before it opens the microphone', () => {
    const firstMic = FIELD_TEST_STEPS.findIndex((s) => s.setup?.voice === true);
    expect(firstMic).toBeGreaterThan(-1);
    for (const id of ['wheel-talking', 'wheel-gap', 'wheel-back', 'wheel-other']) {
      expect(ids().indexOf(id), id).toBeLessThan(firstMic);
    }
    // ...and the one expected to FAIL is deliberately after it.
    expect(ids().indexOf('wheel-with-mic')).toBeGreaterThan(firstMic);
  });
});

describe('the route question', () => {
  /**
   * The point of the rewrite. iOS exposes no output route to a web page, so
   * the only way to know whether an utterance landed on the car, the phone's
   * loudspeaker or the earpiece is to ask -- and the earpiece has to be its
   * own answer, because that is the failure: audible enough to seem fine on a
   * driveway, inaudible at 70mph. "If it's on the phone call speaker it's
   * just not audible at all and completely worthless."
   */
  it('lets the operator name the earpiece specifically, not just "quiet"', () => {
    const answers = ROUTE_ANSWERS.map((r) => r.id);
    expect(answers).toContain('route-car');
    expect(answers).toContain('route-loudspeaker');
    expect(answers).toContain('route-earpiece');
    expect(answers).toContain('route-silent');
  });

  /**
   * One sample cannot distinguish "it went to the earpiece" from "it ALWAYS
   * goes to the earpiece" from "it alternates" -- and alternation is what the
   * operator reported: "in the car then speaker then in the car then
   * speaker." Consecutive samples are the only instrument that separates
   * those, so the protocol has to carry several.
   */
  it('asks where the sound came from several times over, since one sample proves nothing', () => {
    const routeSteps = FIELD_TEST_STEPS.filter((s) =>
      s.responses.some((r) => r.kind === 'route'),
    );
    expect(routeSteps.length).toBeGreaterThanOrEqual(4);
  });

  it('asks it about back-to-back utterances, which is where alternation shows', () => {
    const order = ids();
    expect(order.indexOf('route-2')).toBe(order.indexOf('route-1') + 1);
    expect(order.indexOf('route-3')).toBe(order.indexOf('route-2') + 1);
  });
});

describe('what the log gets', () => {
  beforeEach(() => clearDiagnosticLog());

  it('writes the step, the condition and the answer that was tapped', () => {
    stampFieldTest('route-1', 'freeway', 'route-earpiece');
    const entry = readDiagnosticLog().find((e) => e.category === 'test');
    expect(entry?.event).toBe('route-1');
    expect(entry?.detail?.condition).toBe('freeway');
    expect(entry?.detail?.answer).toBe('route-earpiece');
  });

  /**
   * The answer is what the operator MEANT; the wheel actions and transcripts
   * are what the app SAW. Carried on the same entry because reading them
   * apart means correlating by timestamp across a 3000-entry file, which is
   * exactly the work that made the last two logs unusable.
   */
  it('carries the evidence the app gathered alongside the answer', () => {
    stampFieldTest('wheel-gap', 'car', 'wheel-nothing', { wheel: 'nexttrack, previoustrack' });
    const entry = readDiagnosticLog().find((e) => e.category === 'test');
    expect(entry?.detail?.wheel).toBe('nexttrack, previoustrack');
  });

  it('carries the condition on every stamp, not once per run', () => {
    // Runs get abandoned and restarted and the log survives reloads, so a
    // condition written once would be read against the wrong half of the file.
    stampFieldTest('route-1', 'car', 'route-car');
    stampFieldTest('route-2', 'speakerphone', 'route-loudspeaker');
    const conditions = readDiagnosticLog()
      .filter((e) => e.category === 'test')
      .map((e) => e.detail?.condition);
    expect(conditions).toEqual(['car', 'speakerphone']);
  });

  /**
   * "I need it to record in the logs everything about the test as it
   * happens." Until now the log recorded only the stamps, so a run read back
   * as a list of opinions with no record of what the app did between them --
   * two drives produced no diagnosis for exactly this reason.
   */
  it('brackets the run and every step, so the stamps have something to sit between', () => {
    logFieldTestRunStart('freeway');
    logFieldTestStep('route-1', 'freeway', 0);
    stampFieldTest('route-1', 'freeway', 'route-car');
    logFieldTestRunEnd('freeway', 1);

    const events = readDiagnosticLog()
      .filter((e) => e.category === 'test')
      .map((e) => e.event);
    expect(events).toEqual(['run-start', 'step-open', 'route-1', 'run-end']);
  });

  it('records which step was opened and where in the run it was', () => {
    logFieldTestStep('wheel-gap', 'car', 6);
    const entry = readDiagnosticLog().find((e) => e.event === 'step-open');
    expect(entry?.detail?.step).toBe('wheel-gap');
    expect(entry?.detail?.index).toBe(6);
  });
});

describe('a step that sets itself up', () => {
  /**
   * "I need it to set the settings" (2026-09-19). A step whose preconditions
   * are only DESCRIBED gets run under the wrong ones, and a run under the
   * wrong preconditions is indistinguishable in the log from a correct one.
   */
  it('turns on everything the wheel needs, which is the point of the protocol', () => {
    const step = FIELD_TEST_STEPS.find((s) => s.id === 'wheel-talking')!;
    expect(step.setup?.audioEnabled).toBe(true);
    // Without clips there is no media element, so no wheel button can reach
    // the app at all. A wheel step run on live TTS proves nothing.
    expect(step.setup?.useClips).toBe(true);
    // And an open microphone flips the car to hands-free, taking the wheel.
    expect(step.setup?.voice).toBe(false);
  });

  /**
   * Eyes-free is the switch that decides whether the app speaks at all. A
   * first step that turned audio on and left this off would be a silent first
   * step, and every step below it would be measuring nothing.
   */
  it('turns on the toggle that actually makes the app speak', () => {
    expect(FIELD_TEST_STEPS[0]!.setup?.eyesFree).toBe(true);
    expect(FIELD_TEST_STEPS[0]!.setup?.audioEnabled).toBe(true);
  });

  /**
   * The microphone is what moves playback to the earpiece and takes the
   * wheel, so it must be open for exactly the steps that are about it and
   * shut again afterwards -- an open microphone left running would poison
   * every step that followed.
   */
  it('opens the microphone only for the steps that are about the microphone', () => {
    const wantsMic = FIELD_TEST_STEPS.filter((s) => s.setup?.voice === true).map((s) => s.id);
    expect(wantsMic).toEqual(['mic-route']);
    // ...and it is explicitly shut again before the run ends.
    const shutsMic = FIELD_TEST_STEPS.filter((s) => s.setup?.voice === false).map((s) => s.id);
    expect(shutsMic).toContain('ambient');
    expect(ids().indexOf('ambient')).toBeGreaterThan(ids().indexOf('mic-route'));
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
