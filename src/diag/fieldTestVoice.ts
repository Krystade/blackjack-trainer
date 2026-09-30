/**
 * Saying the answer instead of finding the button.
 *
 * THE PROBLEM THIS SOLVES, and the one it does not.
 *
 * Every answer in the protocol costs a glance: a stack of up to six 52px
 * targets, read and hit while driving. That is why `WHEEL_SLOTS` pins
 * positions, why `ANSWER_GUARD_MS` exists, and why a mis-tap files the
 * opposite reading of the fault under test. None of that goes away by making
 * the buttons nicer -- the operator has to look.
 *
 * What it does NOT solve: the app still cannot hear which speaker the sound
 * came out of. The buttons exist because iOS does not expose the output
 * route to a web page, and speaking the answer does not change that. The
 * operator is still the instrument; this is only a second way to read them.
 *
 * THE LIMIT, stated plainly because the protocol is an experiment: opening
 * the microphone flips the phone to the car's hands-free profile, which is
 * the very thing several steps are measuring. So this channel never opens
 * one. It listens only on the steps that already declare `setup.voice` and
 * whose transcript is not itself the evidence -- seven of the thirty-two on
 * a Bluetooth path -- where the microphone is open regardless and a
 * spoken answer costs the experiment nothing. The first version opened one
 * everywhere while the switch was on, which sampled the "before the
 * microphone" block with the microphone live and voided the leg without a
 * row saying so; `FieldTest.tsx` records why that is no longer possible.
 *
 * WHY A WHOLE-PHRASE MATCHER RATHER THAN THE COMMAND VOCABULARY. The drill
 * commands (`VOICE_ACTIONS`) are a fixed global set -- hit, stand, double.
 * These answers are per step, they overlap between steps ("quiet" means
 * something different on a wheel step and a fallback step), and several are
 * phrases rather than words. So the offered set IS the vocabulary, resolved
 * against whatever the step is actually showing, and a word that is
 * unambiguous on one step is free to mean something else on another.
 */

import type { StepResponse, StepSlot } from './fieldTest';

/**
 * What the operator can say for each answer.
 *
 * Rules these were written under, each one paid for by the tap version:
 *
 *  - SHORT FIRST. The first entry is what the screen prints as the hint, and
 *    at road speed a hint nobody can say in one breath is not a hint.
 *  - NO ID IS AN ALIAS OF ITSELF BY ACCIDENT. Every phrase here is deliberate
 *    and lowercase; matching normalises the transcript the same way.
 *  - COLLISIONS ARE ALLOWED ACROSS STEPS AND FORBIDDEN WITHIN ONE. "quiet" is
 *    `wheel-car-quiet` on a wheel step and `fallback-quiet` on a fallback
 *    step, and those two can never be offered together. `fieldTestVoice.test`
 *    walks every step of every condition and fails if that is ever untrue,
 *    which is the only reason this table can be this loose.
 */
