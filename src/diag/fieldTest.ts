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
  /**
   * Whether the car is in the audio path at all.
   *
   * `speakerphone` runs with Bluetooth OFF, so its six wheel steps have no car
   * to answer for: every one of them can only be `wheel-na`, and the operator
   * met six steps asking them to press a button connected to nothing.
   * Declared here rather than inferred from the id, so the step list can order
   * those steps' answers for the condition actually being run.
   */
  bluetooth: boolean;
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
  /**
   * NAMED BY WHERE IT COMES FROM, not by how it sounded. "(barely audible)"
   * was a judgement baked into the button, and under `phone` — the device
   * in your hand, engine off — the earpiece is perfectly audible, so the
   * honest observation had no honest button and the operator was pushed
   * towards "Phone, loud". Loudness is a separate question; this one is
   * about the route.
   */
  { id: 'route-earpiece', label: 'Phone earpiece (at the top)' },
  /**
   * The route moving DURING one utterance.
   *
   * `route-long` used to instruct the operator to "say where it ENDED" -- i.e.
   * to discard the observation the step exists to collect. A mid-utterance
   * move is the sharpest possible evidence about routing, and without a button
   * for it the log recorded a clean single route where a transition happened.
   *
   * A MODIFIER, not a destination, and that distinction is what makes the 2x2
   * readable. As a plain choice it competed with the four destinations for the
   * one tap: an utterance that moved and ended in the car could be recorded as
   * one or the other, never both, so a run in which the route moves often
   * collapses every crossed cell to `route-moved` and the comparison the whole
   * protocol is built on comes out uniform.
   */
  { id: 'route-moved', label: 'It moved while playing', modifier: true },
  { id: 'route-silent', label: 'Heard nothing' },
] as const;

/**
 * "I could not tell", on every question in the protocol.
 *
 * A protocol without this does not collect fewer answers -- it collects the
 * same number, a fraction of them invented. At 70mph the common reason for
 * not answering is merging, not the app: a driver who never got a hand to the
 * wheel in time has to pick from "the app reacted / the radio took it /
 * nothing happened", and the honest-looking choice is the one that reads in
 * the log as the bug under investigation. That is a false bug report
 * manufactured by the absence of a button.
 */
const MISSED: StepResponse = {
  id: 'missed',
  label: 'Missed it \u2014 couldn\u2019t tell',
  kind: 'note',
};

export interface StepResponse {
  id: string;
  label: string;
  /** Colours the button and, more importantly, the reading of the log. */
  kind: 'route' | 'good' | 'bad' | 'note';
  /**
   * An observation that is true ALONGSIDE the answer, not instead of it.
   *
   * Tapping a modifier arms a marker and leaves the step open; the next real
   * answer is stamped carrying it. Without this, a step that offers both "it
   * moved while playing" and four destinations is asking the operator to
   * discard one of two true things -- and it is the sharpest evidence in the
   * protocol that gets discarded, because a move is more interesting than a
   * destination and so it is what an honest operator taps.
   *
   * Deliberately rare: every modifier costs a second tap in a moving car, so
   * it is only for a fact that is genuinely independent of the answer and
   * genuinely worth the tap.
   */
  modifier?: boolean;
}

