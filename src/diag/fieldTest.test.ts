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
  fieldTestLegsThisSession,
  _resetFieldTestSessionForTest,
  stepResponses,
  routeCells,
  routeBlockVerdict,
  DISCRIMINATE_LINES,
  ECHO_LINES,
  discriminateWordFor,
  discriminateAnswerFor,
} from './fieldTest';
import { DEFAULT_SETTINGS, type Settings } from '../store/types';
import { readDiagnosticLog, clearDiagnosticLog } from './diagnosticLog';
import spokenPhrases from '../../scripts/spoken-phrases.json';
import * as fieldTestModule from './fieldTest';
import { resolveFieldTestSetup, type FieldTestSetup } from './fieldTest';

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
    // Asserted against the LITERAL, not against another call of the function
    // under test -- `f(a) === f(b)` passes for any constant function.
    expect(motionForCondition('speakerphone')).toBe('driving');
    expect(motionForCondition('freeway')).toBe('driving');
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
        // LENGTH, not truthiness. `[]` is truthy, so `say: []` silenced three
        // of the five route steps with this test still green -- the operator
        // would have heard nothing and tapped "Heard nothing" three times,
        // which reads in the log as a routing failure rather than a protocol
        // bug. Every sibling test iterates `step.say ?? []` and is vacuous
        // over an empty array too, so nothing else could catch it.
        expect(step.say?.length ?? 0, `${step.id} asks where the sound came from`).toBeGreaterThan(
          0,
        );
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
  /**
   * ...AND THE LINES THAT ARE NOT IN `say`, which is where this rule had a
   * hole the moment the drill protocol arrived.
   *
   * A drawn line lives in `discriminate` and an echo line in `ECHO_LINES`,
   * so neither is reached by the walk below. Both are spoken through the
   * real speech path, so both fall back to live TTS if they have no clip --
   * and live TTS is the path with the watchdog fault on the first utterance
   * of a page load. The word-discrimination step would then be comparing a
   * synthesised voice against the road instead of the recorded one, which
   * makes the voice the variable rather than the noise.
   */
  it('draws and echoes only lines that actually have a recorded clip', () => {
    const haveClips = new Set(spokenPhrases as string[]);
    for (const line of DISCRIMINATE_LINES) {
      expect(haveClips.has(line), `no clip for the drawn line "${line}"`).toBe(true);
    }
    for (const line of Object.values(ECHO_LINES)) {
      expect(haveClips.has(line), `no clip for the echo line "${line}"`).toBe(true);
    }
  });

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
    // The lock probe also speaks unclipped -- its instruction has no clip and
    // that is fine, nothing on that step is comparing voices -- so it is not
    // a calibration step and is not counted as one.
    const withFallback = FIELD_TEST_STEPS.filter((s) => s.sayUnclipped && !s.lockProbe);
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
    // One list, no per-condition subsetting. Asserted as a property of the
    // MODULE rather than by looping over conditions: the old loop called
    // `ids()`, which takes no argument, four times and never used the loop
    // variable -- an unfalsifiable claim wearing the costume of a guard.
    expect(ids()).toContain('wheel-gap');
    expect(ids()).toContain('wheel-talking');
    // The real property: there is no way to ask for a per-condition subset.
    // If a `stepsFor…` filter is ever reintroduced, this fails to compile.
    const exported: Record<string, unknown> = fieldTestModule;
    for (const name of Object.keys(exported)) {
      expect(name, 'a per-condition step filter is back').not.toMatch(/^stepsFor/);
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

describe('what the protocol is allowed to ask', () => {
  /**
   * THE RULE: never ask a person for something the code already knows.
   *
   * This protocol asked the operator to identify which voice had just spoken.
   * The app decides that -- speech.ts picks the clip path or the live path and
   * records which -- so the question could only ever collect a guess about an
   * already-recorded fact, and a wrong guess would actively mislead the
   * diagnosis it was collected for. The operator put it plainly: "it's not
   * like they're played the same way and the code doesn't know wtf?"
   *
   * What IS legitimate to ask is anything the browser will not tell the app:
   * where the sound physically came out (no output-route API on iOS), and
   * whether it was audible over the road. Those are the two shapes of question
   * left, and the route answers plus the audibility step are exactly them.
   */
  it('never asks the operator which voice spoke, because the app records that', () => {
    for (const step of FIELD_TEST_STEPS) {
      for (const response of step.responses) {
        const asksWhichVoice =
          /recorded voice$/i.test(response.label) ||
          /^the phone.s own voice$/i.test(response.label) ||
          response.id === 'voice-recorded' ||
          response.id === 'voice-phone';
        expect(
          asksWhichVoice,
          `${step.id} asks the operator to identify the voice, which speech.ts already records: ${response.label}`,
        ).toBe(false);
      }
    }
  });

  /**
   * The unclipped line survives the deletion above, but for a different
   * reason, and the reason has to stay visible or it will be deleted as dead
   * weight next time. Live speechSynthesis is capped at unity gain by the
   * browser, so unlike a clip it cannot be amplified at all -- whether it
   * survives road noise is a fact about the car, not about the code.
   */
  it('still asks whether the fallback was audible, which the app cannot know', () => {
    const step = FIELD_TEST_STEPS.find((s) => s.sayUnclipped)!;
    expect(step).toBeDefined();
    const answers = step.responses.map((r) => r.id);
    expect(answers).toContain('fallback-lost');
    // ...and its answers are about hearing it, not about naming it.
    expect(answers).not.toContain('voice-recorded');
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

  /**
   * THE RULE THIS USED TO ASSERT WAS FALSE, and it was the protocol's own.
   *
   * "Alternation predicts they differ, a stable route predicts they match"
   * holds only if a wandering route never lands twice in a row on the same
   * destination. There are three destinations, so two consecutive samples
   * agree by chance somewhere between a third and half the time; a full run
   * makes eight such comparisons, and therefore had roughly a two-in-five
   * chance of handing back one clean, entirely spurious "the microphone moved
   * it and never moved it back" — the exact conclusion the post-microphone
   * block exists to reach.
   *
   * Consecutiveness is still worth pinning: samples split across a path change
   * or a microphone change answer neither question. What is no longer claimed
   * is that two of them settle anything.
   */
  it('takes its samples back to back, so nothing changes between them', () => {
    const order = ids();
    for (const group of [
      ['route-1', 'route-2'],
      ['route-1t', 'route-2t', 'route-3t'],
      ['mic-route', 'mic-route-2', 'mic-route-3'],
      ['mic-route-t', 'mic-route-t2', 'mic-route-t3'],
      ['route-after-mic', 'route-after-mic-2', 'route-after-mic-3'],
      ['route-after-mic-t', 'route-after-mic-2t', 'route-after-mic-3t'],
    ]) {
      for (const [i, id] of group.entries()) {
        expect(order.indexOf(id), `${id} is not in the protocol`).toBeGreaterThanOrEqual(0);
        if (i > 0) {
          expect(order.indexOf(id), `${id} does not follow ${group[i - 1]}`).toBe(
            order.indexOf(group[i - 1]!) + 1,
          );
        }
      }
    }
  });

  /**
   * ...and enough of them that a cell reading uniform means something.
   *
   * Three is not a large number. It is what the operator's time buys, and it
   * takes the chance of a cell coming out uniform by accident from about one
   * in three to about one in nine. The assertion is per CELL rather than per
   * block, because the comparison the run is read through is cell against
   * cell: a cell with two samples facing one with five is the shape that
   * produced the finding this fixes.
   */
  it('carries at least three samples in every cell of the crossing', () => {
    let clips = true;
    let voice = false;
    let micHasBeenOn = false;
    const cells = new Map<string, string[]>();
    for (const step of FIELD_TEST_STEPS) {
      if (step.setup?.useClips !== undefined) clips = step.setup.useClips;
      if (step.setup?.voice !== undefined) voice = step.setup.voice;
      if (voice) micHasBeenOn = true;
      if (!step.responses.some((r) => r.kind === 'route')) continue;
      if (!step.say?.length) continue;
      const key = `${clips ? 'clip' : 'tts'} / mic ${voice ? 'open' : micHasBeenOn ? 'after' : 'before'}`;
      cells.set(key, [...(cells.get(key) ?? []), step.id]);
    }
    expect(cells.size, 'the crossing lost a cell entirely').toBe(6);
    for (const [key, steps] of cells) {
      expect(
        steps.length,
        `${key} has ${steps.length} sample(s): ${steps.join(', ')} -- too few to tell a stable route from a wandering one`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * A wheel press with the microphone shut, which the protocol never had.
   *
   * Every press sat before the microphone block or inside it, so "the
   * microphone takes the wheel" and "the media slot lapses after a few presses
   * or after ten minutes" predicted the same log — and the second is the
   * fault `wheel-repeat` exists to find. `wheel-with-mic` is always the fifth
   * or sixth press and always about ten minutes in, which is where the two are
   * least separable.
   */
  it('presses the wheel once more after the microphone has shut', () => {
    let voice = false;
    let micHasBeenOn = false;
    const after: string[] = [];
    for (const step of FIELD_TEST_STEPS) {
      if (step.setup?.voice !== undefined) voice = step.setup.voice;
      if (voice) {
        micHasBeenOn = true;
        continue;
      }
      if (micHasBeenOn && step.wheel) after.push(step.id);
    }
    expect(
      after,
      'no wheel press happens after the microphone closes, so the microphone cannot be told apart from time or press count',
    ).not.toEqual([]);
    for (const id of after) {
      const step = FIELD_TEST_STEPS.find((s) => s.id === id);
      expect(
        step?.awaitSilent,
        `${id} presses the wheel during the teardown, so it is not a press after the microphone`,
      ).toBe(true);
    }
  });
});

describe('what the log gets', () => {
  beforeEach(() => clearDiagnosticLog());

  it('writes the step, the condition and the answer that was tapped', () => {
    stampFieldTest('route-1', 'freeway', 'route-earpiece');
    const entry = readDiagnosticLog().find((e) => e.category === 'test');
    // The step is a FIELD, so one grep assembles a step's whole evidence --
    // the open, the setup, both speech brackets and the answer. It used to be
    // the event name, which made the answer the only entry in the protocol
    // that `grep step=<id>` did not return.
    expect(entry?.event).toBe('answer');
    expect(entry?.detail?.step).toBe('route-1');
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
    stampFieldTest('wheel-gap', 'car', 'wheel-car-quiet', { wheel: 'nexttrack, previoustrack' });
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
    logFieldTestRunStart('freeway', undefined, 32, false);
    logFieldTestStep('route-1', 'freeway', 0);
    stampFieldTest('route-1', 'freeway', 'route-car');
    logFieldTestRunEnd('freeway', 1, 32);

    const events = readDiagnosticLog()
      .filter((e) => e.category === 'test')
      .map((e) => e.event);
    expect(events).toEqual(['run-start', 'step-open', 'answer', 'run-end']);
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
  /**
   * THE ASSERTION THAT ENCODED THE BUG, replaced.
   *
   * This used to read `expect(wantsMic).toEqual(['mic-route'])` -- pinning the
   * exact state that was broken. `mic-heard` ("say the word double out loud")
   * and `wheel-with-mic` ("microphone still on ... expected to FAIL") both ran
   * with the recogniser shut, so the first could only ever be answered "It
   * never heard me" and the second would SUCCEED and log as evidence against
   * the hands-free hypothesis. A green test asserted that was correct.
   *
   * The honest property is the one below: a step whose instruction tells the
   * operator the microphone is on must declare it. That is falsifiable by the
   * mistake that was actually made.
   */
  it('declares the microphone on every step whose instruction says it is on', () => {
    for (const step of FIELD_TEST_STEPS) {
      const claimsMicIsOpen =
        /microphone (is )?(now |still )?on|microphone open|say .* out loud/i.test(
          `${step.title} ${step.instruction}`,
        );
      if (claimsMicIsOpen) {
        // RESOLVED, not declared. Setup folds forward now, so a step is
        // entitled to inherit the microphone from the step that opened it --
        // what must never happen is a step SAYING the microphone is on while
        // the state it actually runs under has it shut.
        expect(
          resolveFieldTestSetup(FIELD_TEST_STEPS.indexOf(step)).voice,
          `${step.id} tells the operator the microphone is open: "${step.instruction}"`,
        ).toBe(true);
        // ...and it must wait for the recogniser to be live before it speaks.
        // Without the gate the line lands ~3.5s before the audio session has
        // flipped, so the step samples the state it exists to measure the
        // other side of. This is the assertion that would have caught the
        // 2026-09-23 drive's central gap.
        if ((step.say?.length ?? 0) > 0) {
          expect(
            step.awaitListening,
            `${step.id} speaks while claiming the microphone is open, but does not wait for it`,
          ).toBe(true);
        }
      }
    }
  });

  it('shuts the microphone again before the run ends', () => {
    const shutsMic = FIELD_TEST_STEPS.filter((s) => s.setup?.voice === false).map((s) => s.id);
    expect(shutsMic).toContain('ambient');
    expect(ids().indexOf('ambient')).toBeGreaterThan(ids().indexOf('mic-route'));
    // The last step that names the microphone at all must be followed by one
    // that closes it, or the protocol ends holding the car in its hands-free
    // profile -- the very state that steals the wheel.
    const lastMicOn = Math.max(
      ...FIELD_TEST_STEPS.map((s, i) => (s.setup?.voice === true ? i : -1)),
    );
    const lastMicOff = Math.max(
      ...FIELD_TEST_STEPS.map((s, i) => (s.setup?.voice === false ? i : -1)),
    );
    expect(lastMicOff).toBeGreaterThan(lastMicOn);
  });

  /**
   * The route question has to be asked on BOTH voices or it cannot answer
   * itself. Every route step used to speak a clip, so "the route follows the
   * path" and "the route alternates at random" produced identical answers --
   * the protocol could not distinguish its leading hypothesis from the null.
   */
  it('asks the route question on the fallback voice as well as the recorded one', () => {
    const routeSteps = FIELD_TEST_STEPS.filter((s) => s.responses.some((r) => r.kind === 'route'));
    // Resolve each step's effective clip state by carrying setup forward, the
    // way the runner does.
    let clips = true;
    const byPath: Record<string, number> = { clip: 0, tts: 0 };
    for (const step of FIELD_TEST_STEPS) {
      if (step.setup?.useClips !== undefined) clips = step.setup.useClips;
      if (routeSteps.includes(step) && step.say?.length) byPath[clips ? 'clip' : 'tts'] += 1;
    }
    expect(byPath.clip, 'route samples on the recorded voice').toBeGreaterThanOrEqual(3);
    expect(byPath.tts, 'route samples on the phone voice').toBeGreaterThanOrEqual(3);
  });

  /**
   * ...and the two sets must ask about the SAME lines, or the comparison
   * confounds the path with whatever else differs between the utterances.
   */
  it('compares the two voices on identical lines', () => {
    const say = (id: string) => FIELD_TEST_STEPS.find((s) => s.id === id)?.say?.[0];
    // All four cells of the 2x2 speak line A, and all four speak line B. Any
    // difference in the answers is then attributable to the path or the
    // microphone and to nothing else about the utterance.
    const lineA = say('route-1');
    const lineB = say('route-2');
    expect(lineA, 'route-1 says nothing').toBeTruthy();
    expect(lineB, 'route-2 says nothing').toBeTruthy();
    for (const id of [
      'route-1t',
      'mic-route',
      'mic-route-t',
      'route-after-mic',
      'route-after-mic-t',
      // The third sample of each cell, on line A like the first. Added with
      // the cells themselves: a third sample speaking some other line would
      // put a length difference inside a cell that is supposed to vary in
      // nothing but path and microphone state.
      'route-3t',
      'mic-route-3',
      'mic-route-t3',
      'route-after-mic-3',
      'route-after-mic-3t',
    ]) {
      expect(say(id), `${id} does not repeat the line it is compared against`).toBe(lineA);
    }
    for (const id of [
      'route-2t',
      'mic-route-2',
      'route-after-mic-2',
      'route-after-mic-2t',
      'mic-route-t2',
    ]) {
      expect(say(id), `${id} does not repeat the line it is compared against`).toBe(lineB);
    }
  });

  /**
   * THE CONFOUND, and the reason the protocol reviewer rejected the run.
   *
   * Every clip route sample used to sit before the microphone block and every
   * TTS one after it. Path and microphone-state were perfectly correlated, so
   * "the route follows the path" and "the microphone moved the route and never
   * moved it back" -- the two live explanations of the operator reporting a
   * voice change and a speaker change in the same breath -- predicted the
   * IDENTICAL table. A full twenty-two-step run could not tell them apart.
   *
   * This asserts the design property that fixes it: every cell of path x
   * microphone-state carries at least one route sample. It fails the moment
   * anyone deletes a step and re-empties one.
   */
  it('crosses the path with the microphone, so the two can be told apart', () => {
    let clips = true;
    let voice = false;
    let micHasBeenOn = false;
    const cells = new Map<string, string[]>();
    for (const step of FIELD_TEST_STEPS) {
      if (step.setup?.useClips !== undefined) clips = step.setup.useClips;
      if (step.setup?.voice !== undefined) voice = step.setup.voice;
      if (voice) micHasBeenOn = true;
      if (!step.responses.some((r) => r.kind === 'route')) continue;
      if (!step.say?.length) continue;
      const mic = voice ? 'open' : micHasBeenOn ? 'after' : 'before';
      const key = `${clips ? 'clip' : 'tts'} / mic ${mic}`;
      cells.set(key, [...(cells.get(key) ?? []), step.id]);
    }
    for (const path of ['clip', 'tts']) {
      for (const mic of ['before', 'open', 'after']) {
        const key = `${path} / mic ${mic}`;
        expect(
          cells.get(key)?.length ?? 0,
          `no route sample at ${key} -- the path cannot be separated from the microphone`,
        ).toBeGreaterThan(0);
      }
    }
  });

  /**
   * `route-after-mic` carried the headline conclusion and sampled DURING the
   * teardown: the runner calls `setVoiceOn(false)` and `say()` in one
   * synchronous body, and `stop()` only requests the end of the session. The
   * mirror of the `awaitListening` assertion above, on the closing edge.
   */
  it('waits for the microphone to be down before sampling the route after it', () => {
    let voice = false;
    let wasOn = false;
    let firstAfter: (typeof FIELD_TEST_STEPS)[number] | undefined;
    for (const step of FIELD_TEST_STEPS) {
      if (step.setup?.voice !== undefined) voice = step.setup.voice;
      if (voice) {
        wasOn = true;
        continue;
      }
      if (wasOn && (step.say?.length ?? 0) > 0) {
        firstAfter = step;
        break;
      }
    }
    expect(firstAfter, 'nothing speaks after the microphone closes').toBeTruthy();
    expect(
      firstAfter?.awaitSilent,
      `${firstAfter?.id} speaks the moment the microphone is asked to stop, and claims to be the microphone-shut condition`,
    ).toBe(true);
  });

  /**
   * Every question needs an honest answer available for "I could not tell".
   * Without one, a driver who was merging when the line played must pick from
   * answers that all assert something about the app -- and the plausible one
   * ("Nothing happened at all") is the bug signature. The absence of this
   * button manufactures false bug reports.
   */
  it('always offers a way to say the answer is not known', () => {
    for (const step of FIELD_TEST_STEPS) {
      const canDecline = step.responses.some((r) => r.kind === 'note');
      expect(canDecline, `${step.id} forces an answer the operator may not have`).toBe(true);
    }
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

/**
 * THE EFFECTIVE STATE OF A STEP, which is not the state it declares.
 *
 * A step's `setup` is a delta. The runner used to apply only the delta of the
 * step being entered, so the state a step actually ran under depended on the
 * route the operator took to reach it -- and three ordinary routes destroyed a
 * premise silently. These assert the folded state, because that is the thing
 * the measurement depends on.
 */
describe('resolveFieldTestSetup', () => {
  const indexOf = (id: string) => FIELD_TEST_STEPS.findIndex((s) => s.id === id);
  const at = (id: string) => resolveFieldTestSetup(indexOf(id));

  it('carries the boost to the step whose premise it is, and nowhere else', () => {
    // `fallback-audible` asks whether the un-boostable fallback voice is
    // audible at all. Above unity a clip carries the excess through a gain
    // node and live speech cannot carry any of it; at unity the question is
    // empty and "the second was much quieter" is a null result filed as
    // evidence.
    expect(at('fallback-audible').volume).toBeGreaterThan(1);
  });

  it('asks every route question at the same loudness', () => {
    // The route answers are compared against each other -- clip against TTS,
    // before the microphone against after it. Under road noise, level is
    // exactly what separates "car speakers" from "earpiece" from "heard
    // nothing", so a comparison that varies volume as well as path or
    // microphone state cannot attribute its own result.
    const routeSteps = FIELD_TEST_STEPS.filter((s) =>
      s.responses.some((r) => r.kind === 'route'),
    ).filter((s) => (s.say?.length ?? 0) > 0);
    expect(routeSteps.length).toBeGreaterThanOrEqual(6);
    const volumes = new Set(routeSteps.map((s) => at(s.id).volume ?? 1));
    expect([...volumes], 'route steps run at different volumes').toEqual([1]);
  });

  it('never leaves the microphone on for a wheel step', () => {
    // An open microphone flips the car to its hands-free profile, which takes
    // the wheel. A wheel step run in that state reports the fault under
    // investigation for a reason the protocol created.
    // A LITERAL THIS TEST OWNS, not a regex over the data under test. The
    // oracle used to be /with-mic|with the microphone/ applied to the step's
    // own id and title -- so renaming `wheel-with-mic` and dropping its
    // `voice: true` in the same edit flipped both sides of the comparison
    // and left this green while the property was gone.
    const micOnSteps = FIELD_TEST_STEPS.filter((s) => s.wheel && at(s.id).voice === true).map(
      (s) => s.id,
    );
    expect(
      micOnSteps,
      'a wheel step runs with the microphone open, which flips the car to hands-free and takes the wheel',
    ).toEqual(['wheel-with-mic']);
  });

  /**
   * THE ONE MACHINE-READABLE SIGNATURE OF THE PROFILE FLIP, read where it
   * costs nothing.
   *
   * The recogniser exposes no stream, so the only way to learn which input
   * device the phone is actually using -- "iPhone Microphone" or the car's
   * hands-free unit -- is a short `getUserMedia` of our own. On iOS that is a
   * second capture beside a live recogniser, and whether it aborts the
   * recognition session is unknown. So it is read on exactly one step: the
   * LAST one with the microphone open, whose own measurement is a wheel
   * press rather than a route sample, immediately before the protocol shuts
   * the microphone anyway. A restart there perturbs nothing that is
   * measured. Anywhere earlier it would sit inside the mic-open route block;
   * anywhere later the microphone is shut and opening one is the
   * contamination the whole after block exists to avoid.
   */
  /**
   * THE LOCK PROBE OPENS NOTHING AND SITS AFTER EVERYTHING.
   *
   * It asks the operator to lock the phone for thirty seconds. A microphone
   * open under it would be thirty seconds of hands-free profile with nobody
   * measuring anything; a route sample after it would be taken on a page that
   * may just have been frozen or reloaded. So it goes after every
   * measurement -- second to last, ahead only of `free`, which has to stay
   * last -- with the microphone shut, and the only thing it measures is
   * itself.
   */
  it('runs the lock probe once, after every measurement, with the microphone shut', () => {
    const probes = FIELD_TEST_STEPS.filter((s) => s.lockProbe).map((s) => s.id);
    expect(probes, 'one lock probe, no more').toEqual(['lock-probe']);
    // After every measured step: a sample taken after the page may have died
    // is not a sample. But NOT last -- the free step is last, and has to be:
    // it is the one step meant to be tapped repeatedly, and `answer()` only
    // stays put on the last step. Appending the probe after it made the first
    // tap on `free` advance into "Lock the phone now".
    //
    // PER PROTOCOL, because there are two now and each ends with its own free
    // step, on its own path. A protocol whose free step is not last has that
    // first tap advance out of it -- the bug this assertion was written for.
    const stepsOf = (protocol: 'routing' | 'drill') =>
      FIELD_TEST_STEPS.filter((x) => (x.protocol ?? 'routing') === protocol);
    expect(stepsOf('routing').at(-1)?.id, '`free` is no longer last, so it advances').toBe('free');
    expect(
      stepsOf('drill').at(-1)?.id,
      '`drill-free` is no longer last, so it advances',
    ).toBe('drill-free');
    // The lock probe belongs to the routing protocol, second from its end.
    expect(stepsOf('routing').at(-2)?.id).toBe('lock-probe');
    // ...and every routing measurement precedes it. Scoped, because the drill
    // steps sit after the whole routing list in the array and are never on the
    // same path as the probe, so comparing their indices to its would fail on
    // a layout fact rather than on an ordering mistake.
    const measured = stepsOf('routing')
      .filter((s) => s.say || s.wheel || s.ambient)
      .map((s) => s.id);
    for (const id of measured) expect(indexOf(id), id).toBeLessThan(indexOf('lock-probe'));
    expect(at('lock-probe').voice, 'the probe locks the phone with a microphone open').toBe(false);
  });

  /**
   * THE TEST WORD IS NOT AN ANSWER. `mic-heard` asks the operator to say
   * "double" so the transcript has a ground truth -- and with "Answer out
   * loud" on, that transcript went into the answer matcher, matched nothing,
   * and chimed the not-understood tone the step's own comment warns turns a
   * working microphone into "It never heard me". Declared in the data: on
   * this step what is heard is the evidence, and the answer is tapped.
   */
  it('treats what mic-heard hears as evidence, not as an answer, and only there', () => {
    const evidence = FIELD_TEST_STEPS.filter((s) => s.transcriptIsEvidence).map((s) => s.id);
    expect(evidence).toEqual(['mic-heard']);
    expect(at('mic-heard').voice, 'evidence from a microphone nobody opened').toBe(true);
  });

  it('reads the selected input device on the last microphone-open step, and nowhere else', () => {
    const probes = FIELD_TEST_STEPS.filter((s) => s.probeInput).map((s) => s.id);
    expect(probes, 'the input probe belongs on one step').toEqual(['wheel-with-mic']);

    const i = indexOf('wheel-with-mic');
    expect(at('wheel-with-mic').voice, 'the probe reads an input nobody opened').toBe(true);
    const next = FIELD_TEST_STEPS[i + 1]!;
    expect(
      at(next.id).voice,
      `${next.id} still has the microphone open, so a probe on wheel-with-mic could restart it under a route sample`,
    ).toBe(false);
  });

  /**
   * THIS TEST USED TO COMPARE THE FUNCTION TO ITSELF.
   *
   * It read `expect(resolveFieldTestSetup(i)).toEqual(resolveFieldTestSetup(i))`
   * -- which is a tautology for any function at all, pure or not. The purity
   * property the whole setup-folding fix rests on was unguarded for as long as
   * the fix has existed, and the test that claimed to guard it could not fail.
   * An independent oracle is the only thing that pins this: the expected value
   * is computed here, by folding the deltas, and never by calling the function
   * under test.
   */
  it('is a pure function of the index, so Back and Resume land in the same state', () => {
    const expected: Record<string, unknown> = {};
    for (let i = 0; i < FIELD_TEST_STEPS.length; i += 1) {
      // The oracle: every delta up to and including this step, in order.
      Object.assign(expected, FIELD_TEST_STEPS[i]?.setup ?? {});
      expect(resolveFieldTestSetup(i), `step ${i} (${FIELD_TEST_STEPS[i]?.id}) folds wrongly`).toEqual(
        { ...expected },
      );
    }
  });

  /**
   * ...and the ORDER of the calls must not matter, which is what "Back and
   * Resume land in the same state" actually means. Walking forward, walking
   * backward and jumping straight to an index must all agree -- the failure
   * being pinned is a cache or accumulator that survives between calls, which
   * a single forward walk cannot see.
   */
  it('gives the same answer reached forwards, backwards, or jumped to', () => {
    const forwards = FIELD_TEST_STEPS.map((_, i) => resolveFieldTestSetup(i));

    const backwards: FieldTestSetup[] = [];
    for (let i = FIELD_TEST_STEPS.length - 1; i >= 0; i -= 1) backwards[i] = resolveFieldTestSetup(i);
    expect(backwards, 'stepping back gave a different state than stepping forward').toEqual(
      forwards,
    );

    // Jumped to out of order, the way Resume does after a mid-drive reload.
    for (const i of [17, 3, 22, 0, 12, 5]) {
      expect(resolveFieldTestSetup(i), `jumping straight to step ${i} disagreed`).toEqual(
        forwards[i],
      );
    }
  });

  /**
   * The specific leak this folding replaced: "leave it as it was" was
   * implemented as "do not touch it", so stepping BACK out of `mic-route` left
   * the recogniser open across four wheel steps.
   */
  it('has the microphone off on every step before the one that opens it', () => {
    const micOpens = indexOf('mic-route');
    for (let i = 0; i < micOpens; i += 1) {
      expect(
        resolveFieldTestSetup(i).voice,
        `${FIELD_TEST_STEPS[i]?.id} resolves with the microphone on before the protocol asks for it`,
      ).not.toBe(true);
    }
  });

  it('un-mutes for every step, not only the first', () => {
    // Only `route-1` declared `muted: false`. One tap on the mute button at
    // step 5 left the remaining fifteen steps silent, with the evidence line
    // still naming the voice that "played" -- and the operator answering
    // "Heard nothing" fifteen times, which is the signature of the routing
    // bug under investigation.
    for (const step of FIELD_TEST_STEPS) {
      expect(at(step.id).muted, `${step.id} can run muted`).toBe(false);
    }
  });

  it('restores the recorded voice before the run ends', () => {
    const last = FIELD_TEST_STEPS[FIELD_TEST_STEPS.length - 1]!;
    expect(at(last.id).useClips).toBe(true);
    expect(at(last.id).voice).toBe(false);
  });
});

/**
 * A wheel step's answers must all be things the operator can actually observe.
 *
 * The comment above `WHEEL_RESPONSES` explains that `'The app reacted'` was
 * deleted because the media-session handler short-circuits into the probe and
 * returns before the real handler, so NO wheel press produces an audible
 * reaction during a wheel step. It was then replaced with "I heard the app
 * acknowledge it" -- the same impossible claim in different words, and the
 * only `good`-coloured option, so a press that arrived perfectly had to be
 * filed under a `bad` answer. These pin the property rather than the wording.
 */
describe('the wheel steps ask only what the operator can answer', () => {
  const wheelSteps = () => FIELD_TEST_STEPS.filter((s) => s.wheel === true);

  it('has wheel steps at all, so the rest of this block can fail', () => {
    expect(wheelSteps().length).toBeGreaterThan(0);
  });

  it('never offers an answer that claims the app made a sound', () => {
    // The app is structurally silent on these steps. Any option asserting an
    // app-produced noise is unanswerable by construction, and an unanswerable
    // option is worse than a missing one: it is tapped.
    for (const step of wheelSteps()) {
      for (const response of step.responses) {
        expect(
          response.label,
          `${step.id}/${response.id} claims the app responded audibly`,
        ).not.toMatch(/\b(app|it) (acknowledge|responded|beeped|reacted)/i);
        expect(response.label, `${step.id}/${response.id}`).not.toMatch(/heard the app/i);
      }
    }
  });

  it('never forces a press that worked into a bad-coloured answer', () => {
    // NOT "has a `good` option". `wheel-repeat` is an acknowledgement step --
    // whether the presses arrived is in the log with timestamps, so the
    // operator only confirms they pressed, and `note` is the honest kind
    // there. The property that matters is weaker and true of all of them:
    // an operator whose press worked must have somewhere to tap that is not
    // the failure signature. Without it every success in the export wears the
    // colour of the fault under investigation.
    for (const step of wheelSteps()) {
      // `wheel-na` IS EXCLUDED, and the exclusion is most of the
      // assertion. It is kind `note` and it is on every wheel step, so
      // counting it made the total >= 1 unconditionally: deleting
      // `wheel-car-quiet` left this green while the property was false.
      // "No Bluetooth" means the press was impossible, not that it worked.
      const landings = step.responses.filter(
        (r) =>
          (r.kind === 'good' || r.kind === 'note') &&
          r.id !== 'missed' &&
          r.id !== 'wheel-na',
      );
      expect(
        landings.length,
        `${step.id} leaves a working press nothing but a bad answer`,
      ).toBeGreaterThan(0);
    }
  });

  it('keeps a way to say the car took the press instead', () => {
    // The one fact the operator holds and the code cannot see.
    for (const step of wheelSteps()) {
      // BY ID. `/radio|car/i` matched "The car did nothing else", so
      // deleting `wheel-radio` — the answer that reports the car taking the
      // press, which is the fact the operator holds and the code cannot
      // see — left this green.
      // EITHER FORM OF IT. `wheel-repeat` offers the modifier version
      // (`wheel-radio-took-one`), which arms rather than stamps -- a
      // different control at a different slot, but the same fact reaching
      // the log. Both ids are named, so deleting either one from the step
      // that carries it still fails here.
      expect(
        step.responses.some((r) => r.id === 'wheel-radio' || r.id === 'wheel-radio-took-one'),
        `${step.id} cannot report the car consuming the press`,
      ).toBe(true);
    }
  });
});

/**
 * The setup fields that survived a mutation run untouched.
 *
 * `applyFieldTestSetup` dropping `volume`, and the banner printing it without
 * the ×100, both passed the whole suite: the existing "applies exactly what a
 * step asked for" test asserts `enabled`, `useClips`, `muted` and `wheelMode`
 * and stops there. `fallback-audible` is the one step whose entire premise is
 * the 1.5 boost a clip can carry and live TTS cannot, so losing the volume
 * makes both lines play at unity and files "the second was much quieter" as a
 * null result -- while the banner still says 150%.
 */
describe('the setup carries volume, not just the flags', () => {
  const base = (): Settings => structuredClone(DEFAULT_SETTINGS);

  it('applies a declared volume to the settings it returns', () => {
    const out = applyFieldTestSetup(base(), { volume: 1.5 });
    expect(out.audio.volume).toBe(1.5);
  });

  it('leaves the volume alone when a step does not declare one', () => {
    const before = base();
    before.audio.volume = 0.4;
    expect(applyFieldTestSetup(before, { useClips: true }).audio.volume).toBe(0.4);
  });

  it('carries the boost through the fold to the step that needs it', () => {
    // Via `resolveFieldTestSetup`, because that is what the screen applies --
    // a volume declared on a step but lost in the fold would be just as dead.
    const index = FIELD_TEST_STEPS.findIndex((s) => s.id === 'fallback-audible');
    expect(index, 'fallback-audible is gone').toBeGreaterThanOrEqual(0);
    const resolved = resolveFieldTestSetup(index);
    expect(resolved.volume).toBeGreaterThan(1);
    expect(applyFieldTestSetup(base(), resolved).audio.volume).toBe(resolved.volume);
  });

  it('prints the volume as a percentage the operator can read at a glance', () => {
    // `Math.round(v)` instead of `Math.round(v * 100)` renders "volume 2%" on
    // the one step whose premise is the boost, which reads as the opposite of
    // what the app just did.
    expect(describeFieldTestSetup({ volume: 1.5 })).toContain('volume 150%');
    expect(describeFieldTestSetup({ volume: 1 })).toContain('volume 100%');
  });
});

/**
 * An answer set is an instrument. These three could not express the outcome
 * that mattered most for the step they belonged to.
 */
describe('what a step lets the operator say', () => {
  const byId = (id: string) => FIELD_TEST_STEPS.find((s) => s.id === id);
  const labels = (id: string) => (byId(id)?.responses ?? []).map((r) => r.id);

  /**
   * Two lines, two different paths, and the protocol's leading hypothesis is
   * that the path decides the route -- so the most important thing that can
   * happen here is the second line coming out somewhere else. It had no
   * button, and landed on "much quieter" or "lost in the noise", both of which
   * name the volume cap as the cause.
   */
  it('lets the fallback step say the second line came from somewhere else', () => {
    expect(labels('fallback-audible')).toContain('fallback-moved');
  });

  /**
   * The wheel answers used to mix two independent facts in one single-choice
   * list: what the CAR did, and whether the APP saw the press. The most
   * diagnostic outcome made two labels true at once, and eyes-free the
   * `good`-coloured one wins -- so a press lost entirely was filed as success.
   */
  it('does not ask the wheel steps about something already in the log', () => {
    for (const step of FIELD_TEST_STEPS) {
      if (!step.wheel) continue;
      expect(
        step.responses.map((r) => r.id),
        `${step.id} still asks the operator to report what the app already records`,
      ).not.toContain('wheel-nothing');
    }
  });

  /**
   * At most ONE, which is the property F4 was really about. Two
   * `good`-coloured buttons in an eyes-free single-choice list is a coin toss
   * the analysis then reads as a finding: the old set had 'The car did nothing
   * else' and, true at the same moment, 'The press never showed on screen'.
   *
   * Not exactly one, because `wheel-repeat` deliberately has none -- it is a
   * 'Done' step whose count is already in the log with timestamps, and giving
   * it a verdict button would be asking the operator to re-report that.
   */
  it('never offers a wheel step two different ways to say it went well', () => {
    for (const step of FIELD_TEST_STEPS) {
      if (!step.wheel) continue;
      const good = step.responses.filter((r) => r.kind === 'good');
      expect(
        good.length,
        `${step.id} offers ${good.length} good answers: ${good.map((r) => r.id).join(', ')}`,
      ).toBeLessThanOrEqual(1);
    }
    // ...and the shared set, which is the one four wheel steps use, has one.
    const shared = FIELD_TEST_STEPS.find((s) => s.id === 'wheel-talking');
    expect(shared?.responses.filter((r) => r.kind === 'good').map((r) => r.id)).toEqual([
      'wheel-car-quiet',
    ]);
  });

  /**
   * Echo suppression is a window sized from a character-count estimate, so it
   * can be too short (the app's own line comes back as the transcript) or too
   * long (the operator's answer is swallowed). Both used to land on answers
   * that read as the CAR misrouting the microphone -- the hypothesis under
   * test.
   */
  it('lets the microphone step blame the app rather than the car', () => {
    expect(labels('mic-heard')).toContain('heard-self');
  });
});

/**
 * `motionForCondition` was exported, tested, and called by nothing -- so the
 * two driven conditions and the two parked ones behaved identically, including
 * the start gate the operator reads with their eyes before a run that seizes
 * the volume and starts talking.
 */
describe('whether the car is moving', () => {
  it('records it on the run, so a renamed condition does not lose it', () => {
    clearDiagnosticLog();
    logFieldTestRunStart('freeway', undefined, 32, false);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    expect(start?.detail?.motion, 'nothing in the run says whether the car was moving').toBe(
      'driving',
    );
  });

  it('does not call a parked condition driven', () => {
    clearDiagnosticLog();
    logFieldTestRunStart('car', undefined, 32, false);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    expect(start?.detail?.motion).toBe('parked');
  });

  it('has a driven condition to warn about and a parked one not to', () => {
    // The screen branches on this, so a protocol where every condition were
    // one or the other would make the branch dead without anything failing.
    const motions = new Set(FIELD_TEST_CONDITIONS.map((c) => c.motion));
    expect(motions.has('driving')).toBe(true);
    expect(motions.has('parked')).toBe(true);
  });
});

/**
 * `runId` was introduced because "two runs under the same condition in one
 * export used to be separable only by adjacency to `run-start`". `run-start`
 * was then logged before the run existed, from a screen with no ambient
 * context -- so the one line marking a run's beginning was the one line that
 * could not be joined to it.
 */
describe('the line that opens a run', () => {
  /**
   * THE STEP COUNT IS THE PATH'S, NOT THE LIST'S. `steps=` was the number of
   * non-probe steps in `FIELD_TEST_STEPS`, so under a no-Bluetooth leg -- seven
   * wheel steps off the path -- `run-end stamped=` could never reach it, and
   * with probes armed it could exceed it. Both bounds are the caller's to
   * measure with `fieldTestStepCount`; this line only carries them.
   */
  it('carries the step count it was given, at both ends', () => {
    clearDiagnosticLog();
    logFieldTestRunStart('speakerphone', 'abc123', 25, false);
    logFieldTestRunEnd('speakerphone', 20, 29);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    const end = readDiagnosticLog().find((e) => e.event === 'run-end');
    expect(start?.detail?.steps).toBe(25);
    expect(end?.detail).toMatchObject({ stamped: 20, steps: 29 });
  });

  it('carries the id of the run it opens', () => {
    clearDiagnosticLog();
    logFieldTestRunStart('freeway', 'abc123', 32, false);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    expect(start?.detail?.run, 'run-start cannot be joined to its own run').toBe('abc123');
  });

  /**
   * The `answer-by-voice` row is written from the gate, between runs as often
   * as inside one, so it cannot say which run it applied to. The run's own
   * boundary row can.
   */
  it('says whether the run answers out loud', () => {
    clearDiagnosticLog();
    logFieldTestRunStart('freeway', 'abc123', 32, true);
    logFieldTestRunStart('freeway', 'abc124', 32, false);
    const rows = readDiagnosticLog().filter((e) => e.event === 'run-start');
    expect(rows.map((r) => r.detail?.answerByVoice)).toEqual([true, false]);
  });

  it('still writes the line when there is no id to carry', () => {
    // A run begun by an older build. Worse than having one, not worse than
    // losing the boundary entirely.
    clearDiagnosticLog();
    logFieldTestRunStart('freeway', undefined, 32, false);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    expect(start?.detail?.condition).toBe('freeway');
    expect(start?.detail?.run).toBeUndefined();
  });
});

/**
 * The answer stack hangs from the bottom of the screen for one reason: so the
 * button that means the same thing on every step is at the same pixel on every
 * step. That only works if the protocol actually puts it last.
 *
 * `wheel-other` spread the shared wheel answers and then appended one of its
 * own, which pushed "Missed it" a full 60px button pitch up the stack on that
 * step alone — at the one position a driver reaches for without looking, and
 * the position whose whole purpose is to stop a merging driver inventing an
 * answer. Measured across the run as a 60px spread that no layout rule could
 * remove, because it was not a layout fault.
 */
describe('the escape hatch every step shares', () => {
  const OPT_OUT = 'missed';

  it('is offered on every step that asks the operator to judge something', () => {
    const without = FIELD_TEST_STEPS.filter(
      (step) => !step.responses.some((r) => r.id === OPT_OUT),
    ).map((s) => s.id);
    // NO EXCEPTIONS ANY MORE. `free` used to be one, on the grounds that its
    // answers are all notes already and there is nothing specific to have
    // missed -- which was true about the step and wrong about the screen. It
    // is the LAST step of the run, so the bottom button an eyes-free operator
    // taps blind quietly became "Nothing to report": an answer filed rather
    // than an answer declined, on the step whose whole purpose is free
    // observation.
    expect(without, 'a step has no way to decline to answer').toEqual([]);
  });

  it('is the last answer on every step that has it, so it never moves', () => {
    const misplaced = FIELD_TEST_STEPS.filter((step) => {
      const at = step.responses.findIndex((r) => r.id === OPT_OUT);
      return at !== -1 && at !== step.responses.length - 1;
    }).map((step) => `${step.id} (slot ${step.responses.findIndex((r) => r.id === OPT_OUT) + 1} of ${step.responses.length})`);
    expect(
      misplaced,
      'the bottom-anchored answer stack only holds "Missed it" still if it is last',
    ).toEqual([]);
  });
});

/**
 * A repeated measure has to ask the same question every time, and must not tell
 * the operator what the answer would mean.
 *
 * Four steps did both wrong. Three route samples and the step carrying the
 * protocol's headline hypothesis ended their instructions with the finding:
 * "if this one came from somewhere else, that is the bug", "if the answer has
 * changed, the microphone moved it and never moved it back", "so it can land
 * somewhere the long ones do not", "long enough for the car to change its mind
 * halfway". The operator is being asked to judge a faint difference in a moving
 * car, having just been told which answer is the interesting one — and the
 * 2x2 the whole protocol was restructured around compares those very steps
 * against each other. Priming one arm of a within-subject comparison and not
 * the other produces the effect it is looking for.
 *
 * The reasoning still exists; it is in the comments, where the person reading
 * the export needs it and the person driving does not see it.
 */
describe('the question the route block asks', () => {
  const ROUTE_STEPS = FIELD_TEST_STEPS.filter((step) =>
    step.responses.some((r) => r.kind === 'route'),
  );

  it('is asked on more than one step, or there is nothing to compare', () => {
    expect(ROUTE_STEPS.length).toBeGreaterThan(6);
  });

  it('is worded identically on every sample', () => {
    const questions = ROUTE_STEPS.map((step) => ({
      id: step.id,
      asks: step.instruction.slice(step.instruction.lastIndexOf('.', step.instruction.length - 2) + 1).trim(),
    }));
    const wordings = [...new Set(questions.map((q) => q.asks))];
    expect(
      wordings,
      `the same measurement is asked for in ${wordings.length} different words: ${JSON.stringify(questions)}`,
    ).toHaveLength(1);
  });

  it('tells the operator nothing about what their answer would mean', () => {
    // Conditional clauses about the result, in an instruction, are the shape
    // the removed lines had. None of these words belong in a question.
    const LEADING = [
      'that is the bug',
      'the microphone moved it',
      'never moved it back',
      'the long ones do not',
      'change its mind',
      'is the fault',
      'means the',
    ];
    const primed = ROUTE_STEPS.filter((step) =>
      LEADING.some((phrase) => step.instruction.toLowerCase().includes(phrase)),
    ).map((step) => step.id);
    expect(primed, 'a route step tells the operator what to conclude').toEqual([]);
  });
});

/**
 * A modifier is an observation that is true ALONGSIDE the answer.
 *
 * It exists because two steps were asking the operator to choose between two
 * facts that are both true of the same event: "it moved while playing" against
 * the destination it ended at, and "I pressed twice" against "the radio took
 * one of them". In both cases the more interesting fact is the one an honest
 * operator taps, so the other was systematically lost — and in the route
 * block that meant a run where the route moves often reads as eight identical
 * cells, which is the shape of "no effect".
 *
 * The cost is a second tap in a moving car, so the shape is constrained: a
 * modifier can never be the only thing on offer, and the escape hatch can
 * never be one, or a step could be left with no way to answer it at all.
 */
describe('an answer that marks rather than answers', () => {
  const modifiers = FIELD_TEST_STEPS.flatMap((step) =>
    step.responses.filter((r) => r.modifier).map((r) => `${step.id}:${r.id}`),
  );

  it('exists, or the two-true-things problem was not fixed', () => {
    expect(modifiers.length).toBeGreaterThan(0);
  });

  it('never leaves a step with nothing that actually answers it', () => {
    const stuck = FIELD_TEST_STEPS.filter(
      (step) => !step.responses.some((r) => !r.modifier),
    ).map((s) => s.id);
    expect(stuck, 'a step offers only marks, so it can never be stamped').toEqual([]);
  });

  it('is never the escape hatch', () => {
    // "Missed it" has to end the step: it is what a merging driver taps when
    // they have nothing to report, and a mark would leave them still on it.
    const bad = FIELD_TEST_STEPS.filter((step) =>
      step.responses.some((r) => r.id === 'missed' && r.modifier),
    ).map((s) => s.id);
    expect(bad).toEqual([]);
  });

  it('is never the last answer, where the escape hatch lives', () => {
    const misplaced = FIELD_TEST_STEPS.filter(
      (step) => step.responses[step.responses.length - 1]?.modifier,
    ).map((s) => s.id);
    expect(misplaced).toEqual([]);
  });

  it('covers the mid-utterance route move and the radio stealing a press', () => {
    // Named exactly, because these two are the findings the mechanism exists
    // for and a future edit that drops the flag should say so out loud.
    const ids = new Set(modifiers.map((m) => m.split(':')[1]));
    expect(ids.has('route-moved'), 'a route move is a choice again').toBe(true);
    expect(
      ids.has('wheel-radio-took-one'),
      'the radio taking one of two presses is a choice again',
    ).toBe(true);
    // ...and the STAMPING one is not a modifier, which is the other half of
    // the same requirement: one id, one behaviour, one slot.
    expect(ids.has('wheel-radio'), 'the plain radio answer became a modifier').toBe(false);
  });
});

/**
 * Only the first leg of a page has a genuine "before the microphone".
 *
 * Nothing is torn down between conditions that the app does not own. The four
 * legs run in one page, so the phone's hands-free profile carries over, and
 * legs two, three and four run their before-microphone cells in a session that
 * has already opened and closed the microphone twice — while the protocol's
 * headline comparison is exactly before-mic against after-mic. A difference
 * read across conditions may be "parked differs from freeway" or may be "leg 1
 * differs from leg 4", and nothing in the export said which.
 *
 * It cannot be fixed from inside the page, so it is MEASURED from inside the
 * page: the count is on the line that opens every run.
 */
describe('what a run says about the page it started in', () => {
  beforeEach(() => {
    // Both, and the log matters as much as the counter: an earlier describe in
    // this file opens runs of its own, so without clearing, the first
    // assertion reads someone else's `run-start` as this page's history.
    clearDiagnosticLog();
    _resetFieldTestSessionForTest();
  });

  it('counts the legs this page has already run', () => {
    logFieldTestRunStart('car', 'aaa', 32, false);
    logFieldTestRunStart('freeway', 'bbb', 32, false);
    logFieldTestRunStart('phone', 'ccc', 32, false);
    const starts = readDiagnosticLog().filter((e) => e.event === 'run-start');
    expect(starts.map((e) => e.detail?.legsBefore)).toEqual([0, 1, 2]);
  });

  it('says how long the page has been open, so a stale session is visible', () => {
    logFieldTestRunStart('car', 'aaa', 32, false);
    const start = readDiagnosticLog().find((e) => e.event === 'run-start');
    expect(typeof start?.detail?.sessionAgeMs).toBe('number');
    expect(start?.detail?.sessionAgeMs as number).toBeGreaterThanOrEqual(0);
  });

  it('reports a fresh page as fresh', () => {
    // The value the whole thing hangs on: `legsBefore=0` is the only leg whose
    // before-microphone cells are before anything.
    expect(fieldTestLegsThisSession()).toBe(0);
    logFieldTestRunStart('car', 'aaa', 32, false);
    expect(fieldTestLegsThisSession()).toBe(1);
  });
});

/**
 * Four samples of one state, or four samples of four different states?
 *
 * The post-microphone half of the 2x2 is four cells: `route-after-mic` and its
 * pair on the clip path, `route-after-mic-t` and its pair on the fallback
 * voice. Only the FIRST of them declared `awaitSilent`, so only that one was
 * preceded by a confirmed teardown and the declared settle — the other three
 * spoke whenever the operator happened to arrive, which in a car is anything
 * from two seconds to a minute.
 *
 * That matters because of what the block is FOR. One of its two live
 * hypotheses is that the phone comes back on a timer; under that hypothesis
 * four cells taken at four unknown offsets disagree with each other, and the
 * protocol reads the disagreement as the route alternating. The previous
 * assertion pinned only that the pair are adjacent, which is equally true of
 * samples a second apart and samples a minute apart.
 */
describe('one starting line for every cell after the microphone', () => {
  /** Every step that speaks with the microphone already down. */
  /**
   * SCOPED TO THE ROUTING PROTOCOL, because the walk is positional and the
   * two protocols share one array.
   *
   * `setup.voice` carries forward, so without this the walk leaves the
   * routing list with the microphone flag still set and reports the first
   * drill steps as "after the microphone" -- when on a drill leg they are the
   * FIRST steps on the path and no microphone has opened at all. The drill
   * protocol has its own post-microphone step, `echo-after-voice`, with its
   * own assertion below.
   */
  const routingSteps = FIELD_TEST_STEPS.filter((s) => (s.protocol ?? 'routing') === 'routing');
  const drillSteps = FIELD_TEST_STEPS.filter((s) => s.protocol === 'drill');

  const afterMic = (() => {
    let voice = false;
    let wasOn = false;
    const out: (typeof FIELD_TEST_STEPS)[number][] = [];
    for (const step of routingSteps) {
      if (step.setup?.voice !== undefined) voice = step.setup.voice;
      if (voice) {
        wasOn = true;
        continue;
      }
      if (wasOn && (step.say?.length ?? 0) > 0) out.push(step);
    }
    return out;
  })();

  it('finds the post-microphone cells at all', () => {
    // The guard on everything below: a walk that returns nothing would make
    // every other assertion here vacuously true.
    expect(afterMic.map((s) => s.id)).toContain('route-after-mic');
    expect(afterMic.length).toBeGreaterThanOrEqual(4);
  });

  it('makes every one of them wait, not just the first', () => {
    const unguarded = afterMic.filter((step) => step.awaitSilent !== true).map((s) => s.id);
    expect(
      unguarded,
      'these speak at whatever offset the operator arrives at, and are then compared against one that waited',
    ).toEqual([]);
  });

  /**
   * ONE BLOCK IN THE PROTOCOL — WHICH IS NOT THE SAME CLAIM AS ONE CLOSE.
   *
   * This used to be named "opens the microphone exactly once, which is what
   * the offset counts from", and `FieldTest.tsx` pointed at it by name as the
   * guard on `micClosedAtRef`. It cannot be that guard and never could: it
   * walks `FIELD_TEST_STEPS[].setup.voice`, which is DECLARED protocol data,
   * while the runner watches `voiceStatus.state`, a runtime signal that flips
   * on every recogniser restart — and on iOS the recogniser ends after
   * every utterance, so a single declared block produced a dozen closes. The
   * protocol could satisfy this test forever while the export was wrong on
   * every mic-open row.
   *
   * What it does assert is worth keeping, so it stays, renamed to it: the
   * protocol declares ONE microphone block, which is what makes "before the
   * microphone" and "after the microphone" two cells rather than four. The
   * runtime property — that a restart is not recorded as a close — is
   * pinned in `e2e/field-test-mic.spec.ts`, against a recogniser that ends
   * its session the way a phone does.
   */
  const microphoneBlocks = (steps: readonly (typeof FIELD_TEST_STEPS)[number][]) => {
    let voice = false;
    let blocks = 0;
    for (const step of steps) {
      if (step.setup?.voice === undefined) continue;
      if (step.setup.voice && !voice) blocks += 1;
      voice = step.setup.voice;
    }
    return { blocks, endsOpen: voice };
  };

  it('declares exactly one microphone block, so before and after are two cells', () => {
    const routing = microphoneBlocks(routingSteps);
    expect(
      routing.blocks,
      'the protocol declares more than one microphone block, so "before" and "after" are no longer two cells',
    ).toBe(1);
    expect(routing.endsOpen, 'the leg ends with the microphone still open').toBe(false);
  });

  /**
   * THE SAME INVARIANT FOR THE DRILL PROTOCOL, which needs it for a different
   * reason. Its point of interest is the step immediately after the
   * microphone shuts (`echo-after-voice`): the press that went missing for
   * nine minutes on 2026-09-29. A second block anywhere in the list would
   * mean "after the microphone" named two different moments, and a leg that
   * ended with the microphone still open would leave the car in the
   * hands-free profile for whatever the operator did next.
   */
  it('declares exactly one microphone block on the drill protocol too', () => {
    const drill = microphoneBlocks(drillSteps);
    expect(drill.blocks, 'the drill leg opens the microphone more than once').toBe(1);
    expect(drill.endsOpen, 'the drill leg ends with the microphone still open').toBe(false);
  });

  it('puts the drill protocol\u2019s post-microphone press behind the silence guard', () => {
    const step = drillSteps.find((x) => x.id === 'echo-after-voice');
    expect(step, 'the step that asks what the wheel does after the microphone is gone').toBeTruthy();
    // `setVoiceOn(false)` only REQUESTS the end of a session; the phone tears
    // the link down some time later. Without this the press is tested while
    // the microphone is still coming down, which is the confound the whole
    // step exists to remove.
    expect(step?.awaitSilent, 'it presses while the microphone is still coming down').toBe(true);
    expect(step?.setup?.voice, 'it leaves the microphone on').toBe(false);
  });

  it('covers both paths, so the wait is not what separates them', () => {
    // If only the clip cells waited, "clip differs from TTS after the
    // microphone" would be confounded with "one pair waited and one did not".
    const ids = afterMic.map((s) => s.id);
    expect(ids).toContain('route-after-mic');
    expect(ids).toContain('route-after-mic-t');
    for (const id of ['route-after-mic', 'route-after-mic-2', 'route-after-mic-t', 'route-after-mic-2t']) {
      expect(
        FIELD_TEST_STEPS.find((s) => s.id === id)?.awaitSilent,
        `${id} does not share the starting line of the cell it is compared against`,
      ).toBe(true);
    }
  });
});

/**
 * Questions the protocol asks that only the operator can answer, and
 * instructions that quietly change the thing being measured.
 *
 * Every finding here is one of two shapes: a step that collects an answer
 * nobody can give honestly, or a step that moves a variable the run is
 * supposed to hold still. Both produce a log that reads clean and means
 * something else.
 */
describe('what the operator is asked to do', () => {
  const byId = (id: string) => FIELD_TEST_STEPS.find((s) => s.id === id)!;

  it('names the buttons that are safe rather than excluding a couple', () => {
    // S7/F1. Car volume is the one gain stage the app cannot see, so a leg
    // where it moved answers every later loudness question against a
    // different baseline. Call-answer seizes hands-free outright -- the exact
    // transition the rest of the protocol is built to observe -- nineteen
    // steps before the block that measures it. Mode/source takes the head
    // unit off Bluetooth audio entirely.
    //
    // A BLACKLIST WAS NOT ENOUGH, and neither was the assertion on it: the
    // first version of this test used `not.toMatch(/\bvolume\b(?!.*NOT)/i)`,
    // and the `i` let the lookahead be satisfied by any later "not",
    // "nothing" or "cannot" in the sentence. It asserted almost nothing.
    const asked = byId('wheel-other').instruction;
    // What the operator is told to press, by name.
    expect(asked, 'the step names no button that is safe to press').toMatch(/skip-BACK/);
    // And the three that ruin the leg, each ruled out in its own clause.
    expect(asked, 'call-answer is not ruled out').toMatch(/answers a call/i);
    expect(asked, 'the volume is not ruled out').toMatch(/changes volume|changes the volume/i);
    expect(asked, 'the source is not ruled out').toMatch(/changes source|changes the source/i);
    // No open-ended invitation survives anywhere in the sentence.
    expect(asked, 'the step still invites any button at all').not.toMatch(
      /anything else|whatever|any button/i,
    );
  });

  it('lets the operator say they never got the word out', () => {
    // S9. Everything else on mic-heard is already in the log: the transcript,
    // and whether the recogniser produced anything. The one fact held only by
    // the driver is whether they actually said it, and without a button for it
    // "It never heard me" carried both that and a dead microphone.
    const ids = byId('mic-heard').responses.map((r) => r.id);
    expect(ids, 'a missed utterance can only be filed as the microphone failing').toContain(
      'heard-not-said',
    );
    expect(byId('mic-heard').responses.find((r) => r.id === 'heard-not-said')?.kind).toBe('note');
  });

  it('names the route by where it comes from, not by how loud it was', () => {
    // S11. "(barely audible)" is true in a moving car and false in the hand,
    // and `phone` is a condition. A judgement inside the label pushes the
    // honest answer onto the wrong button.
    const earpiece = ROUTE_ANSWERS.find((r) => r.id === 'route-earpiece')!;
    expect(earpiece.label).not.toMatch(/audible|loud|quiet/i);
  });

  it('says where the phone is in every condition', () => {
    // S11. Earpiece-versus-loudspeaker is a pure function of distance from
    // your head, so a leg run with the phone in a cradle and one run with it
    // in a lap are not the same measurement at all.
    for (const c of FIELD_TEST_CONDITIONS) {
      expect(c.setup, `${c.id} does not say where the phone is`).toMatch(
        /cradle|in your hand|lap|against your ear/i,
      );
    }
  });

  it('runs one leg with the phone at the ear, and only one', () => {
    // F7. `route-earpiece` and `route-silent` are the same report everywhere
    // else: a receiver is inaudible from a cradle an arm's length away, and
    // at road speed it is inaudible full stop. If NO condition holds the
    // phone to the head, the protocol has two buttons for one cell and the
    // distinction between "iOS moved this to the receiver" and "this never
    // played" — opposite diagnoses — is not in the data at all.
    const atEar = FIELD_TEST_CONDITIONS.filter((c) => /against your ear|to your ear/i.test(c.setup));
    expect(atEar.map((c) => c.id), 'no leg can separate the earpiece from silence').toEqual([
      'phone',
    ]);
    // ROUTING LEGS ONLY. The claim is about `ROUTE_ANSWERS`, which offers
    // `route-earpiece` and `route-silent` as separate buttons -- so a leg
    // that cannot separate them has to say so, or the analysis reads two
    // cells where there is one. A drill leg asks no routing question and
    // offers neither button, so there is nothing for it to admit.
    const routingConditions = FIELD_TEST_CONDITIONS.filter(
      (c) => (c.protocol ?? 'routing') === 'routing',
    );
    for (const c of routingConditions.filter((x) => x.id !== 'phone')) {
      expect(
        c.proves,
        `${c.id} does not admit that the earpiece and silence are one answer in it`,
      ).toMatch(/earpiece/i);
    }
  });
});

/**
 * S13: a condition with no Bluetooth still has six wheel steps.
 */
describe('a condition the car is not part of', () => {
  it('knows which conditions have the car in the audio path', () => {
    // F4. `phone` used to be flagged Bluetooth-ON while its own setup text
    // said "engine off". With the engine off a Corolla's head unit is dark:
    // nothing to pair to, no wheel to press, no route to a car speaker. The
    // flag drove `stepResponses`, so all six wheel steps of that leg buried
    // "No Bluetooth" at slot five behind four answers about what a car that
    // was not switched on did.
    //
    // ASSERTED AGAINST THE SETUP TEXT, not against a list of ids: the flag
    // and the sentence the operator follows have to agree, and it was their
    // disagreement that was the bug.
    for (const c of FIELD_TEST_CONDITIONS) {
      const saysOff = /bluetooth off/i.test(c.setup);
      expect(
        c.bluetooth,
        `${c.id} is flagged bluetooth=${String(c.bluetooth)} and its setup says ${
          saysOff ? 'Bluetooth OFF' : 'nothing about turning Bluetooth off'
        }`,
      ).toBe(!saysOff);
    }
    // Both directions are populated, or the assertion above is vacuous.
    expect(FIELD_TEST_CONDITIONS.filter((c) => c.bluetooth).length).toBeGreaterThan(0);
    expect(FIELD_TEST_CONDITIONS.filter((c) => !c.bluetooth).length).toBeGreaterThan(0);
  });

  it('still puts the escape hatch last, which is what makes it findable', () => {
    for (const step of FIELD_TEST_STEPS.filter((s) => s.wheel)) {
      const ids = stepResponses(step).map((r) => r?.id);
      expect(ids.at(-1), `${step.id} moved "Missed it"`).toBe('missed');
    }
  });

  it('leaves the steps that are not about the wheel alone', () => {
    for (const step of FIELD_TEST_STEPS.filter((s) => !s.wheel)) {
      expect(stepResponses(step)).toEqual(step.responses);
    }
  });
});

/**
 * E5: the same thumb position meaning two different things.
 *
 * The answer stack hangs from the bottom of the screen, which pins `MISSED`
 * and nothing else. Six steps use the wheel answers and they do not all use
 * the same ones, so bottom-anchoring moved answers under the operator's thumb
 * BETWEEN WHEEL STEPS: measured at 390x763, y=477 was "The car did nothing
 * else" on one step and "The radio changed track" on the next. Those are the
 * two opposite readings of the fault under test, on the steps performed with
 * eyes on the road.
 */
describe('where an answer sits, from one step to the next', () => {
  const wheelSteps = FIELD_TEST_STEPS.filter((s) => s.wheel);

  it('keeps every wheel answer in the same position on every wheel step', () => {
    const seen = new Map<string, number>();
    for (const step of wheelSteps) {
      stepResponses(step).forEach((r, i) => {
        if (!r) return;
        const was = seen.get(r.id);
        if (was === undefined) seen.set(r.id, i);
        else
          expect(
            i,
            `"${r.label}" is slot ${was} on one wheel step and ${i} on ${step.id}`,
          ).toBe(was);
      });
    }
    expect(seen.size, 'no wheel answers were checked').toBeGreaterThan(3);
  });

  it('holds the empty positions open rather than closing them up', () => {
    // A step with nothing for a slot renders a gap. Closing it would move
    // every answer below it up by one button pitch, which is the whole
    // failure -- so the gaps are the mechanism, not a side effect.
    const gappy = wheelSteps.filter((s) => stepResponses(s).some((r) => r === null));
    expect(gappy.length, 'no wheel step has a gap, so the slots are not fixed').toBeGreaterThan(0);
    for (const step of wheelSteps) {
      expect(stepResponses(step)).toHaveLength(6);
    }
  });

  it('loses and invents nothing in the process', () => {
    for (const step of FIELD_TEST_STEPS) {
      const shown = stepResponses(step)
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .map((r) => r.id);
      expect([...shown].sort(), step.id).toEqual([...step.responses.map((r) => r.id)].sort());
    }
  });

  it('ends every step in the protocol with the same button', () => {
    // The bottom of the stack is the one position an operator can find
    // without looking, and the last step had no `MISSED` at all -- so on that
    // step the blind tap silently became "Nothing to report", which is an
    // answer rather than a refusal to give one.
    for (const step of FIELD_TEST_STEPS) {
      const slots = stepResponses(step);
      expect(slots.at(-1)?.id, `${step.id} does not end with the escape hatch`).toBe('missed');
    }
  });


  it('claims only what a four-variable change can prove', () => {
    // S13. Bluetooth off, the phone's own speaker, no wheel, and a different
    // audio session: "so anything that fails here too is the app or the road,
    // not the car" read that as a one-variable control.
    const proves = FIELD_TEST_CONDITIONS.find((c) => c.id === 'speakerphone')!.proves;
    expect(proves, 'the control claims to isolate one variable').not.toMatch(/same distance/i);
    expect(proves).toMatch(/car/i);
  });
});

/**
 * F3: the cell every conclusion is read against was composed differently.
 *
 * `route-short` ("Correct?") and `route-long` (fifteen words) sat in the
 * clip/before cell, so it was A, B, one word, a sentence -- against A, B, A in
 * all five others. A one-word clip is the utterance most likely to be answered
 * "heard nothing" under road noise and a long one the most likely to be
 * interrupted, so the difference did not merely add noise: it ran towards the
 * two answers the protocol reads as failure, in the cell used as the baseline.
 */
describe('every cell of the crossing is composed the same way', () => {
  // The grouping is exported now: the in-drive detector reads the same cells
  // this test reads, so there is one definition of "a cell" and not two.
  const crossed = routeCells;

  it('gives every cell the same number of samples', () => {
    // NOT ">= 3". The old assertion was a floor, and a floor let the cell with
    // four odd utterances pass next to cells with three matched ones. A
    // crossing read cell against cell has to hold the count fixed too.
    const sizes = [...crossed().values()].map((ids) => ids.length);
    expect(sizes.length, 'the crossing lost a cell entirely').toBe(6);
    expect(
      new Set(sizes).size,
      `the cells hold ${sizes.join(', ')} samples: a cell with more samples than its comparison is not a control`,
    ).toBe(1);
    expect(sizes[0]).toBe(3);
  });

  it('speaks the same three lines, in the same order, in every cell', () => {
    const say = (id: string) => FIELD_TEST_STEPS.find((s) => s.id === id)!.say![0];
    const want = [say('route-1'), say('route-2'), say('route-1')];
    expect(want[0], 'line A is empty').toBeTruthy();
    expect(want[1], 'line B is empty').toBeTruthy();
    expect(want[0]).not.toBe(want[1]);
    for (const [key, ids] of crossed()) {
      expect(
        ids.map(say),
        `${key} (${ids.join(', ')}) does not speak A, B, A -- so its answers differ from their comparison cell by the utterance as well as by the condition`,
      ).toEqual(want);
    }
  });

  it('keeps the odd-length samples, and keeps them out of the crossing', () => {
    // They are worth running: a single word is the shape most likely to be
    // lost and a long sentence the shape most likely to be cut off. They are
    // just not the same question, and `aux` is what says so.
    const aux = FIELD_TEST_STEPS.filter((s) => s.aux).map((s) => s.id);
    expect(aux).toEqual(['route-short', 'route-long']);
    for (const id of aux) {
      const step = FIELD_TEST_STEPS.find((s) => s.id === id)!;
      expect(step.responses.some((r) => r.kind === 'route'), `${id} stopped asking`).toBe(true);
      expect(step.say?.length, `${id} says nothing`).toBeGreaterThan(0);
    }
  });
});

/**
 * F8: "out of the car speakers" cannot happen with Bluetooth off.
 *
 * The button stays where it is — a route answer that moves between legs is
 * how the next wrong answer gets tapped at speed — so the export is what
 * has to say it, on the row the 2x2 is assembled from.
 */
describe('an answer that the leg makes impossible', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  it('marks a car-speaker answer taken with Bluetooth off', () => {
    stampFieldTest('route-1', 'speakerphone', 'route-car');
    stampFieldTest('route-1', 'phone', 'route-car');
    const marked = readDiagnosticLog()
      .filter((e) => e.event === 'answer')
      .map((e) => e.detail?.impossible);
    expect(marked, 'a car-speaker answer on a leg with no car reads as evidence').toEqual([
      true,
      true,
    ]);
  });

  it('leaves an answer the leg can actually produce unmarked', () => {
    stampFieldTest('route-1', 'car', 'route-car');
    stampFieldTest('route-1', 'freeway', 'route-car');
    stampFieldTest('route-1', 'speakerphone', 'route-phone');
    for (const e of readDiagnosticLog().filter((x) => x.event === 'answer')) {
      expect(
        e.detail?.impossible,
        `${String(e.detail?.condition)}/${String(e.detail?.answer)} was marked impossible`,
      ).toBeUndefined();
    }
  });
});

/**
 * W10: an answer id the step does not offer reads as a real answer.
 *
 * This test file was itself stamping `wheel-nothing`, deleted from the
 * protocol months earlier, and nothing anywhere noticed — which is exactly
 * what would happen to a rename that missed a call site, in a log whose whole
 * purpose is to be greppable after the drive.
 */
describe('an answer the step does not offer', () => {
  beforeEach(() => {
    clearDiagnosticLog();
  });

  it('is marked unknown rather than filed as evidence', () => {
    stampFieldTest('wheel-gap', 'car', 'wheel-nothing');
    expect(
      readDiagnosticLog().find((e) => e.event === 'answer')?.detail?.unknown,
      'a deleted response id reads as a real answer',
    ).toBe(true);
  });

  it('leaves every id the step really offers alone', () => {
    for (const step of FIELD_TEST_STEPS) {
      for (const response of step.responses) {
        clearDiagnosticLog();
        stampFieldTest(step.id, 'car', response.id);
        expect(
          readDiagnosticLog().find((e) => e.event === 'answer')?.detail?.unknown,
          `${step.id}/${response.id} is offered by the step and was marked unknown`,
        ).toBeUndefined();
      }
    }
  });

  it('says nothing about a step the protocol does not have', () => {
    // A caller outside the protocol -- a test, a future screen -- is not the
    // same fault and must not be labelled as one.
    clearDiagnosticLog();
    stampFieldTest('not-a-step', 'car', 'whatever');
    expect(readDiagnosticLog().find((e) => e.event === 'answer')?.detail?.unknown).toBeUndefined();
  });
});

/**
 * E2: one position, one behaviour.
 *
 * A `modifier` answer arms a marker and leaves the step open; every other
 * answer stamps and advances. `wheel-radio` was a plain answer on
 * `wheel-other` and a modifier on `wheel-repeat`, the step immediately after
 * it, at the same slot, in the same colour, with labels differing by two
 * words. The operator learns positions, not labels.
 */
describe('a learned position does not change what a tap does', () => {
  it('never offers one id as a modifier on one step and not on another', () => {
    const kinds = new Map<string, Set<boolean>>();
    for (const step of FIELD_TEST_STEPS) {
      for (const r of step.responses) {
        kinds.set(r.id, (kinds.get(r.id) ?? new Set()).add(r.modifier === true));
      }
    }
    for (const [id, seen] of kinds) {
      expect(
        seen.size,
        `${id} arms a marker on one step and stamps on another, and the operator cannot see which`,
      ).toBe(1);
    }
  });

  it('never puts a stamping answer and a modifier in the same slot', () => {
    const modifier = new Map<string, boolean>();
    for (const step of FIELD_TEST_STEPS) {
      for (const r of step.responses) modifier.set(r.id, r.modifier === true);
    }
    for (const step of FIELD_TEST_STEPS.filter((x) => x.wheel)) {
      const slots = stepResponses(step);
      for (const [i, slot] of slots.entries()) {
        if (slot === null) continue;
        // Every OTHER wheel step's answer at this position.
        for (const other of FIELD_TEST_STEPS.filter((x) => x.wheel && x.id !== step.id)) {
          const there = stepResponses(other)[i];
          if (!there) continue;
          expect(
            modifier.get(there.id),
            `slot ${i} is "${slot.label}" on ${step.id} and "${there.label}" on ${other.id}, and one of them advances while the other does not`,
          ).toBe(modifier.get(slot.id));
        }
      }
    }
  });

  it('keeps both facts about a pair of presses available', () => {
    // The modifier exists because "I pressed twice" and "the radio took one
    // of them" are independent: an arrival count of 1 with neither recorded
    // is the diagnosis and its opposite collapsed into one number.
    const step = FIELD_TEST_STEPS.find((x) => x.id === 'wheel-repeat')!;
    const ids = step.responses.map((r) => r.id);
    expect(ids).toContain('wheel-repeat-done');
    expect(ids).toContain('wheel-radio-took-one');
    expect(step.responses.find((r) => r.id === 'wheel-radio-took-one')?.modifier).toBe(true);
  });
});

/**
 * E7: an instruction the operator cannot see.
 *
 * `.fieldtest-head` is capped at 130px with `overflow-y: auto`, because every
 * other row on the screen is already at its floor -- six 44px answers, the
 * 44px evidence slot, the 48px control row and the 48px nav row. So a long
 * instruction does not push anything; it is simply cut off, and the only way
 * to reach the rest is to scroll a panel with a thumb while driving.
 * Measured, three steps overflowed it: `fallback-audible` by 53-94px at every
 * phone height, `wheel-other` and `wheel-repeat` at the three shortest.
 *
 * A character count is a proxy for a pixel measurement, and it is the right
 * one HERE: the geometry is measured in the layout spec, and this is the
 * thing a person editing the protocol will change without opening a browser.
 */
/**
 * WHAT THE STEP IS FOR, ON THE STEP.
 *
 * The leg's `proves` is rendered on the gate, which the operator reads once,
 * parked, before a twenty-minute drive -- and then answers ten steps with no
 * reminder of what any of them is measuring. The instruction says what to DO;
 * it deliberately does not say why, because a step that argues its case in
 * the imperative gets longer and less scannable at speed.
 *
 * So `purpose` is a separate short line, printed and never spoken. Never
 * spoken for two reasons: the drill legs measure whether a specific sentence
 * survives road noise, and prefixing every sample with a clause about the
 * experiment lengthens the audio the operator has to sit through on the very
 * steps that are timed against a settle window.
 */
describe('every drill step says what it is for', () => {
  // The gate's `proves` can be a paragraph -- it is read parked. This is read
  // in traffic, under the instruction, above the answer stack, and anything
  // that wraps past two lines pushes the buttons down the screen.
  const MAX_PURPOSE_CHARS = 110;

  const drill = FIELD_TEST_STEPS.filter((s) => s.protocol === 'drill');

  it('has drill steps to check, or this whole block is vacuous', () => {
    // The guard that stops the three assertions below from passing by
    // iterating an empty list -- the failure mode that makes a suite green
    // when a protocol is renamed out from under it.
    expect(drill.length).toBeGreaterThanOrEqual(10);
  });

  it('declares a purpose on every one of them', () => {
    const silent = drill.filter((s) => !s.purpose).map((s) => s.id);
    expect(
      silent,
      `these steps ask for something at speed without saying what it measures: ${silent.join(', ')}`,
    ).toEqual([]);
  });

  it('keeps each purpose to the two lines it has room for', () => {
    const tooLong = drill
      .filter((s) => (s.purpose?.length ?? 0) > MAX_PURPOSE_CHARS)
      .map((s) => `${s.id} (${s.purpose?.length})`);
    expect(
      tooLong,
      `these push the answer buttons down the screen: ${tooLong.join(', ')}`,
    ).toEqual([]);
  });

  it('says something on each, rather than being short by saying nothing', () => {
    for (const step of drill) {
      expect(step.purpose!.length, `${step.id} explains nothing`).toBeGreaterThan(24);
    }
  });

  /**
   * A DISTINCT REASON PER STEP. Two steps sharing a purpose verbatim means
   * one of them was appended without asking what it adds -- and the three
   * `hear-word-*` steps are a real temptation here, being three samples of
   * one measurement. They are allowed to rhyme; they are not allowed to be
   * the same string, because then the middle one is documented as a
   * duplicate of a measurement rather than as its second sample.
   */
  it('gives each step its own reason', () => {
    const seen = new Map<string, string>();
    for (const step of drill) {
      const clash = seen.get(step.purpose!);
      expect(clash, `${step.id} and ${clash} claim the same purpose verbatim`).toBeUndefined();
      seen.set(step.purpose!, step.id);
    }
  });

  /**
   * NEVER SPOKEN. `stepLines` is what the app reads out; a purpose that
   * leaked into `say` would be prepended to a discrimination sample, which is
   * the one thing those steps hold constant.
   */
  it('never puts the purpose into anything the app speaks', () => {
    for (const step of drill) {
      const spoken = [...(step.say ?? []), ...(step.sayUnclipped ?? [])];
      for (const line of spoken) {
        expect(line, `${step.id} speaks its purpose`).not.toContain(step.purpose!);
      }
    }
  });
});

describe('an instruction has to fit on the screen it is printed on', () => {
  // 130px of head, minus the title, at the app's own body size, is about six
  // lines of roughly 30 characters. Set where the measured offenders fail and
  // everything that fits passes, with the boundary named rather than tuned.
  const MAX_INSTRUCTION_CHARS = 150;

  it('keeps every printed instruction inside the head', () => {
    const tooLong = FIELD_TEST_STEPS.filter(
      (s) => s.instruction.length > MAX_INSTRUCTION_CHARS,
    ).map((s) => `${s.id} (${s.instruction.length})`);
    expect(
      tooLong,
      `these are clipped mid-sentence on a phone, and the only way to read the rest is to scroll the panel while driving: ${tooLong.join(', ')}`,
    ).toEqual([]);
  });

  it('still says what to do', () => {
    // The other half: "short" is trivially satisfiable by saying nothing.
    for (const step of FIELD_TEST_STEPS) {
      expect(step.instruction.length, `${step.id} instructs nobody`).toBeGreaterThan(20);
    }
  });
});

/**
 * THE DETECTOR FOR A BLOCK THAT DISAGREES WITH ITSELF.
 *
 * The 2026-09-23 drive answered car / phone / car on one block, and nothing
 * in the app noticed: `stamps` holds counts, not answers, and the block was
 * left as it was. Every test here is PAIRED WITH A CONTROL, so a detector
 * that compares first-with-last, ignores `impossible`, or treats "missed"
 * as a place the sound came from cannot pass both halves.
 */
describe('routeBlockVerdict', () => {
  const block = ['route-1', 'route-2', 'route-3'] as const;
  const given = (condition: string, ...ids: (string | [string, string])[]) => {
    const answers: Record<string, { id: string; via: 'tap'; marks?: string }[]> = {};
    ids.forEach((a, i) => {
      const [id, marks] = Array.isArray(a) ? a : [a, undefined];
      answers[`${condition}:${block[i]}`] = [{ id, via: 'tap', ...(marks ? { marks } : {}) }];
    });
    return answers;
  };

  it('calls car / loud / car wandering, and car / car / car uniform', () => {
    expect(
      routeBlockVerdict(block, given('car', 'route-car', 'route-loudspeaker', 'route-car'), 'car')
        .verdict,
    ).toBe('wandering');
    expect(
      routeBlockVerdict(block, given('car', 'route-car', 'route-car', 'route-car'), 'car').verdict,
    ).toBe('uniform');
  });

  it('drops an answer that cannot be true of the leg, so a mis-tap under speakerphone is not a wander', () => {
    // Bluetooth is off: "car speakers" is a mis-tap, not a route.
    const taps = ['route-loudspeaker', 'route-car', 'route-loudspeaker'] as const;
    expect(
      routeBlockVerdict(block, given('speakerphone', ...taps), 'speakerphone').verdict,
    ).toBe('uniform');
    // ...and the same three taps under a Bluetooth leg are a wander.
    expect(routeBlockVerdict(block, given('car', ...taps), 'car').verdict).toBe('wandering');
  });

  it('calls a block with fewer than two readable answers short, not wandering and not uniform', () => {
    expect(
      routeBlockVerdict(block, given('car', 'route-car', 'missed', 'missed'), 'car').verdict,
    ).toBe('short');
    expect(
      routeBlockVerdict(block, given('car', 'route-car', 'missed', 'route-car'), 'car').verdict,
    ).toBe('uniform');
    expect(routeBlockVerdict(block, given('car'), 'car').verdict).toBe('short');
  });

  it('merges earpiece and silent into one class except under phone, where the earpiece is a route of its own', () => {
    const taps = ['route-earpiece', 'route-silent', 'route-earpiece'] as const;
    expect(routeBlockVerdict(block, given('freeway', ...taps), 'freeway').verdict).toBe('uniform');
    expect(routeBlockVerdict(block, given('phone', ...taps), 'phone').verdict).toBe('wandering');
  });

  it('reads the last answer a step was given, so a correction after Back wins', () => {
    const answers = given('car', 'route-car', 'route-car', 'route-car');
    answers['car:route-2'] = [
      { id: 'route-loudspeaker', via: 'tap' },
      { id: 'route-car', via: 'tap' },
    ];
    expect(routeBlockVerdict(block, answers, 'car').verdict).toBe('uniform');
    answers['car:route-2'] = [
      { id: 'route-car', via: 'tap' },
      { id: 'route-loudspeaker', via: 'tap' },
    ];
    expect(routeBlockVerdict(block, answers, 'car').verdict).toBe('wandering');
  });

  it('calls a block moved when any sample was marked as moving mid-line, even if every destination agrees', () => {
    // The screen joins marks with ', ' -- a mark that is not the whole string.
    const v = routeBlockVerdict(
      block,
      given('car', 'route-car', ['route-car', 'route-x, route-moved'], 'route-car'),
      'car',
    );
    expect(v.verdict).toBe('moved');
    expect(v.answers).toEqual(['route-car', 'route-car', 'route-car']);
  });

  it('reports the classes it read, so the row can be checked against the answers', () => {
    const v = routeBlockVerdict(
      block,
      given('car', 'route-car', 'route-loudspeaker', 'route-car'),
      'car',
    );
    expect(v.classes).toEqual(['car', 'loud', 'car']);
    expect(v.answers).toEqual(['route-car', 'route-loudspeaker', 'route-car']);
    // A step never answered reads as '-', not as a missing column.
    expect(
      routeBlockVerdict(block, given('car', 'route-car', 'route-loudspeaker'), 'car').answers,
    ).toEqual(['route-car', 'route-loudspeaker', '-']);
  });
});

/**
 * THE PROBE STEPS: dormant until a block disagrees with itself.
 *
 * A, B, A cannot tell a line-dependent route from an alternating one -- both
 * read car / phone / car. A, A, B, B can: line-dependence reads car car
 * phone phone, a strict toggle reads x y x y, noise reads nothing. So each
 * probeable cell has four more steps sitting after it, declared in the fixed
 * list so `resolveFieldTestSetup` stays a pure function of the index, and
 * skipped by navigation until the block before them is scored as needing
 * them.
 */
describe('the route probes', () => {
  const probes = FIELD_TEST_STEPS.filter((s) => s.probe);
  const idx = (id: string) => FIELD_TEST_STEPS.findIndex((s) => s.id === id);
  const SITES = ['clip / mic before', 'clip / mic after'];
  const anchorOf = (cell: string) => (cell === 'clip / mic after' ? 'route-after-mic-3' : 'route-3');

  it('sit in two sites of four, each straight after the block it probes', () => {
    expect(probes).toHaveLength(8);
    for (const cell of SITES) {
      const ids = probes.filter((s) => s.probe === cell).map((s) => s.id);
      expect(ids, cell).toHaveLength(4);
      expect(idx(ids[0]!), cell).toBe(idx(anchorOf(cell)) + 1);
      for (let k = 1; k < 4; k += 1) expect(idx(ids[k]!), cell).toBe(idx(ids[k - 1]!) + 1);
    }
    // The cells they name are cells the crossing actually has.
    for (const p of probes) expect([...routeCells().keys()], p.id).toContain(p.probe);
  });

  it('speak A, A, B, B, which is what separates line-dependence from alternation', () => {
    const say = (id: string) => FIELD_TEST_STEPS.find((s) => s.id === id)!.say![0];
    const A = say('route-1');
    const B = say('route-2');
    for (const cell of SITES) {
      const lines = probes.filter((s) => s.probe === cell).map((s) => s.say![0]);
      expect(lines, cell).toEqual([A, A, B, B]);
    }
  });

  it('offer the route answers, a repeat, and a title that says what they are', () => {
    const routeIds = FIELD_TEST_STEPS.find((s) => s.id === 'route-1')!.responses.map((r) => r.id);
    for (const p of probes) {
      expect(p.responses.map((r) => r.id), p.id).toEqual(routeIds);
      expect(p.sayAgain, p.id).toBe(true);
      expect(p.title, p.id).toMatch(/^A few more(, after the microphone| of the same) \([1-4] of 4\)$/);
    }
  });

  it('leak nothing forward: the setup after each site equals the setup before it', () => {
    for (const cell of SITES) {
      const ids = probes.filter((s) => s.probe === cell).map((s) => s.id);
      const first = idx(ids[0]!);
      const last = idx(ids[ids.length - 1]!);
      expect(resolveFieldTestSetup(last), cell).toEqual(resolveFieldTestSetup(first - 1));
      expect(resolveFieldTestSetup(last + 1), cell).toEqual(resolveFieldTestSetup(last));
    }
  });

  it('wait for the recogniser to be down where the block they extend does', () => {
    for (const p of probes) {
      const anchor = FIELD_TEST_STEPS.find((s) => s.id === anchorOf(p.probe!))!;
      expect(Boolean(p.awaitSilent), p.id).toBe(Boolean(anchor.awaitSilent));
    }
  });

  it('are kept out of the crossing, so the cells still hold three matched samples', () => {
    for (const ids of routeCells().values()) {
      for (const p of probes) expect(ids, p.id).not.toContain(p.id);
    }
  });
});

/**
 * THE DRILL PROTOCOL'S OWN INVARIANTS.
 *
 * It measures the product rather than the plumbing: whether a press answers
 * anything, and whether the words can be made out at speed. Neither had ever
 * been measured before 2026-09-30 -- the routing protocol replaces the real
 * wheel handler with a diagnostic probe on every wheel step, on purpose, so
 * a leg could come back green on the wheel while the drill was unanswerable.
 */
describe('the drill protocol', () => {
  const drill = FIELD_TEST_STEPS.filter((s) => s.protocol === 'drill');

  it('has steps at all, so nothing below is vacuous', () => {
    expect(drill.length).toBeGreaterThanOrEqual(8);
  });

  /**
   * THE FOLD HAZARD, pinned.
   *
   * `resolveFieldTestSetup` folds `setup` from index 0 through the current
   * step -- which is what makes the effective settings identical however the
   * operator arrived. The drill steps sit AFTER every routing step in the
   * array, so the fold reaching them has already applied the whole routing
   * list: whatever `route-after-mic-3t` left behind (clips off, at the time
   * of writing) is the state the first drill step inherits.
   *
   * So the first drill step has to declare every field it depends on, or a
   * drill leg silently runs under the tail of a protocol it never ran.
   */
  it('opens with a complete setup rather than inheriting the routing list', () => {
    const first = drill[0]!;
    const declared = Object.keys(first.setup ?? {});
    for (const field of [
      'audioEnabled',
      'useClips',
      'muted',
      'volume',
      'voice',
      'eyesFree',
      'wheelMode',
    ]) {
      expect(
        declared,
        `${first.id} inherits ${field} from the routing protocol's last step`,
      ).toContain(field);
    }
  });

  it('is entered through conditions that declare the drill protocol', () => {
    const legs = FIELD_TEST_CONDITIONS.filter((c) => c.protocol === 'drill');
    expect(legs.map((c) => c.id)).toEqual(['drill-parked', 'drill-freeway', 'drill-phone']);
    // A parked leg first, because a fault found parked costs five minutes and
    // the same fault found at speed costs a drive.
    expect(legs[0]?.motion).toBe('parked');
    // ...and the phone-speaker leg has no car, which is why it loses the
    // wheel. See the condition's own note.
    expect(legs.find((c) => c.id === 'drill-phone')?.bluetooth).toBe(false);
  });

  /**
   * THE MEASUREMENT RESTS ENTIRELY ON THIS.
   *
   * The four lines must be identical apart from the decision word. If one
   * were longer, or named a different dealer card, a wrong tap could be
   * explained by the sentence rather than by the word being unintelligible --
   * and the word is what the product turns on.
   */
  it('draws from lines that differ in exactly one word', () => {
    const templates = new Set(
      DISCRIMINATE_LINES.map((line) =>
        line.replace(/\b(hit|stand|double|split)\b/i, '<WORD>'),
      ),
    );
    expect(
      [...templates],
      'the lines differ in more than the decision word, so a wrong tap has another explanation',
    ).toHaveLength(1);
    expect(DISCRIMINATE_LINES.length).toBeGreaterThanOrEqual(3);
  });

  it('can name the word in every line it will draw, and score it', () => {
    for (const line of DISCRIMINATE_LINES) {
      const word = discriminateWordFor(line);
      expect(word, `no decision word could be read out of ${line}`).toBeTruthy();
      expect(discriminateAnswerFor(line)).toBe(`heard-${word}`);
    }
    // ...and every one of those answers is actually on the step's stack, or
    // the correct answer is unreachable and the step can only be failed.
    const step = drill.find((x) => x.discriminate !== undefined)!;
    const ids = step.responses.map((r) => r.id);
    for (const line of DISCRIMINATE_LINES) {
      expect(ids, 'the correct answer is not on the stack').toContain(
        discriminateAnswerFor(line),
      );
    }
  });

  it('never colours the word buttons so the screen gives the answer away', () => {
    for (const step of drill.filter((x) => x.discriminate !== undefined)) {
      const words = step.responses.filter((r) => r.id.startsWith('heard-') && r.id !== 'heard-nothing-at-all' && r.id !== 'heard-unintelligible');
      expect(words.length).toBeGreaterThan(0);
      const kinds = new Set(words.map((r) => r.kind));
      expect(
        [...kinds],
        'one word button looks different from the others, which hands over the answer',
      ).toEqual(['choice']);
    }
  });

  /**
   * An echo step must not ALSO arm the diagnostic probe. `wheel` is what arms
   * it, and a probed press returns before the real handler runs -- which
   * would leave the echo silent and the step measuring the routing protocol's
   * blind spot all over again.
   */
  it('keeps the diagnostic probe off every echo step', () => {
    for (const step of drill.filter((x) => x.echo !== undefined)) {
      expect(step.wheel, `${step.id} arms the probe, so its press cannot reach a handler`).toBeFalsy();
    }
  });

  it('asks the wheel echo steps for a car and the voice ones for a microphone', () => {
    for (const step of drill.filter((x) => x.echo === 'wheel')) {
      expect(step.needsBluetooth, `${step.id} would ask for a button with no car attached`).toBe(true);
    }
    const voiceEcho = drill.filter((x) => x.echo === 'voice');
    expect(voiceEcho.length).toBeGreaterThan(0);
    for (const step of voiceEcho) {
      expect(step.needsBluetooth, `${step.id} needs no car: it is measured through the phone`).toBeFalsy();
      expect(step.awaitListening, `${step.id} speaks before the recogniser is live`).toBe(true);
    }
  });

  it('offers "I never pressed" on every step that asks for a press', () => {
    for (const step of drill.filter((x) => x.echo === 'wheel')) {
      const ids = step.responses.map((r) => r.id);
      // Without it, a press never made and a press that vanished produce the
      // identical record -- and a whole diagnosis was built on that
      // ambiguity on 2026-09-29 and had to be withdrawn.
      expect(ids, `${step.id} cannot say the press was never made`).toContain(
        'wheel-not-pressed',
      );
    }
  });

  it('puts the sweep last, where its open microphone spoils nothing', () => {
    const sweep = drill.findIndex((x) => x.ambientSweep === true);
    expect(sweep, 'no sweep step').toBeGreaterThan(-1);
    const echoes = drill
      .map((x, i) => (x.echo !== undefined ? i : -1))
      .filter((i) => i > -1);
    for (const i of echoes) {
      expect(i, 'an echo step runs after the sweep has opened the microphone').toBeLessThan(sweep);
    }
  });
});
