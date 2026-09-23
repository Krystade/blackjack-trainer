/**
 * The field test: a protocol that speaks for itself.
 *
 * WHAT WAS WRONG WITH THE LAST ONE, in the operator's words after the
 * 2026-09-22 drive: "the field test just sucked ... I didn't even test any
 * buttons ... I don't know why you haven't made the field test its own thing
 * or why we have to go to a drill in the first place."
 *
 * All three were my doing and all three are fixed here:
 *
 *   1. IT NEEDED A DRILL. Every step said "start a drill and listen", because
 *      the protocol had no voice of its own. So following it meant running a
 *      drill and a test at once, and the log filled with flashcard grading
 *      that had nothing to do with what was being measured. Now each step
 *      declares what to SAY, and the screen says it through the real speech
 *      path -- same clips, same cascade, same media session, same everything
 *      a drill would use. Nothing else is running.
 *   2. THE WHEEL WAS REMOVED FROM THE DRIVING RUN. I cut it when the runs
 *      were split, reasoning that button routing is noise-independent so
 *      driving adds nothing. That was not what was asked and it was wrong in
 *      practice: whether the wheel reaches the app AT SPEED, with the car
 *      doing everything else a moving car does, is exactly the open question.
 *      Every condition now carries every wheel step.
 *   3. IT RECORDED ALMOST NOTHING. A stamp said which step the operator was
 *      on and nothing about what the app did. Now every step entry, every
 *      line spoken and which path spoke it, every wheel arrival, every route
 *      change and every answer is written as it happens.
 *
 * THE ROUTE QUESTION, which is the point of the rewrite.
 *
 * The operator's actual complaint is that output moves around underneath
 * them: "it's often switching between my Bluetooth speaker and my phone's
 * loudspeaker and my phone's phone-call speaker -- if it's on the phone call
 * speaker it's just not audible at all and completely worthless." iOS does
 * not expose the output route to a web page: there is no sinkId, and
 * enumerateDevices does not name the receiver. So the app cannot read it.
 *
 * What it CAN do is ask, per utterance, in one tap -- and pair the answer
 * with the path that spoke it, which the app does know. Three or four
 * consecutive samples of "where did that come from" against "clip or live
 * TTS" is enough to tell whether the routes are alternating at random or
 * tracking the path, and those are different bugs with different fixes.
 * That pairing is what this protocol exists to collect.
 */

import { diag } from './diagnosticLog';
import type { Settings } from '../store/types';

export type FieldTestMotion = 'parked' | 'driving';

export interface FieldTestCondition {
  id: string;
  label: string;
  motion: FieldTestMotion;
  setup: string;
  proves: string;
}

/**
 * The routes, as a person in the driver's seat can tell them apart.
 *
 * Not a technical taxonomy -- these are the four things the operator can
 * actually distinguish by ear without looking at anything, which is the only
 * kind of answer a protocol may ask for while driving. `earpiece` is called
 * out separately from `loudspeaker` because it is the failure: the receiver
 * at the top of the phone is inaudible in a moving car, so an utterance that
 * lands there is lost even though nothing errored.
 */
export const ROUTE_ANSWERS = [
  { id: 'route-car', label: 'Car speakers' },
  { id: 'route-loudspeaker', label: 'Phone, loud' },
  { id: 'route-earpiece', label: 'Phone earpiece (barely audible)' },
  { id: 'route-silent', label: 'Heard nothing' },
] as const;

export interface StepResponse {
  id: string;
  label: string;
  /** Colours the button and, more importantly, the reading of the log. */
  kind: 'route' | 'good' | 'bad' | 'note';
}

/** The state a step needs, as data the screen applies. */
export interface FieldTestSetup {
  audioEnabled?: boolean;
  useClips?: boolean;
  muted?: boolean;
  wheelMode?: 'answer' | 'talk';
  voice?: boolean;
  eyesFree?: boolean;
}

