import { diag } from './diagnosticLog';
import type { Settings } from '../store/types';

/**
 * The field-test protocol: what to do, in what order, and a way to say so.
 *
 * WHY. Every other diagnostic in this app records what the APP saw. None of
 * them record what the operator was trying to do, and without that half the
 * log cannot be read. A log with no `nexttrack` line in it is either a car
 * that never sent one or a button that was never pressed -- opposite
 * diagnoses, identical evidence. Asked for on 2026-09-16: "I think I need a
 * set of instructions in the app to properly follow so you know what the
 * intent is vs what shows up in the log."
 *
 * IT SETS ITSELF UP, and that is not a convenience. The first run of this
 * protocol (2026-09-19) got four steps in and stopped: "the field test feels
 * so unfinished and poorly designed. I need it to set the settings and maybe
 * have a pop up that follows me into the testing. Can't have to go back and
 * forth and have it reset all progress." All three complaints are the same
 * defect wearing three faces -- a protocol that states preconditions in prose
 * makes the operator satisfy them by hand, from a different screen, while
 * parked in a car, and every trip back to Settings threw the run away. A step
 * that names a precondition it could simply establish is a step that will be
 * run under the wrong one. So each step below carries the settings it needs
 * as DATA (`setup`), the panel applies them when the step is opened, and the
 * run itself lives in diag/fieldTestRun.ts where navigation cannot touch it.
 *
 * PARKED, DELIBERATELY. Stamping an intent means tapping a screen, which is
 * the one thing this app exists to avoid while moving. So the protocol is a
 * stationary shakedown -- engine running, phone connected exactly as it would
 * be on a drive -- and the drive itself is left to the automatic log. Saying
 * that plainly is part of the protocol: a step that cannot be followed safely
 * will be followed badly, and a badly-followed step poisons the evidence it
 * was meant to produce.
 *
 * THREE CONDITIONS, because the interesting failures are all about the audio
 * route. The car's hands-free profile is what takes the wheel away when the
 * microphone opens; speakerphone is the control that has the same acoustics
 * and none of the Bluetooth; the bare phone is the baseline where nothing can
 * be blamed on a route at all. Running the same steps in each is what turns
 * "it didn't work" into "it didn't work on THIS route".
 */

export interface FieldTestCondition {
  id: string;
  label: string;
  /** How to physically set the phone and car up before the steps. */
  setup: string;
  /** What this condition is here to rule in or out. */
  proves: string;
}

export const FIELD_TEST_CONDITIONS: readonly FieldTestCondition[] = [
  {
    id: 'car',
    label: 'Car stereo',
    setup: 'Phone paired to the car over Bluetooth, app audio coming out of the car speakers, engine running.',
    proves:
      'The real thing. The wheel can only reach the app on this route, and only while the microphone is shut.',
  },
  {
    id: 'speakerphone',
    label: 'Speakerphone',
    setup: 'Phone in the cradle on its own loudspeaker, Bluetooth OFF, engine running.',
    proves:
      'The control. Same road noise, same distance, no Bluetooth — so anything that fails here is the app or the room, not the car.',
  },
  {
    id: 'phone',
    label: 'Phone, quiet',
    setup: 'Phone in your hand, engine off, windows up.',
    proves: 'The baseline. If a step fails here it has nothing to do with driving at all.',
  },
] as const;

/**
 * The state a step needs the app to be in, as data the panel can apply.
 *
 * Every field here is something the operator would otherwise have had to set
 * by hand from another screen. `voice` and `eyesFree` are the odd two out and
 * deliberately so: neither is a persisted setting, both are page-scoped
 * toggles (ui/voiceSession.ts, ui/eyesFreeSession.ts), because the app's
 * standing promise is that a microphone is only ever opened by an explicit
 * per-session choice and eyes-free follows the same rule. The protocol makes
 * those choices on the operator's behalf WITHIN the run, which is still
 * explicit -- they started the run -- and still forgotten on reload.
 */
export interface FieldTestSetup {
  audioEnabled?: boolean;
  useClips?: boolean;
  muted?: boolean;
  wheelMode?: 'answer' | 'talk';
  /** Microphone on or off for this step. Undefined means "leave it". */
  voice?: boolean;
  /**
   * Eyes-free audio on or off. Page-scoped like `voice`
   * (ui/eyesFreeSession.ts), and the single most important thing a step can
   * set: without it a drill never speaks at all, so step one would be a
   * silent step one and every step below it would be measuring nothing.
   */
  eyesFree?: boolean;
}

export interface FieldTestStep {
  id: string;
  /** What to do. */
  instruction: string;
  /** The button that stamps the log when you have done it. */
  stamp: string;
  /** What the log should contain afterwards if this worked. */
  expect: string;
  /** What the app puts itself into before you start this step. */
  setup?: FieldTestSetup;
  /**
   * Where to be. The HUD follows you, so this is a nudge rather than a gate
   * -- some steps are only meaningful with a drill actually running.
   */
  where?: 'drill' | 'anywhere';
}

/**
 * The steps, in order.
 *
 * Ordered so each one only depends on what is already known to work: audio
 * before the wheel (a wheel press is pointless if nothing is playing), the
 * wheel before the microphone (opening the microphone is what takes the wheel
 * away), and the microphone last.
 */