export const ANSWER_PHRASES: Readonly<Record<string, readonly string[]>> = {
  // ---- where did the sound come from
  'route-car': ['car', 'the car', 'car speakers', 'bluetooth', 'stereo'],
  'route-loudspeaker': ['loudspeaker', 'loud', 'phone loud', 'bottom', 'speakerphone'],
  'route-earpiece': ['earpiece', 'ear piece', 'top', 'call speaker', 'receiver'],
  'route-silent': ['silent', 'silence', 'heard nothing', 'no sound'],
  'route-moved': ['moved', 'it moved', 'switched', 'moved while playing'],

  // ---- the wheel
  'wheel-car-quiet': ['car did nothing', 'nothing else', 'car quiet'],
  'wheel-radio': ['radio', 'changed track', 'track'],
  'wheel-radio-took-one': ['took one', 'radio took one'],
  'wheel-other-noted': ['pressed something else', 'something else', 'other button'],
  'wheel-repeat-done': ['pressed twice', 'twice', 'done'],
  'wheel-repeat-couldnt': ['could not', 'couldnt', 'cannot press twice'],
  'wheel-na': ['not applicable', 'no bluetooth', 'n a'],

  // ---- the clip-to-live-speech fallback
  'fallback-clear': ['heard both', 'both fine', 'both clear', 'clear'],
  'fallback-quiet': ['quieter', 'much quieter', 'quiet'],
  'fallback-lost': ['lost', 'lost in the noise', 'drowned out'],
  'fallback-moved': ['somewhere else', 'different place', 'came from elsewhere'],

  // ---- did the microphone hear you
  'heard-right': ['got it right', 'right', 'correct'],
  'heard-self': ['heard the app', 'heard itself', 'itself'],
  'heard-wrong': ['wrong thing', 'wrong', 'misheard'],
  'heard-nothing': ['never heard me', 'never heard', 'did not hear me'],
  'heard-not-said': ['never said it', 'did not say it', 'no word out'],

  // ---- the cabin
  'ambient-noted': ['it was quiet', 'cabin quiet', 'nothing to note'],
  'ambient-dirty': ['noise', 'noisy', 'something made noise'],

  // ---- the echo steps: what came back, which is the half the log cannot see
  'echo-right': ['what i meant', 'that was it', 'right'],
  'echo-wrong': ['the other one', 'wrong one', 'wrong word'],
  'echo-silent': ['nothing came back', 'nothing back', 'no answer'],
  'echo-not-said': ['never got it out', 'did not say it'],
  // Distinct from `missed`, and that distinction is the whole point of the
  // button: "I could not tell what happened" and "there was nothing to tell
  // because I never pressed" are opposite readings of an empty log.
  'wheel-not-pressed': ['never pressed', 'did not press', 'no press'],

  // ---- which word was that. The mic is OFF on these steps (`voice: false`),
  // so these exist for the vocabulary's completeness rule rather than to be
  // spoken: answering by voice would inject the input channel's errors into
  // the one measurement that is about the OUTPUT channel.
  'heard-hit': ['hit'],
  'heard-stand': ['stand'],
  'heard-double': ['double'],
  'heard-split': ['split'],
  'heard-unintelligible': ['could not make it out', 'garbled', 'muffled'],
  'heard-nothing-at-all': ['nothing at all', 'heard nothing'],

  // ---- the automatic sweep
  'sweep-done': ['finished', 'it finished'],
  'sweep-interrupted': ['interrupted', 'had to stop it'],

  // ---- the free step, and the escape hatch that is on every step
  good: ['that worked', 'worked', 'good', 'yes'],
  bad: ['that was wrong', 'was wrong', 'bad', 'no'],
  'nothing-to-report': ['nothing to report', 'all fine'],
  'lock-probe-done': ['unlocked', 'back', 'i am back'],
  // Not "skip": on `wheel-with-mic` the instruction asks for the skip-forward
  // button with the microphone open, and "I pressed skip, nothing happened"
  // is not `missed`.
  missed: ['missed', 'missed it', 'could not tell'],
};

/** Lowercase, strip everything that is not a letter, digit or space. */
export function normaliseHeard(heard: string): string {
  return heard
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whether `phrase` appears in `text` on whole-word boundaries. */
function contains(text: string, phrase: string): boolean {
  const padded = ` ${text} `;
  return padded.includes(` ${phrase} `);
}

export interface AnswerMatch {
  /** The response to stamp. */
  id: string;
  /** The phrase that matched, for the log. */
  phrase: string;
}

/**
 * Resolve a transcript against the answers THIS step is showing.
 *
 * Returns null for no match and, deliberately, also for an ambiguous one:
 * two different answers matching equally well is the case where stamping
 * either is a coin flip, and a wrong stamp here reads in the analysis as the
 * opposite reading of the fault under test. A refusal costs the operator a
 * second attempt; a wrong stamp costs the run's conclusion.
 *
 * Longest match wins, so "nothing to report" is not beaten by "nothing" on a
 * step that offers both, and only a TIE at the longest length is ambiguous.
 */
export function matchFieldTestAnswer(
  heard: string,
  offered: readonly StepSlot[],
): AnswerMatch | null {
  const text = normaliseHeard(heard);
  if (!text) return null;

  let best: AnswerMatch | null = null;
  let bestLen = 0;
  let tied = false;

  for (const slot of offered) {
    if (!slot) continue;
    for (const phrase of ANSWER_PHRASES[slot.id] ?? []) {
      if (!contains(text, phrase)) continue;
      if (phrase.length > bestLen) {
        best = { id: slot.id, phrase };
        bestLen = phrase.length;
        tied = false;
      } else if (phrase.length === bestLen && best !== null && best.id !== slot.id) {
        tied = true;
      }
    }
  }

  return tied ? null : best;
}

/**
 * The hint printed under an answer: the shortest thing that selects it.
 *
 * The first phrase, not the label, because the label is what the answer MEANS
 * and the hint is what to SAY -- "The car did nothing else" is neither
 * sayable at speed nor what the matcher is listening for.
 */
export function spokenHintFor(response: StepResponse): string | null {
  return ANSWER_PHRASES[response.id]?.[0] ?? null;
}