/** The state a step needs, as data the screen applies. */
export interface FieldTestSetup {
  audioEnabled?: boolean;
  /**
   * Pinned, because `fallback-audible`'s premise depends on it.
   *
   * Above 1.0 a clip is routed through a GainNode to carry the excess, and
   * live speech cannot be amplified at all -- that asymmetry is the whole
   * point of the comparison. At or below 1.0 both play at unity, the
   * comparison measures nothing, and the operator's "the second was much
   * quieter" is a null result filed as evidence. Nothing in the log said
   * which of the two situations produced an answer.
   */
  volume?: number;
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
   * Wait for the recogniser to be LIVE before speaking this step's line.
   *
   * The 2026-09-23 drive settled why this has to exist. `mic-route` declares
   * `voice: true`, and the runner applied that and spoke in the same
   * synchronous effect body -- so the line played 7ms after the microphone was
   * asked for, while the log shows the recogniser took 3497ms to confirm. The
   * step built to measure "where does it come out with the microphone open"
   * therefore sampled the state BEFORE the flip and labelled it after.
   *
   * The cost in that drive: the last utterance before the recogniser went live
   * came out of the car, the first one after it came out of the phone
   * loudspeaker, and NOTHING was spoken in between -- so whether the route
   * moves when the microphone opens or when it closes is still undetermined
   * after a full twenty-step run built to determine it.
   */
  awaitListening?: boolean;
  /**
   * Wait for the recogniser to be genuinely DOWN before speaking this line.
   *
   * The mirror of `awaitListening`, and needed for the same reason on the
   * closing edge. `setVoiceOn(false)` flips a flag; `recognition.stop()` only
   * REQUESTS the end of the session, and the phone tears the hands-free link
   * down some time afterwards. The step effect calls `setVoiceOn(false)` and
   * `say()` in one synchronous body -- so the sample that exists to show where
   * audio goes AFTER the microphone was being taken while the microphone was
   * still coming down, which is precisely the defect `awaitListening` was
   * added to fix, measured from the other end.
   */
  awaitSilent?: boolean;
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

const ROUTE_RESPONSES: readonly StepResponse[] = [
  ...ROUTE_ANSWERS.map((r) => ({ ...r, kind: 'route' as const })),
  MISSED,
];

/**
 * Bluetooth is off under `speakerphone`, so every wheel step there has no car
 * to answer for.
 *
 * Shared rather than written inline because `wheel-repeat` needs it too: that
 * step's answers were "pressed twice", "the radio took one" and "could not
 * press twice", none of which is true when there is nothing to press INTO. So
 * the one condition where the answer is certain in advance was the one
 * condition with no button for it. `stepResponses` moves this to the front
 * under a condition with no Bluetooth.
 */
const WHEEL_NA: StepResponse = {
  id: 'wheel-na',
  label: 'No Bluetooth \u2014 not applicable',
  kind: 'note',
};

const WHEEL_RESPONSES: readonly StepResponse[] = [
  /**
   * 'The app reacted' USED TO BE HERE, and was unanswerable by construction.
   *
   * While a wheel step is showing, the media-session handler short-circuits
   * into the probe and returns before the real handler runs -- deliberately,
   * so a test press cannot also answer a drill question. So the app produces
   * no audible reaction to any wheel press in any wheel step, and the only
   * honest tap for a press that DID arrive was "Nothing happened at all":
   * the bug signature. The step manufactured the false positive the protocol
   * was rewritten to stop manufacturing.
   *
   * Whether the press arrived is already in the log, with a timestamp, from
   * `diag('wheel','field-test-arrival')` -- and it is on screen as it
   * happens. The operator holds one fact the code does not: whether the CAR
   * consumed the press instead. That is what is asked here now.
   */
  /**
   * ...AND THE REPLACEMENT SAID THE SAME IMPOSSIBLE THING.
   *
   * `wheel-heard-beep` -- "I heard the app acknowledge it" -- was written
   * directly beneath the paragraph above explaining that the app CANNOT
   * acknowledge a press during a wheel step. Same unanswerable claim, new
   * label. It was worse than the option it replaced, because it was the only
   * `good`-coloured button: a press that arrived perfectly left the operator
   * with nothing but "Nothing audible happened", which is `bad` -- so five
   * wheel steps in four conditions filed every success under the routing
   * fault's own signature.
   *
   * What the operator can actually distinguish is what the CAR did, which is
   * the half the code cannot see. Whether the press arrived is on screen as it
   * happens and in the log with a timestamp.
   */
  { id: 'wheel-car-quiet', label: 'The car did nothing else', kind: 'good' },
  { id: 'wheel-radio', label: 'The radio changed track instead', kind: 'bad' },
  /**
   * `wheel-nothing` USED TO LIVE HERE, and it was a category error.
   *
   * What the CAR did and whether the APP saw the press are independent facts,
   * and this is a single-choice list. The most diagnostic outcome of all -- the
   * press vanished, no arrival on screen AND no radio -- made two of these
   * labels true at once, so the operator had to discard one of them. Eyes-free
   * at road speed the option that needs no glance wins, and it is the
   * `good`-coloured one: a press lost entirely got filed as the car behaving.
   *
   * The app's own half is already recorded on every press, with a timestamp,
   * as `wheel field-test-arrival`, and it is on screen as it happens. The
   * analysis crosses the two afterwards rather than asking the driver to do it
   * at 70mph.
   */
  WHEEL_NA,
  MISSED,
];

const FREE_RESPONSES: readonly StepResponse[] = [
  { id: 'good', label: 'That worked', kind: 'good' },
  { id: 'bad', label: 'That was wrong', kind: 'bad' },
  { id: 'nothing-to-report', label: 'Nothing to report', kind: 'note' },
  /**
   * `MISSED` HERE TOO, and it is not padding.
   *
   * The stack hangs from the bottom of the screen and `MISSED` is last on
   * every other step in the protocol, which makes the bottom button the one
   * thing an operator can tap without looking. This step was the single
   * exception, so on the last step of the run that same thumb position
   * silently became "Nothing to report" — a filed answer rather than a
   * declined one.
   */
  MISSED,
];

export const FIELD_TEST_CONDITIONS: readonly FieldTestCondition[] = [
  {
    id: 'car',
    label: 'Car, parked',
    motion: 'parked',
    bluetooth: true,
    // WHERE THE PHONE IS, because earpiece-versus-loudspeaker is a pure
    // function of distance from your head and it was unspecified. A phone in
    // the cradle and a phone in your lap give different answers to the
    // protocol's central question, and two legs run differently cannot be
    // compared at all.
    setup:
      'Paired to the car over Bluetooth, engine running, handbrake on. Phone in the cradle, an arm’s length away — not in your hand or your lap.',
    proves:
      'The baseline for everything else. Same audio route as a drive, without the road — so anything that fails here fails for reasons that have nothing to do with speed.',
  },
  {
    id: 'freeway',
    label: 'Freeway',
    motion: 'driving',
    bluetooth: true,
    setup:
      'Paired exactly as above, phone in the same cradle, at your normal road speed, windows up.',
    proves:
      'The real thing, including the wheel. Whether the buttons reach the app at speed is the open question this protocol exists for, and it cannot be answered stationary.',
  },
  {
    id: 'speakerphone',
    label: 'Speakerphone',
    motion: 'driving',
    bluetooth: false,
    setup: 'Phone in the cradle on its own speaker, Bluetooth OFF, at road speed.',
    // WHAT IT CAN AND CANNOT SEPARATE. This changes four things against
    // `freeway` at once — Bluetooth off, the phone's own speaker, no wheel,
    // and whatever the phone does with its audio session when no car is
    // attached — so "anything that fails here too is the app or the road"
    // read a four-variable change as a one-variable control. It is still worth
    // running: a failure here rules the CAR out, which is the single most
    // useful thing a control can do. It just cannot say which of the remaining
    // three it was.
    proves:
      'Rules the car out. Anything that still fails with Bluetooth off is the app, the phone or the road — it cannot say which, because this changes several things at once, but it takes the car off the list.',
  },
  {
    id: 'phone',
    label: 'Phone, quiet',
    motion: 'parked',
    bluetooth: true,
    setup: 'Phone in your hand, at your usual distance, engine off, windows up.',
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
    title: 'Where does it come from? (1 of 2, recorded)',
    instruction: 'Listen to the line. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: {
      audioEnabled: true,
      useClips: true,
      muted: false,
      voice: false,
      eyesFree: true,
      // Above unity on purpose: a clip can carry the excess through a gain
      // UNITY, and pinned at unity on purpose.
      //
      // This used to be 1.5, which confounded the comparison it was meant to
      // serve. Live TTS clamps to 1.0 (volume.ts), so the clip route steps
      // played ~3.5dB louder than the TTS route steps speaking the IDENTICAL
      // lines -- and under road noise level is exactly what decides
      // "car speakers" from "earpiece" from "heard nothing". A TTS sample
      // answered "Heard nothing" was then unattributable between the path and
      // the loudness. The asymmetry belongs to `fallback-audible`, which is
      // the one step whose question IS the asymmetry, so the boost is
      // declared there instead.
      volume: 1,
    },
  },
  {
    id: 'route-2',
    title: 'Where does it come from? (2 of 2, recorded)',
    instruction:
      'A second line, straight after the first. Where did it come from?',
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  /**
   * `route-3` USED TO SIT HERE, a third consecutive clip on a third new line,
   * and it was the least informative sample in the protocol.
   *
   * Two adjacent samples already discriminate the two hypotheses this block
   * exists for: alternation predicts they differ, a stable route predicts they
   * match. The third only firms up a count. Its step was spent instead on the
   * pair below, which buys a comparison the protocol previously could not make
   * at all -- see `route-1t`. Its line is not lost: `route-short` and
   * `route-long` follow immediately, on the same path, so this block still
   * carries four consecutive clip samples.
   */
  {
    id: 'route-short',
    title: 'A short line',
    instruction:
      'One word rather than a sentence. Where did it come from?',
    say: ['Correct?'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'route-long',
    title: 'A long line',
    instruction:
      'A longer line this time. Where did it come from?',
    say: [
      'Twelve versus six: hit at true count minus three or lower, when the dealer hits soft seventeen.',
    ],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * THE COMPARISON THE PROTOCOL EXISTED FOR AND COULD NOT MAKE, half one.
     *
     * There used to be three TTS route steps, and all three stood AFTER the
     * microphone block, while every clip route step stood before it. Path and
     * microphone-state were therefore perfectly confounded: "the route follows
     * the path" and "the microphone moved the route and it never came back" --
     * the two live explanations of the operator reporting a voice change and a
     * speaker change in the same breath -- predicted the IDENTICAL table. The
     * protocol could not tell its own leading hypothesis from the one it was
     * written to rule out, which is the whole of what it was for.
     *
     * So the two factors are crossed instead. This pair repeats `route-1` and
     * `route-2` word for word on live TTS, here, BEFORE the microphone; the
     * post-microphone block repeats all four in the same order afterwards.
     * Same lines, same volume, same order, one factor changed at a time.
     */
    id: 'route-1t',
    title: "Same line, the phone's voice (1 of 3)",
    instruction:
      'The same two lines again, with the recording switched off so your phone reads them. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    // Unity, like every other route step. The 1.5 boost belongs to
    // `fallback-audible` alone, because loudness is exactly what separates
    // "car speakers" from "earpiece" from "heard nothing" under road noise,
    // and a path comparison run at two different volumes measures both.
    setup: { audioEnabled: true, useClips: false, voice: false, eyesFree: true, volume: 1 },
  },
  {
    id: 'route-2t',
    title: "Same line, the phone's voice (2 of 3)",
    instruction: 'Second of the three, straight after. Where did it come from?',
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * THE THIRD SAMPLE, and the reason every cell now has one.
     *
     * Two adjacent samples do not separate a wandering route from a stable
     * one. That was written into this file as though it did — "alternation
     * predicts they differ, a stable route predicts they match" — and it is
     * false: with three destinations and a route picked per utterance, two
     * samples agree by chance between a third and half the time. A full run
     * makes eight such comparisons, so a run had roughly a two-in-five chance
     * of handing back one clean, entirely spurious "the microphone moved it
     * and never moved it back". Three samples make a cell uniform by chance
     * about one time in nine, and three is what the operator's time buys.
     */
    id: 'route-3t',
    title: "Same line, the phone's voice (3 of 3)",
    instruction: 'Third of the three. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * NOT A "WHICH VOICE WAS THAT" QUESTION, and the distinction is the whole
     * reason this step survived while `voice-which` was deleted.
     *
     * The app knows exactly which voice spoke -- speech.ts decides it and
     * records it, and the screen now prints it. Asking a person to identify it
     * would be asking them to guess at something already written down, which
     * is a question that cannot produce information.
     *
     * What the app CANNOT know is whether the fallback was audible. That is
     * not a preference: live speechSynthesis is capped at unity gain by the
     * browser, so unlike a clip it cannot be amplified past 100% at all --
     * which means an utterance that falls back is an utterance that may
     * simply vanish under road noise, at a volume the operator has no way to
     * raise. Whether it did vanish is a fact about this car at this speed,
     * and only the person in it can report it.
     */
    id: 'fallback-audible',
    title: 'Can you hear the fallback at all?',
    instruction:
      'Two lines. The first is a recording, which the volume boost can reach; the second is your phone reading text aloud, which it cannot \u2014 that one is as loud as it will ever get. The app knows which is which, so it is not asking. It is asking whether you could make out the second one over the road.',
    say: ['Correct play was double.'],
    sayUnclipped:
      'This second line has no recording behind it, so your phone is reading it aloud instead.',
    /**
     * THE BOOST LIVES HERE, on the step whose premise it is.
     *
     * Above unity a clip carries the excess through a GainNode and live
     * speech cannot carry any of it. That asymmetry is the entire question
     * this step asks. It used to be pinned six steps earlier at `route-1`,
     * which meant a run RESUMED at this step -- the ordinary outcome of the
     * update check reloading mid-drive -- ran the comparison at unity, where
     * it measures nothing, while the screen said "Nothing changed for this
     * step".
     */
    // CLIPS DECLARED, not inherited, because the step immediately above now
    // turns them off. The premise here is one recorded line against one
    // unrecorded one; inheriting `useClips: false` would make both of them
    // unrecorded and the operator would be comparing a line against itself.
    setup: { volume: 1.5, useClips: true },
    sayAgain: true,
    responses: [
      { id: 'fallback-clear', label: 'Heard both fine', kind: 'good' },
      { id: 'fallback-quiet', label: 'The second was much quieter', kind: 'bad' },
      { id: 'fallback-lost', label: 'The second was lost in the noise', kind: 'bad' },
      /**
       * THE ROUTE ANSWER, and without it this step could not be read at all.
       *
       * Its two lines go down DIFFERENT paths, and the protocol's leading
       * hypothesis is that the path decides the route. So the single most
       * important thing that can happen here -- the clip out of the car, the
       * fallback out of the earpiece -- had no button, and landed on "the
       * second was much quieter" or "lost in the noise", which name the cap as
       * the cause. The step would have confirmed a volume ceiling while
       * demonstrating a routing split.
       *
       * `bad`, NOT `route`, and that is deliberate. `kind: 'route'` is what
       * marks a step as one of the route SAMPLES -- the set that is compared
       * against itself and must therefore run at one fixed volume. This step
       * is the one place the protocol raises the volume on purpose, because
       * the gain asymmetry is its entire premise, so enrolling it in that set
       * would reintroduce the confound this batch exists to remove. The answer
       * is still uniquely identified by its id wherever the log is read.
       */
      { id: 'fallback-moved', label: 'The second came from somewhere else', kind: 'bad' },
      MISSED,
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
    setup: {
      audioEnabled: true,
      useClips: true,
      wheelMode: 'answer',
      voice: false,
      eyesFree: true,
      // BACK TO UNITY, because `fallback-audible` just raised it and setup now
      // folds forward. Everything downstream -- including `route-after-mic`,
      // which is compared against `route-1` -- has to play at the same level
      // as `route-1` did, or the before/after-microphone comparison varies
      // loudness as well as microphone state.
      volume: 1,
    },
  },
  {
    /**
     * IT SPEAKS ITS OWN LINE FIRST, and without one this step measured
     * nothing it claimed to.
     *
     * The instruction said "wait until it has gone properly quiet" -- but the
     * step declared no line, and the previous step's cleanup calls
     * `cancelSpeech()` on unmount, so it was ALREADY silent on arrival. The
     * operator waited for an utterance that was never coming, and the gap
     * between the last utterance and the press was unspecified and
     * uncontrolled. The 2026-09-19 fault is specifically a press into the
     * silence AFTER speech, so the speech has to be part of the step.
     */
    id: 'wheel-gap',
    title: 'Wheel, after the line ends',
    instruction: 'Wait for the line to finish. Count three. Then press skip-forward.',
    say: ['Basic double versus dealer five.'],
    sayAgain: true,
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
    /**
     * TWO BUTTONS ARE EXCLUDED BY NAME, and the exclusion is the point.
     *
     * This asked for "volume, the voice button, whatever", upstream of the
     * microphone block and of the entire after-microphone route block. Car
     * volume is the one gain stage the app cannot see or record, so a leg in
     * which it was nudged answers every later loudness question against a
     * different baseline with nothing in the log to say so. The voice button
     * seizes HFP outright — the exact transition the protocol is built to
     * observe — meaning the step could hand the run the very state change
     * it is meant to measure, ten minutes early, with `wheel-other-noted`,
     * kind `note`, as the only trace.
     */
    id: 'wheel-other',
    title: 'Any other button',
    instruction:
      'Press anything else you can reach on the wheel \u2014 but NOT volume and NOT the voice button. This is here to find out what the car will even send.',
    wheel: true,
    responses: [
      // BEFORE THE SHARED SET, not after it. `WHEEL_RESPONSES` ends with
      // "Missed it", and the answer stack hangs from the bottom of the screen
      // so that the one button meaning the same thing on every step never
      // moves. Appending here put "Missed it" one slot up on this step alone --
      // 60px, a full button pitch, at the one position a driver reaches for
      // without looking. Pinned by "puts the same escape hatch in the same
      // place on every step" in fieldTest.test.ts.
      { id: 'wheel-other-noted', label: 'Pressed something else', kind: 'note' },
      ...WHEEL_RESPONSES,
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
    instruction:
      'Two presses, a couple of seconds apart. The count is on screen and in the log \u2014 just tap Done when you have pressed twice.',
    wheel: true,
    /**
     * DONE, NOT A COUNT. This asked "both / only the first / neither", which
     * is precisely what `diag('wheel','field-test-arrival')` already records,
     * with timestamps -- the operator's own objection ("the code doesn't know
     * wtf?") reproduced in the wheel steps after being fixed in the voice
     * ones. It could not even express the diagnostically loaded outcome,
     * because there was no "only the second" button.
     */
    responses: [
      { id: 'wheel-repeat-done', label: 'Done \u2014 pressed twice', kind: 'note' },
      // The car consuming a press produces no arrival, which is
      // indistinguishable in the log from the car sending nothing. Only the
      // person in the seat can tell those apart.
      //
      // A MODIFIER here for the same reason as `route-moved`: "I pressed
      // twice" and "the radio took one of them" are independent facts about
      // the same pair of presses, and as a single choice between them an
      // arrival count of 1 could not be read -- one press lost to the radio
      // and one press never sent are the diagnosis and its opposite.
      { id: 'wheel-radio', label: 'The radio changed track', kind: 'bad', modifier: true },
      { id: 'wheel-repeat-couldnt', label: 'Could not press twice', kind: 'note' },
      WHEEL_NA,
      MISSED,
    ],
  },
  {
    id: 'mic-route',
    title: 'With the microphone open (1 of 3, recorded)',
    /**
     * UNPRIMED. This used to end "-- this is where output is expected to move
     * to the earpiece", which names the answer on one of the two observations
     * the whole run turns on. A driver at speed resolving a marginal signal
     * resolves it toward the prime, and a protocol that carefully adds a
     * "Missed it" button to stop manufacturing answers cannot then supply one.
     */
    instruction:
      'The microphone is on and listening. Where did it come from?',
    // Gated, so the line lands after the flip rather than 3.5 seconds before it.
    awaitListening: true,
    // LINE A, the same line the pre- and post-microphone blocks open with.
    // This used to be a line spoken nowhere else in the protocol, which left
    // the microphone-open block -- the one sitting between the two crossed
    // blocks -- impossible to compare with either of them utterance for
    // utterance. The comparison is only as good as its constants.
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: true, voice: true, eyesFree: true },
  },
  {
    /**
     * A SECOND, because one sample cannot separate the hypothesis from the
     * null.
     *
     * The operator has reported the route ALTERNATING between the car and the
     * phone on successive utterances. With a single sample on each side of the
     * microphone, "opening the microphone moved it" and "it alternates and
     * this draw happened to be the phone" produce identical logs. Two adjacent
     * samples is the cheapest thing that discriminates them: alternation
     * predicts they differ, a stable route predicts they match.
     *
     * This used to be the second of THREE clips. The third became `mic-route-t`
     * -- the same question on the phone's voice -- because a third repeat only
     * firms up a count, while without it the microphone-open condition could
     * not be compared with the other two on the fallback path at all.
     */
    id: 'mic-route-2',
    title: 'With the microphone open (2 of 3, recorded)',
    instruction: 'Second of the three, straight after. Where did it come from?',
    awaitListening: true,
    // LINE B, matching `route-2` and `route-after-mic-2`.
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /** The third sample this cell needs. See `route-3t`. */
    id: 'mic-route-3',
    title: 'With the microphone open (3 of 3, recorded)',
    instruction: 'Third of the three. Where did it come from?',
    awaitListening: true,
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * THE THIRD SAMPLE SPENT ON THE OTHER PATH instead of a third repeat.
     *
     * This was `mic-route-3`, a third clip. With the pre- and post-microphone
     * blocks now crossed, the one remaining empty cell in the design was TTS
     * with the microphone OPEN -- and without it the microphone-open condition
     * could not be compared with either of the others on the phone's voice, so
     * an interaction (the microphone moves the clip route but not the TTS one,
     * or the reverse) stayed invisible at the exact moment it matters. The
     * step cost less than it looked: the cell it left behind now carries
     * three samples of its own rather than the two it had, and two was never
     * enough to separate alternation from a stable route in the first place
     * — see `route-3t`.
     */
    id: 'mic-route-t',
    title: "With the microphone open, the phone's voice (1 of 3)",
    instruction:
      'Still listening, but the recording is off for these three. Where did it come from?',
    awaitListening: true,
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: false, voice: true, eyesFree: true },
  },
  {
    /**
     * This cell was n=1, against four on the other side of the same row.
     *
     * A single draw cannot be uniform or not — it is one destination, and
     * every reading of it is a reading of one utterance. See `route-3t` for
     * what the other two buy.
     */
    id: 'mic-route-t2',
    title: "With the microphone open, the phone's voice (2 of 3)",
    instruction: 'Second of the three, straight after. Where did it come from?',
    awaitListening: true,
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'mic-route-t3',
    title: "With the microphone open, the phone's voice (3 of 3)",
    instruction: 'Third of the three. Where did it come from?',
    awaitListening: true,
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
  },
  {
    id: 'mic-heard',
    title: 'Say an answer',
    /**
     * NAMES THE WORD, so the transcript has a ground truth. "Say one answer"
     * produced `heard-text: "stand"` with nobody afterwards able to say
     * whether the operator said "stand", "stand pat" or "hit" -- making "It
     * heard the wrong thing" a claim no one could audit from the log.
     */
    instruction:
      'Wait for it to finish, then say the word \u201cdouble\u201d out loud. What it heard appears below.',
    say: ['Did you have it?'],
    /**
     * GATED, and this is the step that proved the gate was needed. On the
     * 2026-09-23 drive its line -- "Did you have it?" -- was the first thing
     * the operator heard come out of the phone loudspeaker, and the log shows
     * it was spoken 5ms after `mic stop`. The answer filed was "It never heard
     * me", which was true and meant nothing: the recogniser had already been
     * torn down.
     */
    awaitListening: true,
    // Declared, not inherited. The runner resolves setup forward now, but a
    // step whose instruction says the microphone is on must say so in its own
    // data -- a test asserts exactly that.
    //
    // And clips back ON, because `mic-route-t` turned them off. This step asks
    // whether the recogniser hears the OPERATOR or the app, which depends on
    // how the app's own line is emitted; leaving it on the fallback path would
    // change the thing being measured halfway through the microphone block.
    setup: { voice: true, useClips: true },
    sayAgain: true,
    responses: [
      { id: 'heard-right', label: 'It got it right', kind: 'good' },
      /**
       * THE APP'S OWN VOICE, which is a real outcome and had no button.
       *
       * Echo suppression here is a window sized from a character-count
       * estimate and judged when the RESULT arrives, so it can be too short
       * (the app's own line comes back as the transcript) or too long (the
       * operator's real answer is swallowed inside it). Both used to land on
       * "It heard the wrong thing" or "It never heard me" -- the two answers
       * that read as the CAR misrouting the microphone, which is the
       * hypothesis under test. The app's own timing was being filed as
       * evidence for it.
       */
      { id: 'heard-self', label: 'It heard the app, not me', kind: 'note' },
      { id: 'heard-wrong', label: 'It heard the wrong thing', kind: 'bad' },
      { id: 'heard-nothing', label: 'It never heard me', kind: 'bad' },
      /**
       * THE HALF ONLY THE OPERATOR HOLDS, which had no button.
       *
       * Everything else on this step is something the code already records:
       * the transcript is in the log, and whether the recogniser produced
       * anything at all is in the log. The one fact that exists nowhere but
       * in the driver's head is whether they actually got the word out —
       * merging, a cough, realising the line was still playing. Without this,
       * "It never heard me" carried both "the microphone is dead" and "I
       * never said it", and those are opposite diagnoses.
       */
      { id: 'heard-not-said', label: 'I never got the word out', kind: 'note' },
      MISSED,
    ],
  },
  {
    id: 'wheel-with-mic',
    title: 'The wheel, with the microphone open',
    /** Unprimed, for the same reason as `mic-route`: this was the other half. */
    instruction: 'The microphone is still on. Press skip-forward again.',
    awaitListening: true,
    wheel: true,
    setup: { voice: true },
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
    title: 'Where does it come from now? (1 of 3, recorded)',
    instruction:
      'The microphone is shut again. Where did it come from?',
    /**
     * GATED ON THE MICROPHONE ACTUALLY BEING DOWN, which it was not.
     *
     * This step used to be the ONLY post-microphone sample in the protocol,
     * the headline conclusion was drawn from it, and it was taken during the
     * teardown: the runner calls `setVoiceOn(false)` and `say()` in one
     * synchronous body, and `stop()` only requests the end of the session --
     * iOS releases the hands-free link afterwards, on its own schedule. So
     * "the microphone is shut again", printed on the screen and assumed by
     * every reading of the answer, was a claim the app had made 7ms earlier
     * and never checked. The same defect as the one `awaitListening` fixes,
     * on the closing edge, on the more important half of the comparison.
     */
    awaitSilent: true,
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: true, voice: false, eyesFree: true },
  },
  {
    /**
     * ...AND IT WAS ALSO ALONE, n=1, against five samples on the other side.
     *
     * One draw cannot separate "the microphone moved the route" from "the
     * route alternates and this one happened to land on the phone" -- the
     * distinction the whole post-microphone block exists to make. This is the
     * second half of the pair, on the same line `route-2` used, so the two
     * blocks read against each other row for row.
     */
    id: 'route-after-mic-2',
    title: 'Where does it come from now? (2 of 3, recorded)',
    instruction: 'Second of the three, straight after. Where did it come from?',
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    // THE SAME STARTING LINE AS ITS PAIR. Only the first of these four used to
    // wait for the recogniser to be confirmed down, so only it was preceded by
    // the settle -- and four cells that claim to sample one state were
    // sampling from four different offsets. See `awaitSilent`.
    awaitSilent: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * The third sample on the cell the headline conclusion is drawn from.
     *
     * This is where two samples cost most: the post-microphone block exists to
     * decide whether the microphone moved the route and never moved it back,
     * and a pair that happens to agree reads as exactly that. See `route-3t`.
     */
    id: 'route-after-mic-3',
    title: 'Where does it come from now? (3 of 3, recorded)',
    instruction: 'Third of the three. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    awaitSilent: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * A WHEEL PRESS AFTER THE MICROPHONE, which the protocol never had.
     *
     * Every press was before the microphone block or during it, so "the
     * microphone takes the wheel" and "the media slot lapses after a handful of
     * presses, or after ten minutes" predicted the identical log — and the
     * second is the fault `wheel-repeat` exists to find. `wheel-with-mic` is
     * always the fifth or sixth press of the run and always about ten minutes
     * in, which is precisely where the two explanations are hardest to tell
     * apart.
     *
     * One press here separates them. The wheel working again with the
     * microphone confirmed down says the microphone took it and gave it back;
     * the wheel still dead says the slot went and the microphone is innocent.
     * Gated on the teardown for the same reason the route samples around it
     * are: a press taken mid-teardown is not a press after the microphone.
     */
    id: 'wheel-after-mic',
    title: 'The wheel, after the microphone',
    instruction: 'The microphone is shut. Press skip-forward once more.',
    awaitSilent: true,
    wheel: true,
    responses: WHEEL_RESPONSES,
  },
  {
    /**
     * THE OTHER HALF OF THE CROSS. See `route-1t` for why it exists.
     *
     * These two repeat `route-1t` and `route-2t` word for word, here, AFTER
     * the microphone. With the four steps above they complete a 2x2: recorded
     * and phone voice, before and after the microphone, same two lines, same
     * volume, same order in both blocks. Until this ordering existed every TTS
     * sample in the protocol sat on the far side of the microphone from every
     * clip sample, and the table could be read either way.
     */
    id: 'route-after-mic-t',
    title: "The phone's voice, after the microphone (1 of 3)",
    instruction:
      'The recording is off again for the last three. Same line as before. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    awaitSilent: true,
    responses: ROUTE_RESPONSES,
    setup: { audioEnabled: true, useClips: false, voice: false, eyesFree: true, volume: 1 },
  },
  {
    id: 'route-after-mic-2t',
    title: "The phone's voice, after the microphone (2 of 3)",
    instruction: 'Second of the three, straight after. Where did it come from?',
    say: ['Basic stand versus dealer six.'],
    sayAgain: true,
    awaitSilent: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /** The third sample this cell needs. See `route-3t`. */
    id: 'route-after-mic-3t',
    title: "The phone's voice, after the microphone (3 of 3)",
    instruction: 'Last one. Where did it come from?',
    say: ['Basic hit versus dealer nine.'],
    sayAgain: true,
    awaitSilent: true,
    responses: ROUTE_RESPONSES,
  },
  {
    /**
     * LAST, AND THAT IS A COMPROMISE RATHER THAN A CHOICE.
     *
     * The number normalises the route block, which ran ten minutes and one
     * microphone session earlier, and a cabin measured at the end of a leg is
     * not the cabin those samples were taken in. It cannot move earlier: this
     * step opens a raw `getUserMedia` stream, and opening a microphone is the
     * one event the whole protocol exists to measure the effect of. Taken
     * before the route block it would contaminate every "before the
     * microphone" sample in the run, which is the comparison the 2x2 rests on.
     *
     * So it is a reference level for the LEG, read against the other legs'
     * numbers, rather than a per-sample normaliser — and the log timestamps
     * both, so how far apart they were is recoverable.
     */
    id: 'ambient',
    title: 'How loud is it in here',
    instruction: 'Stay quiet for five seconds. This measures the cabin, not you.',
    ambient: true,
    /**
     * A single "Done" filed every reading as a clean cabin measurement. If a
     * truck passed, the operator coughed, or they had to speak, the dBFS
     * figure is of that -- and the whole use of the number is comparing one
     * condition against another, which a contaminated sample silently breaks.
     */
    responses: [
      { id: 'ambient-noted', label: 'Done \u2014 it was quiet', kind: 'note' },
      { id: 'ambient-dirty', label: 'Something else made noise', kind: 'bad' },
      MISSED,
    ],
    setup: { voice: false, useClips: true },
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
/**
 * The setup a step actually runs under, folded from every step before it.
 *
 * A step's `setup` is a DELTA, not a state. The runner used to apply only the
 * delta belonging to the step it was entering, which made three ordinary
 * things silently destroy a premise:
 *
 *   - RESUME. The run persists `stepIndex` on purpose -- the update check can
 *     reload the app mid-drive, and the operator has had two runs die already.
 *     Coming back at `fallback-audible` applied nothing, because that step
 *     declares nothing; its premise is the 1.5 volume pinned six steps earlier
 *     at `route-1`. Both lines then play at unity, the comparison measures
 *     nothing, and "the second was much quieter" is a null result filed as
 *     evidence. `describeFieldTestSetup(undefined)` printed "Nothing changed
 *     for this step", actively confirming the wrong thing.
 *   - BACK. Stepping back out of `mic-route` left the microphone open across
 *     four wheel steps, because "leave it as it was" read as carry-forward in
 *     one direction only. Those steps then measure the wheel under exactly the
 *     hands-free condition the protocol says must never contaminate them, and
 *     file the result as the routing fault under investigation.
 *   - A STRAY TAP. Only `route-1` declared `muted: false`. A thumb on the mute
 *     button at step 5 left the next fifteen steps silent, with the evidence
 *     line still reporting which voice "played".
 *
 * Folding forward makes the effective state a pure function of the index, so
 * it is identical however the operator arrived -- forward, back, resumed, or
 * remounted.
 */
export function resolveFieldTestSetup(index: number): FieldTestSetup {
  const upto = Math.max(0, Math.min(index, FIELD_TEST_STEPS.length - 1));
  const out: FieldTestSetup = {};
  for (let i = 0; i <= upto; i += 1) {
    Object.assign(out, FIELD_TEST_STEPS[i]?.setup ?? {});
  }
  return out;
}

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
      ...(setup.volume !== undefined ? { volume: setup.volume } : {}),
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
  if (setup.volume !== undefined) bits.push(`volume ${Math.round(setup.volume * 100)}%`);
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
  /**
   * `step=` IS A FIELD, not the event name.
   *
   * This used to write the step id as the EVENT, so it was the only entry in
   * the whole protocol that did not carry `step=`. `grep step=mic-route`
   * returned the open, the setup and both speech brackets -- and not the
   * answer, which is the one line a diagnosis is actually made from. There
   * was no single query that assembled a step's evidence, and this log is
   * read by grep in a car park.
   */
  diag('test', 'answer', { step: stepId, condition: conditionId, answer: responseId, ...extra });
}

/** Record entering a step, so the log brackets what follows. */
export function logFieldTestStep(stepId: string, conditionId: string, index: number): void {
  diag('test', 'step-open', { step: stepId, condition: conditionId, index });
}

/** Record the run's own boundaries, which the previous protocol never did. */
/**
 * How many legs this page has already run, and how long it has been open.
 *
 * Module state on purpose: it has to reset when the page does, because that is
 * exactly the quantity being reported. A leg with `legsBefore=0` is the only
 * one whose before-microphone cells are genuinely before anything; every other
 * value is a warning printed on the evidence rather than a confound left
 * invisible.
 */
let legsThisSession = 0;
const sessionOpenedAt = Date.now();

/** For a test that needs a fresh page's worth of history. */
export function _resetFieldTestSessionForTest(): void {
  legsThisSession = 0;
}

/** How many runs this page has already started. */
export function fieldTestLegsThisSession(): number {
  return legsThisSession;
}

export function logFieldTestRunStart(conditionId: string, runId?: string): void {
  diag('test', 'run-start', {
    // THE RUN ID, which this line of all lines was missing.
    //
    // `runId` exists because "two runs under the same condition in one export
    // used to be separable only by adjacency to `run-start`" -- and `run-start`
    // was logged BEFORE `startFieldTestRun` minted the id, from the start gate,
    // where the ambient context is not installed. So the run's own boundary
    // line was the one line that could not be joined to the run it opens, and
    // the defect survived intact at exactly the place it was aimed at.
    ...(runId !== undefined ? { run: runId } : {}),
    condition: conditionId,
    steps: FIELD_TEST_STEPS.length,
    // THE MOTION, because the condition id alone does not survive the
    // protocol changing. Two of the four conditions are driven and two are
    // not, and "was the car moving" is the axis half the findings are pooled
    // on -- a log read after a release that renames or adds a condition has
    // no other way to recover it.
    motion: motionForCondition(conditionId),
    // WHAT THIS PAGE HAS ALREADY BEEN THROUGH.
    //
    // Nothing is torn down between legs that the app does not own: the phone's
    // hands-free profile, in particular, is not the app's to restart. So legs
    // two, three and four run their BEFORE-THE-MICROPHONE cells in a session
    // that has already opened and closed the microphone twice -- and the
    // protocol's headline comparison is before-mic against after-mic. A
    // difference read across conditions could be "parked differs from freeway"
    // or it could be "leg 1 differs from leg 4", and without these two numbers
    // the export cannot tell the reader which.
    legsBefore: legsThisSession,
    sessionAgeMs: Date.now() - sessionOpenedAt,
  });
  legsThisSession += 1;
}

export function logFieldTestRunEnd(conditionId: string, stamped: number): void {
  diag('test', 'run-end', { condition: conditionId, stamped });
}

/**
 * A step's answers, ordered for the condition actually being run.
 *
 * `speakerphone` has Bluetooth off, so on its six wheel steps every honest
 * answer is `wheel-na` — and it sat fifth in a list of six, underneath four
 * answers about what the car did. Asking a driver to read past four impossible
 * options to reach the only possible one is how a wrong answer gets tapped at
 * speed, and a wrong answer here reads in the analysis as the car ignoring the
 * app.
 *
 * `MISSED` STAYS LAST regardless: the one escape hatch that means the same
 * thing on every step never moves, which is what makes it reachable without
 * looking.
 */
/**
 * FIXED POSITIONS FOR THE WHEEL FAMILY, top to bottom.
 *
 * Six steps use these answers and they do not all use the same ones:
 * `wheel-other` adds "Pressed something else", and `wheel-repeat` has its own
 * set entirely -- "the radio took one" but no "the car did nothing else".
 * Hung from the bottom of the screen, that silently moved answers under the
 * operator's thumb BETWEEN WHEEL STEPS: measured at 390x763, y=477 was "The
 * car did nothing else" on one step and "The radio changed track" on the
 * next. Those are the two opposite readings of the fault under test, and the
 * steps they are on are the steps performed with eyes on the road.
 *
 * Each row here is one slot, and an id may share a slot with another only
 * when no step can show both. A step with nothing for a slot renders a GAP:
 * a remembered position is then either the same answer or nothing at all, and
 * a tap into nothing stamps nothing, which is the honest outcome of a tap
 * aimed at an answer that is not there.
 */
const WHEEL_SLOTS: readonly (readonly string[])[] = [
  // The step-specific "I did the thing" note. `wheel-other` and `wheel-repeat`
  // are different steps, so these two can never appear together.
  ['wheel-other-noted', 'wheel-repeat-done'],
  ['wheel-car-quiet'],
  ['wheel-radio'],
  ['wheel-repeat-couldnt'],
  ['wheel-na'],
  ['missed'],
];

/** A rendered position: an answer, or a deliberate gap holding the slot. */
export type StepSlot = StepResponse | null;

/**
 * A step's answers, in the positions they occupy for the condition being run.
 *
 * `speakerphone` has Bluetooth off, so on its wheel steps every honest answer
 * is `wheel-na` -- and it sat fifth, underneath four answers about what the
 * car did. Asking a driver to read past four impossible options to reach the
 * only possible one is how a wrong answer gets tapped at speed, and a wrong
 * answer here reads in the analysis as the car ignoring the app. The move is
 * the same on every wheel step of that condition, so positions stay fixed
 * within the run the operator is actually doing.
 *
 * `MISSED` STAYS LAST regardless: the one escape hatch that means the same
 * thing on every step never moves, which is what makes it reachable without
 * looking.
 */
export function stepResponses(step: FieldTestStep, conditionId: string): readonly StepSlot[] {
  if (!step.wheel) return step.responses;
  const slots: StepSlot[] = WHEEL_SLOTS.map(
    (ids) => step.responses.find((r) => ids.includes(r.id)) ?? null,
  );
  const condition = FIELD_TEST_CONDITIONS.find((c) => c.id === conditionId);
  if (condition?.bluetooth !== false) return slots;
  const na = step.responses.find((r) => r.id === 'wheel-na');
  if (!na) return slots;
  return [na, ...slots.filter((r) => r?.id !== 'wheel-na')];
}

export function motionForCondition(conditionId: string): FieldTestMotion {
  return FIELD_TEST_CONDITIONS.find((c) => c.id === conditionId)?.motion ?? 'parked';
}