export interface FieldTestStep {
  id: string;
  title: string;
  instruction: string;
  /**
   * What the app says when this step opens, through the real speech path.
   *
   * This is what makes the protocol self-contained. It is also the payload of
   * the measurement: the route and the voice are properties OF an utterance,
   * so a step that asks about either has to produce one.
   *
   * EVERY LINE HERE ALREADY HAS A RECORDED CLIP, and that is not a detail.
   * The first draft of this rewrite used lines I invented, none of which were
   * in the phrase manifest -- so every one of them would have fallen back to
   * the phone's own voice, and a protocol asking "was that the recorded
   * voice?" would have been asking about an utterance that could only ever
   * have been live TTS. fieldTest.test.ts pins every line against
   * scripts/spoken-phrases.json so that cannot happen again.
   */
  say?: readonly string[];
  /**
   * A line deliberately chosen to have NO clip, spoken straight after `say`.
   *
   * The one exception to the rule above, and it exists to calibrate the ear.
   * The operator's report is that "the voice that's being used switches often
   * between the recorded and the other option" -- which can only be acted on
   * if they can reliably tell the two apart. So one step plays a clipped line
   * and an unclipped one back to back, on purpose, and says which is which.
   */
  sayUnclipped?: string;
  /** Repeat `say` on demand -- a line missed in traffic is a step wasted. */
  sayAgain?: boolean;
  /** Arm wheel capture and show, live, whatever the car sends. */
  wheel?: boolean;
  /** Measure the cabin with the microphone for a few seconds. */
  ambient?: boolean;
  responses: readonly StepResponse[];
  setup?: FieldTestSetup;
}

const ROUTE_RESPONSES: readonly StepResponse[] = ROUTE_ANSWERS.map((r) => ({
  ...r,
  kind: 'route' as const,
}));

const WHEEL_RESPONSES: readonly StepResponse[] = [
  { id: 'wheel-app-responded', label: 'The app reacted', kind: 'good' },
  { id: 'wheel-radio', label: 'The radio changed track instead', kind: 'bad' },
  { id: 'wheel-nothing', label: 'Nothing happened at all', kind: 'bad' },
];

const FREE_RESPONSES: readonly StepResponse[] = [
  { id: 'good', label: 'That worked', kind: 'good' },
  { id: 'bad', label: 'That was wrong', kind: 'bad' },
];

export const FIELD_TEST_CONDITIONS: readonly FieldTestCondition[] = [
  {
    id: 'car',
    label: 'Car, parked',
    motion: 'parked',
    setup: 'Paired to the car over Bluetooth, engine running, handbrake on.',
    proves:
      'The baseline for everything else. Same audio route as a drive, without the road — so anything that fails here fails for reasons that have nothing to do with speed.',
  },
  {
    id: 'freeway',
    label: 'Freeway',
    motion: 'driving',
    setup: 'Paired exactly as above, at your normal road speed, windows up.',
    proves:
      'The real thing, including the wheel. Whether the buttons reach the app at speed is the open question this protocol exists for, and it cannot be answered stationary.',
  },
  {
    id: 'speakerphone',
    label: 'Speakerphone',
    motion: 'driving',
    setup: 'Phone in the cradle on its own speaker, Bluetooth OFF, at road speed.',
    proves:
      'The control. Same road, same distance, no Bluetooth — so anything that fails here too is the app or the road, not the car.',
  },
  {
    id: 'phone',
    label: 'Phone, quiet',
    motion: 'parked',
    setup: 'Phone in your hand, engine off, windows up.',
    proves: 'If a step fails here it has nothing to do with driving at all.',
  },
];

export const DEFAULT_FIELD_TEST_CONDITION = FIELD_TEST_CONDITIONS[0]!.id;

/**
 * The steps.
 *
 * EVERY condition runs EVERY step. The previous version filtered them by
 * motion and that is precisely what left the operator on a freeway with no
 * buttons to test. A step that is awkward at speed is a step to skip in the
 * moment -- Next is always available -- not one to remove from the protocol
 * on their behalf.
 *
 * Ordered so the route questions come first and cheap: three consecutive
 * utterances, each asking only "where did that come from". That sequence is
 * the one that catches alternation, and it needs no wheel, no microphone and
 * no judgement.
 */