export const FIELD_TEST_STEPS: readonly FieldTestStep[] = [
  {
    id: 'audio-out',
    instruction:
      'Audio and the recorded voice are now on. Start any drill and listen for the first question.',
    stamp: 'I heard it speak',
    expect: 'speak lines, on the route you picked.',
    setup: { audioEnabled: true, useClips: true, muted: false, voice: false, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'no-audio-out',
    instruction: 'If nothing was said, stamp this instead and stop — nothing below can work.',
    stamp: 'It never spoke',
    expect: 'speak lines with no sound: the route took them, not the app.',
    where: 'anywhere',
  },
  {
    id: 'press-forward',
    instruction:
      'The microphone is off and the wheel is in answer mode. Press skip-forward on the wheel once, while it is still talking.',
    stamp: 'I pressed skip-forward',
    expect: 'a nexttrack or seekforward invoke within a second of this stamp.',
    setup: { audioEnabled: true, useClips: true, wheelMode: 'answer', voice: false, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'press-back',
    instruction: 'Still talking: press skip-back on the wheel once.',
    stamp: 'I pressed skip-back',
    expect: 'a previoustrack or seekbackward invoke within a second of this stamp.',
    setup: { audioEnabled: true, useClips: true, wheelMode: 'answer', voice: false, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'wheel-gap',
    instruction:
      'Now wait until it has finished speaking and gone properly quiet — several seconds — then press skip-forward.',
    stamp: 'I pressed it in the silence',
    expect:
      'an invoke, the same as during speech. This is the 2026-09-19 bug: the app used to stop being the “now playing” app the moment a clip ended, so a press in a gap went to the radio instead. A press during speech that works and a press in silence that does not is that exact fault, still there.',
    setup: { audioEnabled: true, useClips: true, wheelMode: 'answer', voice: false, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'wheel-dead',
    instruction: 'If a press did nothing at all, stamp this right after pressing it.',
    stamp: 'The wheel did nothing',
    expect: 'no invoke near this stamp: the car never sent it, so the mapping is not the problem.',
    where: 'anywhere',
  },
  {
    id: 'spoke',
    instruction: 'The microphone is now on. Wait for the question to finish, then say one answer.',
    stamp: 'I said an answer',
    expect: 'a heard line within a second or two. No line at all means the microphone never got it.',
    setup: { audioEnabled: true, voice: true, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'spoke-over',
    instruction: 'Now say an answer WHILE it is still talking, on purpose.',
    stamp: 'I talked over it',
    expect: 'a heard line marked suppressed, and a chime — silence here is the bug.',
    setup: { audioEnabled: true, voice: true, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'wheel-after-mic',
    instruction: 'Leaving the microphone on, press skip-forward on the wheel again.',
    stamp: 'I pressed the wheel with the mic open',
    expect:
      'nothing. The car routes the wheel to its own call once the microphone opens; this step is here to prove that, not to work.',
    setup: { audioEnabled: true, voice: true, eyesFree: true },
    where: 'drill',
  },
  {
    id: 'good',
    instruction: 'Anything that worked exactly as it should.',
    stamp: 'That one worked',
    expect: 'a marker to read the rest of the run against.',
    where: 'anywhere',
  },
  {
    id: 'bad',
    instruction: 'Anything that did not, when no step above names it.',
    stamp: 'That was wrong',
    expect: 'a marker at the moment it went wrong, which is the hardest thing to find afterwards.',
    where: 'anywhere',
  },
] as const;

/**
 * Apply a step's required settings, returning the settings to save.
 *
 * Pure, and returns a NEW object even when nothing changed, so the caller has
 * one code path. `voice` is absent here on purpose -- it is not a persisted
 * setting, and the caller drives ui/voiceSession.ts for it.
 */
export function applyFieldTestSetup(settings: Settings, setup?: FieldTestSetup): Settings {
  if (!setup) return settings;
  return {
    ...settings,
    drill: {
      ...settings.drill,
      ...(setup.wheelMode === undefined ? {} : { wheelMode: setup.wheelMode }),
    },
    audio: {
      ...settings.audio,
      ...(setup.audioEnabled === undefined ? {} : { enabled: setup.audioEnabled }),
      ...(setup.useClips === undefined ? {} : { useClips: setup.useClips }),
      ...(setup.muted === undefined ? {} : { muted: setup.muted }),
    },
  };
}

/**
 * What a step's setup did, in words, so the screen can say it out loud.
 *
 * The operator has to be able to tell the difference between "the app set
 * this for me" and "the app assumed this was already set" -- otherwise a run
 * done under the wrong settings looks identical to one done under the right
 * ones, which is the failure mode the whole protocol exists to close.
 */
export function describeFieldTestSetup(setup?: FieldTestSetup): string {
  if (!setup) return 'Nothing changed — stamp this whenever it applies.';
  const parts: string[] = [];
  if (setup.audioEnabled) parts.push('audio on');
  if (setup.useClips) parts.push('recorded voice on');
  if (setup.eyesFree === true) parts.push('eyes-free audio on');
  if (setup.eyesFree === false) parts.push('eyes-free audio off');
  if (setup.muted === false) parts.push('unmuted');
  if (setup.wheelMode) parts.push(`wheel in ${setup.wheelMode} mode`);
  if (setup.voice === true) parts.push('microphone ON');
  if (setup.voice === false) parts.push('microphone OFF');
  return parts.length === 0 ? 'Nothing changed.' : `Set for you: ${parts.join(', ')}.`;
}

/**
 * Write the operator's intent into the log.
 *
 * `condition` rides on every stamp rather than being written once at the top:
 * a run gets abandoned and restarted, the log survives reloads, and a
 * condition recorded once is a condition that will be read against the wrong
 * half of the file.
 */
export function stampFieldTest(stepId: string, conditionId: string): void {
  diag('test', stepId, { condition: conditionId });
}

/** The condition that should be selected when the panel is first opened. */
export const DEFAULT_FIELD_TEST_CONDITION = FIELD_TEST_CONDITIONS[0].id;
