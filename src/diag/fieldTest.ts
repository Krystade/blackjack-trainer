import { diag } from './diagnosticLog';

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

export interface FieldTestStep {
  id: string;
  /** What to do. */
  instruction: string;
  /** The button that stamps the log when you have done it. */
  stamp: string;
  /** What the log should contain afterwards if this worked. */
  expect: string;
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
    instruction: 'Start any drill with Eyes-free audio on, and listen for the first question.',
    stamp: 'I heard it speak',
    expect: 'speak lines, on the route you picked.',
  },
  {
    id: 'no-audio-out',
    instruction: 'If nothing was said, stamp this instead and stop — nothing below can work.',
    stamp: 'It never spoke',
    expect: 'speak lines with no sound: the route took them, not the app.',
  },
  {
    id: 'press-forward',
    instruction: 'With the microphone OFF, press skip-forward on the wheel once.',
    stamp: 'I pressed skip-forward',
    expect: 'a nexttrack or seekforward invoke within a second of this stamp.',
  },
  {
    id: 'press-back',
    instruction: 'Press skip-back on the wheel once.',
    stamp: 'I pressed skip-back',
    expect: 'a previoustrack or seekbackward invoke within a second of this stamp.',
  },
  {
    id: 'wheel-dead',
    instruction: 'If a press did nothing at all, stamp this right after pressing it.',
    stamp: 'The wheel did nothing',
    expect: 'no invoke near this stamp: the car never sent it, so the mapping is not the problem.',
  },
  {
    id: 'spoke',
    instruction: 'Turn Voice answers on, wait for the question to finish, and say one answer.',
    stamp: 'I said an answer',
    expect: 'a heard line within a second or two. No line at all means the microphone never got it.',
  },
  {
    id: 'spoke-over',
    instruction: 'Now say an answer WHILE it is still talking, on purpose.',
    stamp: 'I talked over it',
    expect: 'a heard line marked suppressed, and a chime — silence here is the bug.',
  },
  {
    id: 'wheel-after-mic',
    instruction: 'Leaving voice on, press skip-forward on the wheel again.',
    stamp: 'I pressed the wheel with the mic open',
    expect:
      'nothing. The car routes the wheel to its own call once the microphone opens; this step is here to prove that, not to work.',
  },
  {
    id: 'good',
    instruction: 'Anything that worked exactly as it should.',
    stamp: 'That one worked',
    expect: 'a marker to read the rest of the run against.',
  },
  {
    id: 'bad',
    instruction: 'Anything that did not, when no step above names it.',
    stamp: 'That was wrong',
    expect: 'a marker at the moment it went wrong, which is the hardest thing to find afterwards.',
  },
] as const;

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