export const FIELD_TEST_STEPS: readonly FieldTestStep[] = [
  {
    id: 'route-1',
    title: 'Where does it come out? (1 of 3)',
    instruction: 'Listen to the line, then say where you heard it from.',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: true, muted: false, voice: false, eyesFree: true },
  },
  {
    id: 'route-2',
    title: 'Where does it come out? (2 of 3)',
    instruction:
      'A second line, straight after the first. Same question \u2014 and if this one came from somewhere else, that is the bug.',
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'route-3',
    title: 'Where does it come out? (3 of 3)',
    instruction: 'Third and last. Three in a row is enough to tell a pattern from a one-off.',
    say: ['Basic double versus dealer five.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'route-short',
    title: 'A short line',
    instruction:
      'One word rather than a sentence. A short utterance is over before a route has settled, so it can land somewhere the long ones do not.',
    say: ['Correct?'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'route-long',
    title: 'A long line',
    instruction:
      'The opposite end: long enough for the car to change its mind halfway through. If it started in one place and finished in another, say where it ENDED.',
    say: [
      'Twelve versus six: hit at true count minus three or lower, when the dealer hits soft seventeen.',
    ],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * THE CALIBRATION STEP, and the only one that speaks an unclipped line on
     * purpose. Everything the operator has reported about the voice depends on
     * being able to tell the recorded voice from the phone's, so this plays
     * one of each, back to back, and says which is which.
     */
    id: 'voice-compare',
    title: 'What the fallback sounds like',
    instruction:
      'Two lines. The first is the recorded voice; the second is deliberately the phone\u2019s own. Listen to the difference \u2014 that is what you are listening for everywhere else.',
    say: ['Correct play was double.'],
    sayUnclipped:
      'This second line has no recording behind it, so your phone is reading it aloud instead.',
    sayAgain: true,
    responses: [
      { id: 'voice-told-apart', label: 'I can hear the difference', kind: 'good' },
      { id: 'voice-alike', label: 'They sounded the same', kind: 'bad' },
      { id: 'voice-second-missing', label: 'The second one never played', kind: 'bad' },
    ],
  },
  {
    id: 'voice-which',
    title: 'Which voice was that?',
    instruction:
      'One line, and it should be the recorded voice. If it is the phone\u2019s, the clip did not play \u2014 and live speech cannot be amplified at all, so under road noise it simply vanishes.',
    say: ['Basic split versus dealer four.'],
    sayAgain: true,
    responses: [
      { id: 'voice-recorded', label: 'The recorded voice', kind: 'good' },
      { id: 'voice-phone', label: 'The phone\u2019s own voice', kind: 'bad' },
      ...ROUTE_RESPONSES,
    ],
  },
  {
    id: 'wheel-talking',
    title: 'The wheel, while it is talking',
    instruction:
      'A long line is playing. Press skip-forward on the wheel WHILE it talks. Whatever the car sends appears below.',
    say: [
      'Eleven versus ace: double at true count plus one or higher, when the dealer stands soft seventeen.',
    ],
    sayAgain: true,
    wheel: true,
    responses: WHEEL_RESPONSES,
    setup: { audioEnabled: true, useClips: true, wheelMode: 'answer', voice: false, eyesFree: true },
  },
  {
    id: 'wheel-gap',
    title: 'The wheel, in the silence',
    instruction:
      'Now wait until it has gone properly quiet \u2014 several seconds \u2014 and press skip-forward again. This is the one that matters: a press that works during speech and fails in the gap is the exact 2026-09-19 fault.',
    wheel: true,
    responses: WHEEL_RESPONSES,
  },
  {
    id: 'wheel-back',
    title: 'Skip-back',
    instruction: 'Press skip-BACK on the wheel once, in the silence.',
    wheel: true,
    responses: WHEEL_RESPONSES,
  },
  {
    id: 'wheel-other',
    title: 'Any other button',
    instruction:
      'Press anything else you can reach on the wheel \u2014 volume, the voice button, whatever. This is here to find out what the car will even send.',
    wheel: true,
    responses: [
      ...WHEEL_RESPONSES,
      { id: 'wheel-other-noted', label: 'Pressed something else', kind: 'note' },
    ],
  },
  {
    /**
     * One press arriving and a second not is a different fault from neither
     * arriving -- the first is the media slot lapsing after it is used, the
     * second is the car never sending to this app at all. They have been
     * indistinguishable in every log so far because nobody was asked to press
     * twice.
     */
    id: 'wheel-repeat',
    title: 'Press it twice',
    instruction: 'Two presses, a couple of seconds apart.',
    wheel: true,
    responses: [
      { id: 'wheel-both', label: 'Both arrived', kind: 'good' },
      { id: 'wheel-first-only', label: 'Only the first', kind: 'bad' },
      { id: 'wheel-neither', label: 'Neither', kind: 'bad' },
    ],
  },
  {
    id: 'mic-route',
    title: 'With the microphone open',
    instruction:
      'The microphone is now on. Listen to the line and say where it came from \u2014 this is where output is expected to move to the earpiece.',
    say: ['Basic stand versus dealer ten.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: true, voice: true, eyesFree: true },
  },
  {
    id: 'mic-heard',
    title: 'Say an answer',
    instruction: 'Wait for it to finish, then say one answer out loud. What it heard appears below.',
    say: ['Did you have it?'],
    sayAgain: true,
    responses: [
      { id: 'heard-right', label: 'It got it right', kind: 'good' },
      { id: 'heard-wrong', label: 'It heard the wrong thing', kind: 'bad' },
      { id: 'heard-nothing', label: 'It never heard me', kind: 'bad' },
    ],
  },
  {
    id: 'wheel-with-mic',
    title: 'The wheel, with the microphone open',
    instruction:
      'Microphone still on: press skip-forward again. This is expected to FAIL \u2014 the car takes the wheel for its call profile \u2014 and the point is to prove it, not to work.',
    wheel: true,
    responses: WHEEL_RESPONSES,
  },
  {
    /**
     * After the microphone shuts, and the question nothing has ever asked:
     * the microphone is the one event known to move the output route, so
     * whether closing it puts the route BACK is the difference between a
     * transient and a state the app never recovers from.
     */
    id: 'route-after-mic',
    title: 'Where does it come out now?',
    instruction:
      'The microphone is shut again. Same question as the very first step \u2014 if the answer has changed, the microphone moved it and never moved it back.',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: true, voice: false, eyesFree: true },
  },
  {
    id: 'ambient',
    title: 'How loud is it in here',
    instruction: 'Stay quiet for five seconds. This measures the cabin, not you.',
    ambient: true,
    responses: [{ id: 'ambient-noted', label: 'Done', kind: 'note' }],
    setup: { voice: false },
  },
  {
    id: 'free',
    title: 'Anything else',
    instruction:
      'Anything that worked or went wrong that no step above names. Stamp it the moment it happens \u2014 the log can find it afterwards, you cannot.',
    responses: FREE_RESPONSES,
  },
];

/** Apply a step's required settings, returning the settings to save. */
export function applyFieldTestSetup(settings: Settings, setup?: FieldTestSetup): Settings {
  if (!setup) return settings;
  return {
    ...settings,
    drill: {
      ...settings.drill,
      ...(setup.wheelMode !== undefined ? { wheelMode: setup.wheelMode } : {}),
    },
    audio: {
      ...settings.audio,
      ...(setup.audioEnabled !== undefined ? { enabled: setup.audioEnabled } : {}),
      ...(setup.useClips !== undefined ? { useClips: setup.useClips } : {}),
      ...(setup.muted !== undefined ? { muted: setup.muted } : {}),
    },
  };
}

/** One line saying what the app just changed on the operator's behalf. */
export function describeFieldTestSetup(setup?: FieldTestSetup): string {
  if (!setup) return 'Nothing changed for this step.';
  const bits: string[] = [];
  if (setup.audioEnabled !== undefined) bits.push(`audio ${setup.audioEnabled ? 'on' : 'off'}`);
  if (setup.useClips !== undefined) bits.push(`recorded voice ${setup.useClips ? 'on' : 'off'}`);
  if (setup.muted !== undefined) bits.push(setup.muted ? 'muted' : 'unmuted');
  if (setup.wheelMode !== undefined) bits.push(`wheel in ${setup.wheelMode} mode`);
    // Shouted, because this is the one that changes what the car does with
  // the wheel and where the sound comes out, and the operator is reading
  // it at a glance at a red light.
  if (setup.voice !== undefined) bits.push(`microphone ${setup.voice ? 'ON' : 'OFF'}`);
  if (setup.eyesFree !== undefined) bits.push(`eyes-free ${setup.eyesFree ? 'on' : 'off'}`);
  return bits.length > 0 ? `Set for you: ${bits.join(', ')}.` : 'Nothing changed for this step.';
}

/** Record an answer, with the step and route that produced it. */
export function stampFieldTest(
  stepId: string,
  conditionId: string,
  responseId: string,
  extra?: Record<string, unknown>,
): void {
  diag('test', stepId, { condition: conditionId, answer: responseId, ...extra });
}

/** Record entering a step, so the log brackets what follows. */
export function logFieldTestStep(stepId: string, conditionId: string, index: number): void {
  diag('test', 'step-open', { step: stepId, condition: conditionId, index });
}

/** Record the run's own boundaries, which the previous protocol never did. */
export function logFieldTestRunStart(conditionId: string): void {
  diag('test', 'run-start', { condition: conditionId, steps: FIELD_TEST_STEPS.length });
}

export function logFieldTestRunEnd(conditionId: string, stamped: number): void {
  diag('test', 'run-end', { condition: conditionId, stamped });
}

export function motionForCondition(conditionId: string): FieldTestMotion {
  return FIELD_TEST_CONDITIONS.find((c) => c.id === conditionId)?.motion ?? 'parked';
}
