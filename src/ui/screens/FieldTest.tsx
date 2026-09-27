import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import {
  FIELD_TEST_CONDITIONS,
  motionForCondition,
  FIELD_TEST_STEPS,
  stepResponses,
  applyFieldTestSetup,
  resolveFieldTestSetup,
  describeFieldTestSetup,
  logFieldTestRunEnd,
  logFieldTestRunStart,
  fieldTestLegsThisSession,
  logFieldTestStep,
  stampFieldTest,
} from '../../diag/fieldTest';
import {
  countStampedSteps,
  goToFieldTestStep,
  markFieldTestStamped,
  readFieldTestRun,
  setFieldTestCondition,
  markFieldTestBeforeHandedBack,
  markFieldTestBeforeOwed,
  fieldTestBefore,
  setFieldTestBefore,
  unspentFieldTestBefore,
  pauseFieldTestRun,
  resumeFieldTestRun,
  startFieldTestRun,
  stopFieldTestRun,
  subscribeFieldTestRun,
  type FieldTestRun,
  type FieldTestBefore,
} from '../../diag/fieldTestRun';
import {
  speakAsync,
  cancelSpeech,
  chime,
  lastSpeechPath,
  ensureMediaSessionHandlers,
  type SpeechPathRecord,
} from '../../audio/speech';
import { effectiveVolume } from '../../audio/volume';
import { setMediaSessionProbe } from '../../audio/mediaSession';
import { holdAudioFocus, releaseAudioFocus } from '../../audio/audioFocus';
import {
  closeSharedAudioContext,
  getSharedAudioContext,
  resumeSharedAudioContext,
} from '../../audio/audioContext';
import { requestWakeLock, releaseWakeLock } from '../../audio/wakeLock';
import { setClipsEnabled, setClipVoice, prewarmClips } from '../../audio/clips';
import { measureWithWebAudio } from '../../diag/carCheckCatalog';
import { bandFor, adviceFor } from '../../diag/ambientNoise';
import { useVoiceControl } from '../useVoiceControl';
import { setVoiceOn } from '../voiceSession';
import { setEyesFreeOn } from '../eyesFreeSession';
import { diag, setDiagContext } from '../../diag/diagnosticLog';
import { saveSettings } from '../../store/persist';
import { Segmented } from './Settings';
import type { Settings } from '../../store/types';
import type { Screen } from '../App';

/**
 * The field test, as a screen of its own.
 *
 * IT USED TO BE A PANEL FLOATING OVER A DRILL, and the operator's verdict
 * after the second drive was blunt: "the field test just sucked ... I don't
 * know why you haven't made the field test its own thing or why we have to go
 * to a drill in the first place."
 *
 * The floating panel had a real reason once. Every step said "start a drill
 * and listen for X", so the protocol could only be followed somewhere the
 * protocol was not, and a panel on the Settings screen destroyed its own run
 * on every trip. Floating fixed the wrong half of that. The right fix is for
 * the protocol to stop borrowing a drill's voice and use its own -- which is
 * what this does. Each step declares a line, the screen speaks it through
 * `speakAsync`, and that is the same clip cascade, the same media session and
 * the same audio element a drill would use. Nothing is simulated, and nothing
 * else is running to muddy the log.
 *
 * WHAT IT WRITES DOWN, which is the other half of the complaint ("I need it
 * to record in the logs, everything about the test as it happens"): the run's
 * start and end, every step opened with its index, every setting it changed
 * on the operator's behalf, every line it spoke and -- via speech.ts --
 * whether a clip or the phone's own voice spoke it, every wheel action the
 * car delivered, everything the microphone heard, every ambient reading, and
 * every answer tapped. The previous protocol recorded the last of those and
 * nothing else, which is why two drives produced no diagnosis.
 *
 * THE MICROPHONE IS OFF unless the step asks for it. An open microphone flips
 * the car to its hands-free profile, which takes the wheel away and drags
 * playback to the earpiece -- so leaving it open would make every wheel step
 * fail for a reason that has nothing to do with the wheel.
 */
/**
 * How long a gated step waits for the recogniser before giving up.
 *
 * The 2026-09-23 drive took 3497ms to confirm a session; the drives before it
 * took 1463ms and 3570ms. Ten seconds is comfortably past the worst of those
 * and still short enough that a microphone which is never coming -- permission
 * refused, another app holding it -- does not strand the operator on one step
 * in traffic.
 */
const MIC_SETTLE_TIMEOUT_MS = 10_000;

/**
 * How long to wait for the recogniser to report itself down, and then how long
 * to sit still before speaking anyway.
 *
 * The two numbers do different jobs, and the second is the one that matters.
 * `recognition.stop()` only REQUESTS the end of a session; the recogniser
 * reporting `off` says the app has let go, NOT that the phone has released the
 * hands-free link and moved the output back. Nothing in the browser exposes
 * that transition, so the settle is a declared wait rather than a measured
 * one — and it is written into `mic-stopped` on every step that uses it, so a
 * drive that shows the route still moving can say whether 1.5s was simply too
 * short instead of leaving it a guess forever.
 */
const MIC_RELEASE_TIMEOUT_MS = 5_000;
/**
 * How long a two-tap guard stays armed.
 *
 * Long enough for a deliberate second tap by someone who is not looking,
 * short enough that the arming cannot outlive the intent behind it.
 */
const ARMED_MS = 5000;

/**
 * Disarm a two-tap guard after `ARMED_MS`.
 *
 * Both guards on this screen were disarmed only by something else changing:
 * `confirmFinish` by the step effect, and `confirmRestart` by nothing at all.
 * Two ordinary actions do not change the step -- tapping a `modifier` answer,
 * and answering on `free`, which by design does not advance -- so an armed
 * Finish survived any number of later taps. On the last step of the protocol,
 * where the operator is deliberately tapping repeatedly, that is a run ended
 * by a button they armed by accident several minutes earlier.
 */
function useArmedFor(armed: boolean, setArmed: (v: boolean) => void): void {
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed, setArmed]);
}

const HFP_SETTLE_MS = 1_500;

/**
 * The silence between the arrival chime and a measured utterance.
 *
 * THE SAME NUMBER AS `HFP_SETTLE_MS`, on purpose and not by coincidence: the
 * post-microphone steps get their run-up from that wait, so every other route
 * sample has to get an identical one or the cells differ in something besides
 * the factor being crossed. If one moves, the other moves with it.
 */
const PRE_SAMPLE_SETTLE_MS = HFP_SETTLE_MS;

/**
 * How long after a step opens an answer is ignored.
 *
 * Covers a bounce on a rough road, not a decision: nobody reads a step and
 * chooses an answer in a third of a second, and the cost of being wrong in
 * the other direction is a contradictory pair of stamps on a step the
 * operator never saw.
 */
const ANSWER_GUARD_MS = 350;

/**
 * The stored snapshot, but only while it can still be true.
 *
 * `unspentFieldTestBefore()` answers "does the run still owe the operator
 * their settings", and preferring it at Start is right in the case it exists
 * for: a run killed before any cleanup could run: the persisted settings ARE
 * the protocol's, and capturing them as the new `before` would make the
 * protocol's own state permanent. Force-quitting from the running screen does
 * exactly that, and the gate's session warning tells the operator to do it
 * between legs.
 *
 * WHAT IT CANNOT SEE is the operator changing something afterwards. Relaunch,
 * turn the volume down or switch the recorded voice off on purpose, start the
 * next leg: the new run adopted the pre-crash snapshot and its restore wrote
 * that deliberate change away, permanently. Same bug `beforeHandedBack` was
 * added to fix, through the one door that fix left open.
 *
 * The settings themselves answer it. If what is on disk is still exactly what
 * the protocol imposed at the step the old run died on, nobody has touched
 * them and the snapshot is the operator's. If it is not, they have, and the
 * live settings are the better record of what they want back.
 */
function owedSnapshot(run: FieldTestRun, settings: Settings): FieldTestBefore | undefined {
  const stored = unspentFieldTestBefore();
  if (!stored) return undefined;
  const imposed = applyFieldTestSetup(settings, resolveFieldTestSetup(run.stepIndex));
  const untouched =
    imposed.audio.volume === settings.audio.volume &&
    imposed.audio.useClips === settings.audio.useClips &&
    imposed.audio.muted === settings.audio.muted &&
    imposed.audio.enabled === settings.audio.enabled &&
    imposed.drill.wheelMode === settings.drill.wheelMode;
  if (untouched) return stored;
  diag('test', 'before-snapshot-stale', {
    atStep: run.stepIndex,
    // What disagrees, so the export says which setting the operator changed
    // rather than merely that the snapshot was dropped.
    changed: [
      imposed.audio.volume !== settings.audio.volume ? 'volume' : null,
      imposed.audio.useClips !== settings.audio.useClips ? 'useClips' : null,
      imposed.audio.muted !== settings.audio.muted ? 'muted' : null,
      imposed.audio.enabled !== settings.audio.enabled ? 'enabled' : null,
      imposed.drill.wheelMode !== settings.drill.wheelMode ? 'wheelMode' : null,
    ]
      .filter((x) => x !== null)
      .join(', '),
  });
  return undefined;
}

export function FieldTest({
  settings,
  onSettingsChange,
  onNavigate,
}: {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const [run, setRun] = useState<FieldTestRun>(() => readFieldTestRun());
  useEffect(() => subscribeFieldTestRun(() => setRun(readFieldTestRun())), []);

  const condition =
    FIELD_TEST_CONDITIONS.find((c) => c.id === run.condition) ?? FIELD_TEST_CONDITIONS[0]!;

  if (!run.active) {
    return (
      <StartGate
        run={run}
        onNavigate={onNavigate}
        onStart={() => {
          // AN EXISTING SNAPSHOT WINS OVER WHAT IS ON DISK NOW.
          //
          // Taking the current settings is right at a true start, and wrong in
          // precisely the case this snapshot exists for. After a mid-drive
          // reload the React cleanup never ran, so `restoreSettings` never ran,
          // so the persisted settings ARE the protocol's -- volume 1.5, its
          // wheel mode, its clip setting. The gate offers Resume and "Start
          // over from step 1", and Start over used to capture that as the new
          // `before` and drop the good one. The run would then end by restoring
          // the protocol's own state as the operator's, permanently, for every
          // future drill. After a clean finish or pause the stored snapshot has
          // already been handed back and equals the current settings, so
          // preferring it is a no-op in the ordinary case.
          // THE APP'S HALF OF THE RESET. The shared graph and the media hold
          // both outlive a run, so a second leg inherits the first leg's audio
          // session -- see the note above for the half only the operator can
          // do. Done before the run exists, so nothing the protocol sets up is
          // torn down by it.
          releaseAudioFocus('speech');
          closeSharedAudioContext();
          startFieldTestRun(
            run.condition,
            owedSnapshot(run, settings) ?? {
              volume: settings.audio.volume,
              useClips: settings.audio.useClips,
              muted: settings.audio.muted,
              enabled: settings.audio.enabled,
              wheelMode: settings.drill.wheelMode,
            },
          );
          // LOGGED AFTER THE RUN EXISTS, so the line carries the id of the run
          // it opens. See `logFieldTestRunStart`.
          logFieldTestRunStart(run.condition, readFieldTestRun().runId);
          // THE GRAPH EXISTS BEFORE THE FIRST SAMPLE, not partway through the
          // first pair.
          //
          // The shared `AudioContext` is created lazily, by `chime()` or by
          // `amplify()`, and route steps play at volume 1 so they never
          // amplify. The first chime in a run is therefore the ANSWER TAP on
          // route-1 — which means route-1 was spoken with no Web Audio
          // graph on the device at all and route-2 with one. Those two are the
          // protocol's first alternation pair: the comparison the reader is
          // told to make straddles the creation of the audio graph, and
          // creating a context is not nothing on iOS.
          //
          // Done here because Start is a real user gesture, which is also the
          // only moment `resume()` is allowed to succeed.
          const ctx = getSharedAudioContext();
          resumeSharedAudioContext();
          diag('test', 'audio-graph-open', { state: ctx?.state ?? 'none' });
        }}
        onResume={() => {
          // Logged distinctly from a start: a resumed run has no `run-start`
          // above its first step, which otherwise reads in the export as a
          // run whose beginning was evicted.
          // `atStep`, NOT `step`. Every other line in the export uses `step=`
          // for a step ID -- `grep step=wheel-gap` is how a run is read -- and
          // this wrote a 1-based ordinal into it, off by one against
          // `step-open index=` as well. Positions are `index`/`atStep`
          // everywhere else; this was the one exception.
          diag('test', 'run-resume', {
            // Same reason as `run-start`: the start gate installs no ambient
            // context, so this line has to carry the id itself or it cannot be
            // joined to the run it resumes.
            run: run.runId,
            condition: run.condition,
            step: FIELD_TEST_STEPS[run.stepIndex]?.id,
            atStep: run.stepIndex,
          });
          // RE-TAKEN ONLY IF NOTHING IS OWED, which is the difference between
          // the two ways a run gets paused.
          //
          // After the operator taps Pause the settings have been handed back,
          // so what is on disk is theirs and the run is about to seize it a
          // second time: re-take. After the update-check reload nothing was
          // handed back — no cleanup ran — and what is on disk is the
          // PROTOCOL's, `volume: 1.5` and the recorded voice off. Re-taking
          // there recorded the protocol's own state as the operator's and the
          // end of the run made it permanent, which is the original bug this
          // snapshot exists to prevent, coming back through the one door left
          // open. The stored snapshot survived that reload precisely so it
          // could be used here.
          if (unspentFieldTestBefore() === undefined) {
            setFieldTestBefore({
              volume: settings.audio.volume,
              useClips: settings.audio.useClips,
              muted: settings.audio.muted,
              enabled: settings.audio.enabled,
              wheelMode: settings.drill.wheelMode,
            });
          }
          // Same reason as a fresh start: a resumed run's next sample must
          // not be the one that creates the graph. `closeSharedAudioContext`
          // is deliberately NOT called here — resuming continues a leg
          // rather than beginning one.
          const resumedCtx = getSharedAudioContext();
          resumeSharedAudioContext();
          diag('test', 'audio-graph-open', { state: resumedCtx?.state ?? 'none', resumed: true });
          resumeFieldTestRun();
        }}
      />
    );
  }

  return (
    <RunningTest
      run={run}
      conditionLabel={condition.label}
      settings={settings}
      onSettingsChange={onSettingsChange}
      onNavigate={onNavigate}
    />
  );
}

/** How many times this step has been stamped under the run's own condition. */
function stampsFor(run: FieldTestRun, stepId: string): number {
  return run.stamps[`${run.condition}:${stepId}`] ?? 0;
}

function StartGate({
  run,
  onStart,
  onResume,
  onNavigate,
}: {
  run: FieldTestRun;
  onStart: () => void;
  onResume: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const condition =
    FIELD_TEST_CONDITIONS.find((c) => c.id === run.condition) ?? FIELD_TEST_CONDITIONS[0]!;
  /**
   * Start-over is armed, exactly as Finish is.
   *
   * Finish keeps every stamp and had a two-tap guard; this button zeroes the
   * position and empties the stamps and had none — and it is the button
   * directly below Resume on the screen an interrupted run comes back to. One
   * mis-tap in a moving car ended a drive's evidence silently.
   */
  const [confirmRestart, setConfirmRestart] = useState(false);
  // AND IT DISARMS. Nothing cleared this at all, so a stray tap left "Start
  // over" armed across condition changes and for as long as the gate was up:
  // the next tap anywhere near it discarded the run. A two-tap guard means
  // two taps together, not two taps ever.
  useArmedFor(confirmRestart, setConfirmRestart);
  const resumable = run.stepIndex > 0;
  /**
   * ...AND NOBODY ENDED IT. The Resume button stays on any run with a
   * position -- it is there for a mis-tapped Finish and that is worth keeping
   * -- but the spoken cue is a different claim. "The field test is paused"
   * said out loud, to someone who tapped Finish twice on purpose thirty
   * seconds ago, on a screen designed to be used without looking, is the app
   * being wrong about the one thing it is telling them.
   */
  const interrupted = resumable && run.endedAt === undefined;

  /**
   * ARRIVE AT THE TOP, and say so when there is something to come back to.
   *
   * This screen is reached from Settings, which is thousands of pixels tall
   * with the field-test row near the bottom, and nothing in the app resets the
   * scroll position when the screen changes. Measured, that put Resume under
   * the sticky topbar at 390x844 and off the screen entirely at 390x700 and
   * 360x740, leaving "Start over from step 1" as the first control a driver
   * could hit — the one button that discards the run.
   *
   * The cue is the other half. The gate is where an interrupted run lands
   * after a mid-drive reload, an answered phone call or a mis-tapped Pause; the
   * app simply stops talking, and on a screen designed to be used without
   * looking, silence is indistinguishable from the app having died.
   */
  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
    } catch {
      /* a browser that will not scroll must still show the gate */
    }
    if (!interrupted) return;
    // `run=` HERE TOO. The gate runs outside the running screen's ambient
    // context, so this and `condition-changed` were the two lines in the
    // protocol that could not be joined to the run they are about -- which is
    // the whole reason `run-start` and `run-resume` were given an explicit one.
    diag('test', 'gate-resumable', {
      run: run.runId,
      condition: run.condition,
      step: FIELD_TEST_STEPS[run.stepIndex]?.id,
      atStep: run.stepIndex,
    });
    chime('attention');
    void speakAsync('The field test is paused. Resume is the first button on the screen.', {
      interrupt: true,
    });
    // ONCE PER ARRIVAL. `run` changes when the picker is touched, and a driver
    // changing condition does not need to be told again where Resume is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fieldtest-screen" data-testid="fieldtest-screen">
      <header className="fieldtest-topbar">
        <button type="button" className="settings-back-btn" onClick={() => onNavigate('settings')}>
          ← Settings
        </button>
        <h1 className="fieldtest-heading">Field test</h1>
      </header>

      <div className="fieldtest-body">
      <p className="u-note">
        Every condition runs all {FIELD_TEST_STEPS.length} steps, including the wheel — what changes
        between them is the car, not the protocol. Pick where you are, press start, and it will talk
        to you. Nothing else needs to be running. When you are done, send the diagnostic log.
      </p>

      <div className="settings-row">
        <span className="settings-label">Where are you</span>
        <Segmented
          value={run.condition}
          options={FIELD_TEST_CONDITIONS.map((c) => ({ value: c.id, label: c.label }))}
          onChange={(value) => setFieldTestCondition(value)}
        />
      </div>

      <div className="settings-note-row u-note">
        <strong>Set up:</strong> {condition.setup}
        <br />
        <strong>Proves:</strong> {condition.proves}
      </div>

      {/*
        RESUME COMES FIRST when there is something to resume. A stored run is
        never restored as active (fieldTestRun.ts), so this screen is also
        where an interrupted run comes back -- after a mid-drive reload by the
        update check, after the app being swiped away, and after a mis-tapped
        Finish. Without it the only button was Start, which resets to step one
        and drops every stamp.
      */}
      {run.stepIndex > 0 && (
        <button
          type="button"
          className="fieldtest-stamp fieldtest-good"
          data-testid="fieldtest-resume"
          onClick={onResume}
        >
          Resume — step {run.stepIndex + 1} of {FIELD_TEST_STEPS.length}
        </button>
      )}

      {/*
        THE ONE THING THE CONDITION'S `motion` IS FOR, and until now it had no
        consumer at all: `motionForCondition` was exported, tested, and called
        by nothing, so the two driven conditions and the two parked ones
        rendered identically. Two of the four are driven, this gate is read
        with the eyes, and the run opens by seizing the volume and talking --
        so starting one at speed means setting up a twenty-three step protocol
        while moving, which is the one thing the whole eyes-free design exists
        to avoid.
      */}
      {motionForCondition(run.condition) === 'driving' && (
        <p className="u-note" data-testid="fieldtest-motion-warning">
          This condition is driven. Start it while you are still stopped — everything after this
          button is spoken, and the first thing it does is take over the volume.
        </p>
      )}

      {/*
        THE ONE RESET THE APP CANNOT PERFORM FOR ITSELF.

        Every leg measures where audio comes out, and the four legs run in one
        page. The app closes its own audio graph and lets go of the media slot
        when a run starts, but the phone's hands-free profile is not the app's
        to restart -- so from the second leg onward the cells labelled "before
        the microphone" run in a session that has already opened and closed it.
        The protocol's headline comparison is exactly that one, so this is the
        difference between a finding and a coincidence, and the only person who
        can do it is the one holding the phone. `run-start legsBefore=` records
        whether it was done.
      */}
      {fieldTestLegsThisSession() > 0 && (
        <p className="u-note" data-testid="fieldtest-session-warning">
          {`This page has already run ${
            fieldTestLegsThisSession() === 1 ? 'a leg' : `${fieldTestLegsThisSession()} legs`
          }. Force-quit the app and reopen it before this one, or its "before the microphone" steps are not before anything.`}
        </p>
      )}

      <button
        type="button"
        className={
          confirmRestart ? 'fieldtest-stamp fieldtest-finish-armed' : 'fieldtest-stamp'
        }
        data-testid="fieldtest-start"
        onClick={() => {
          if (!resumable || confirmRestart) {
            onStart();
            return;
          }
          setConfirmRestart(true);
          chime('attention');
        }}
      >
        {!resumable
          ? `Start — ${FIELD_TEST_STEPS.length} steps`
          : confirmRestart
            ? // NAMES WHAT IS ACTUALLY LOST. A run skipped through has nothing
              // stamped, and "discard 0 answered steps" reads as "this is
              // free" on the one button that is not.
              countStampedSteps(run.stamps, run.condition) > 0
              ? `Tap again to discard ${countStampedSteps(run.stamps, run.condition)} answered ${
                  countStampedSteps(run.stamps, run.condition) === 1 ? 'step' : 'steps'
                }`
              : `Tap again to go back to step 1 of ${FIELD_TEST_STEPS.length}`
            : 'Start over from step 1'}
      </button>

      <ol className="fieldtest-steps">
        {FIELD_TEST_STEPS.map((step) => (
          <li className="fieldtest-step" key={step.id}>
            <div className="fieldtest-instruction">
              {/*
                THE TICK, which `markFieldTestStamped` has always claimed to be
                for -- "so a step done at a red light is visibly done when you
                next look at the screen, and so a double-tap is visibly two
                rather than silently one". Nothing rendered it, so neither was
                true: the only readout of a run's progress was the step
                counter, which moves for a skip exactly as it does for an
                answer. Counted for THIS condition, because a step answered in
                the car park is not done on the freeway.
              */}
              {stampsFor(run, step.id) > 0 && (
                <span className="fieldtest-tick" data-testid={`fieldtest-tick-${step.id}`}>
                  {stampsFor(run, step.id) > 1 ? `\u2713\u00d7${stampsFor(run, step.id)}` : '\u2713'}{' '}
                </span>
              )}
              {step.title}
            </div>
          </li>
        ))}
      </ol>
      </div>
    </div>
  );
}

function RunningTest({
  run,
  conditionLabel,
  settings,
  onSettingsChange,
  onNavigate,
}: {
  run: FieldTestRun;
  conditionLabel: string;
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
  onNavigate: (screen: Screen) => void;
}) {
  const step = FIELD_TEST_STEPS[Math.min(run.stepIndex, FIELD_TEST_STEPS.length - 1)]!;
  // ORDERED FOR THE CONDITION BEING RUN. Under `speakerphone` the car is
  // not in the audio path at all, so every wheel step's only honest answer
  // is "No Bluetooth" — and it sat fifth, under four answers about what
  // the car did. See `stepResponses`.
  const responses = useMemo(() => stepResponses(step, run.condition), [step, run.condition]);
  const [wheelSeen, setWheelSeen] = useState<string[]>([]);
  /**
   * Observations armed on this step that are true alongside its answer.
   *
   * See `StepResponse.modifier`. Cleared on every step change, because a mark
   * describes one utterance or one pair of presses and carrying it forward
   * would attribute it to a step the operator never made it about.
   */
  const [marks, setMarks] = useState<string[]>([]);
  /** This browser cannot receive transport buttons at all. */
  const [wheelUnavailable, setWheelUnavailable] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  const [ambient, setAmbient] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  // See `useArmedFor`: the step effect disarms this, and two ordinary actions
  // never change the step.
  useArmedFor(confirmFinish, setConfirmFinish);
  /** Trips on unmount, so a reading in flight is discarded rather than set. */
  const measureRun = useRef(0);
  /**
   * The in-flight ambient measurement, so leaving the step can actually stop it.
   *
   * `measureRun` only fences the RESULT. The five-second getUserMedia loop ran
   * on regardless, and the `finally` that stops the tracks could not fire until
   * it finished -- so an answer or a Pause tapped mid-measurement left the
   * microphone open across the next step, with the orange indicator lit and the
   * car held in its hands-free profile. On this screen that is not just a
   * privacy surprise: the open microphone is the variable under test.
   */
  const measureAbort = useRef<AbortController | null>(null);
  /** Which voice spoke each line of this step, as the app itself decided it. */
  const [paths, setPaths] = useState<SpeechPathRecord[]>([]);
  /**
   * Which run of `say()` is the current one.
   *
   * Two can overlap -- StrictMode re-invokes the step effect in dev, and the
   * operator can tap "Say it again" over a line still playing. Without this
   * both runs append to `paths`, and the screen reports a one-line step as
   * having spoken twice, which reads as the app stuttering.
   */
  const sayRun = useRef(0);
  /**
   * Whether the microphone should be open, carried across steps.
   *
   * THE BUG THIS REPLACES was `enabled: step.setup?.voice === true`, which
   * read the CURRENT step's optional setup. Only `mic-route` declares it, so
   * the recogniser tore down the instant the operator advanced -- and the two
   * steps after it are `mic-heard` ("say one answer out loud") and
   * `wheel-with-mic` ("microphone still on ... this is expected to FAIL").
   * Both ran with the microphone shut. `mic-heard` could only ever be
   * answered "It never heard me", and `wheel-with-mic` would SUCCEED and be
   * logged as evidence against the hands-free hypothesis -- a false negative
   * on the app's central theory, produced by the instrument.
   *
   * The protocol expresses "leave it as it was" by omission, so the runner
   * has to read omission as carry-forward, not as off.
   */
  const [voiceWanted, setVoiceWanted] = useState(false);
  /**
   * A MEASURED line is playing — not merely that the app is talking.
   *
   * `speaking` covers every utterance the screen produces, the read-aloud
   * instruction included, and the wheel block needs that: an arrival has to say
   * whether anything was coming out at the time. What it must NOT do is decide
   * whether the answers work. An answer is about the utterance being sampled,
   * so it is held back while one plays; the instruction is not a sample, and on
   * the six steps that speak nothing else the instruction is the only audible
   * output there is. `free` reads for about ten seconds and its instruction is
   * literally "stamp it the moment it happens", which was exactly the ten
   * seconds its stamp buttons were dead.
   */
  const [sampling, setSampling] = useState(false);
  /**
   * Whether anything is playing at all, readable synchronously.
   *
   * A REF AND NOT STATE, because nothing renders from it: the media-session
   * probe fires from outside React and has to record the value at the instant
   * of the press, which is the one fact the export cannot reconstruct
   * afterwards, and that is the whole use. What the screen renders from is
   * `sampling` — the narrower fact, and the one that decides whether the
   * answers work.
   */
  const speakingRef = useRef(false);
  const setSpeaking = useCallback((next: boolean) => {
    speakingRef.current = next;
  }, []);
  /**
   * The step is not ready, and the reason is not that it is talking.
   *
   * `speaking` was the only thing disabling the answers, and it is set only
   * when the step HAS a line. `wheel-with-mic` has none and waits up to ten
   * seconds for the recogniser, so its answers were live for the whole wait and
   * "the wheel with the microphone open" could be answered with the microphone
   * shut. Kept separate from `speaking` rather than folded into it because the
   * operator is told which one it is: "Speaking..." during a line is true, and
   * during the gate it is a lie about the one thing the step is measuring.
   */
  const [waitingForMic, setWaitingForMic] = useState(false);

  // The settings are read inside effects that must not re-run when an
  // unrelated setting changes, so the latest copy lives in a ref.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /**
   * What the operator had before the run started, so it can be given back.
   *
   * Steps write real, persisted settings -- volume, wheelMode, audioEnabled,
   * useClips, muted -- through `saveSettings`. Nothing ever restored them, so
   * a completed run left the phone at `volume: 1.5` and `wheelMode: 'answer'`
   * for good: the operator's next drill ran at 150% with the wheel in the
   * wrong mode, for reasons that have nothing to do with the drill. Leaving
   * mid-run was worse -- whatever partial state the last step imposed is what
   * they kept, including `useClips: false` if they stopped anywhere in the
   * three TTS route steps, which silently disables the recorded voice
   * everywhere.
   *
   * Captured in a ref on the first render and never updated, so it survives
   * every step's writes.
   */

  /**
   * Whether the recogniser is actually live, for the steps that must wait.
   *
   * Through a ref because `say()` is async and polls it across awaits; putting
   * it in the effect's dependencies would restart the utterance every time the
   * recogniser changed state, which is the opposite of waiting for it.
   */
  const listeningRef = useRef(false);
  /**
   * When the app last stopped reporting `listening`, and `null` before it ever
   * has.
   *
   * WHY A CLOCK AT ALL. The four post-microphone cells exist to separate two
   * explanations of a route that moved: the phone comes back on a timer, or it
   * comes back when something else happens. That is a question about elapsed
   * time — and until this ref existed, elapsed time was the one quantity the
   * export did not carry. Four samples at 1.5s, 9s, 20s and 31s after the
   * microphone let go are a curve that answers it; the same four samples with
   * no clock on them read as "the route alternated", which answers nothing.
   *
   * HONEST ABOUT WHAT IT TIMES, for the same reason `appLetGoAfterMs` was
   * renamed: this is when the RECOGNISER stopped saying `listening`, which is
   * the app letting go. The phone releases the hands-free link some unexposed
   * time later. So every field derived from it is named after the app, and a
   * reading taken 1.5s after it is not a reading 1.5s after the car switched
   * back — it is 1.5s after the last moment either side of the browser can
   * see.
   *
   * `null` is meaningful: it says the microphone has not been up in this page
   * yet, which is exactly the before-microphone half of the 2x2. Those cells
   * export no offset rather than a zero that would average in.
   */
  const micClosedAtRef = useRef<number | null>(null);
  /**
   * When the recogniser last restarted itself, which is not the same event.
   *
   * iOS ends a webkit recognition session after every utterance and
   * `voiceControl.ts` starts a new one from `onend`. That edge used to be
   * written into `micClosedAtRef`, so mic-OPEN samples exported an offset
   * documented as "how long after the app let go".
   */
  const micChurnAtRef = useRef<number | null>(null);
  /**
   * The offset the CURRENT step's first line went out at, kept for the stamp.
   *
   * The answer row is what the analysis is read from, and the operator answers
   * seconds after the line — so their tap's own timestamp is a measure of
   * how fast they reached the button, not of when the sample was taken. This
   * carries the utterance's offset onto the answer instead.
   */
  const stepMicOffsetRef = useRef<number | null>(null);
  /**
   * How many wheel presses this leg has seen, counting this one.
   *
   * The wheel block has to separate "the microphone took the wheel" from "the
   * media slot lapses after a handful of presses". Those differ in press ORDER,
   * and the order was recoverable only by counting `field-test-arrival` lines
   * by hand through a log that runs to a thousand entries — in a car park, on
   * a phone. The count is a fact the screen already holds, so it goes on the
   * line.
   *
   * Per leg, not per step: the quantity the hypothesis is about is how many
   * presses the car has been asked for since the run began.
   */
  const pressCountRef = useRef(0);
  const voiceStatusRef = useRef('off');
  const changeRef = useRef(onSettingsChange);
  changeRef.current = onSettingsChange;

  /** Put back everything the run changed. Safe to call twice. */
  const restoreSettings = useCallback(() => {
    // THE RUN'S OWN RECORD FIRST, this screen's snapshot only as a fallback.
    //
    // The stored snapshot is what was true before step one, and it survives
    // every reload, pause and resume. Falling back to the live settings covers
    // only a run begun by a build that did not record one.
    const stored = fieldTestBefore();
    // THE LIVE SETTINGS, not the first-render snapshot.
    //
    // Everything outside the five fields the protocol writes is carried over
    // from here, and `restoreRef` is frozen at this component's first render.
    // App.tsx re-reads settings whenever another tab writes them, so a tab that
    // changed the theme, the speech rate, the voice or any other drill setting
    // during a run had that change reverted the moment the run ended -- the
    // stale whole-blob writeback `crossTab.ts` exists to prevent, reintroduced
    // by the fix for the volume bug. The run's own `before` supplies every
    // field the protocol touches, so the frozen blob bought nothing.
    // NOTHING OWED, NOTHING WRITTEN.
    //
    // There used to be a fallback here that wrote `settingsRef.current` back
    // whole when no snapshot existed. Every path that starts or resumes a run
    // records one, so the fallback could only fire on a SECOND restore of the
    // same run — and by then the blob was stale, so it undid the restore that
    // had just succeeded. That is how a run came to hand back `useClips: true`
    // when the operator's own value was `false`.
    //
    // UNREACHABLE BY CONSTRUCTION, and deliberately not pretended otherwise.
    // `startFieldTestRun` always records a snapshot, Resume re-takes one when
    // the stored one is unreadable, and an external write to the run record is
    // read back as INACTIVE, so there is no way to be on this screen with a
    // run that owes nothing. The three store-level invariants that make that
    // true are pinned in fieldTestRun.test.ts ("a snapshot that has been handed
    // back"); this branch is the backstop for a fourth path someone adds later,
    // and it fails LOUDLY in the export rather than quietly writing a guess.
    if (!stored) {
      diag('test', 'settings-restore-skipped', { why: 'nothing recorded' });
      return;
    }
    /**
     * ONCE PER RUN. `finish()` restores and then navigates, which unmounts
     * the screen, which schedules the deferred teardown -- and nothing
     * remounts to cancel it, so the commonest exit in the protocol restored
     * twice: two `saveSettings`, two writes into App, two `storage` events to
     * other tabs, and two `settings-restored from=run` lines in the artefact.
     * The values were identical by then, so the only visible damage was in
     * the export -- and the test that pins "exactly one restore" ran through
     * Pause, the one exit where it already held.
     *
     * `beforeHandedBack` already records this exactly. Marked rather than
     * deleted, so a genuine second restore after a Resume still works: Resume
     * re-takes the snapshot and un-marks it.
     */
    if (unspentFieldTestBefore() === undefined) {
      diag('test', 'settings-restore-skipped', { why: 'already handed back' });
      return;
    }
    const snapshot = settingsRef.current;
    const before: Settings = {
      ...snapshot,
      audio: {
        ...snapshot.audio,
        volume: stored.volume,
        useClips: stored.useClips,
        muted: stored.muted,
        enabled: stored.enabled,
      },
      drill: { ...snapshot.drill, wheelMode: stored.wheelMode },
    };
    saveSettings(before);
    changeRef.current(before);
    settingsRef.current = before;
    setClipsEnabled(before.audio.useClips);
    setClipVoice(before.audio.clipVoice);
    // Session state, not settings, and both were left on: eyes-free survives
    // until relaunch and the microphone holds the car in its hands-free
    // profile.
    setEyesFreeOn(false, 'field-test');
    setVoiceOn(false, 'field-test');
    // SPENT, not deleted. It has been handed back, so it no longer describes
    // anything owed -- and leaving it unmarked made the NEXT run start from a
    // snapshot taken before the operator's last change, then write that change
    // away at the end of it. Deleting it instead broke restoring twice over;
    // see markFieldTestBeforeHandedBack. A reload never reaches this line,
    // which is what keeps the mid-drive-reload case (the reason the snapshot is
    // preferred at all) working.
    markFieldTestBeforeHandedBack();
    diag('test', 'settings-restored', {
      from: 'run',
      volume: before.audio.volume,
      useClips: String(before.audio.useClips),
      muted: String(before.audio.muted),
    });
  }, []);


  /**
   * Say this step's lines, in order, through the real speech path.
   *
   * Sequential and awaited rather than fired together, and `interrupt` only on
   * the first: a second utterance started while the first is playing cancels
   * it, which on the two-line calibration step would mean the operator never
   * hears the clipped half they are being asked to compare against.
   *
   * Every line is bracketed in the log. speech.ts records WHICH PATH spoke
   * each one (clip or live TTS) between these two entries, which is the
   * pairing that makes the operator's route answer mean something.
   */
  const run_condition = run.condition;
  const say = useCallback(async (why: string) => {
    // BUMPED BEFORE THE EMPTY CHECK, not after. With the early return first, a
    // step that speaks nothing could not fence the previous step's in-flight
    // run -- so an orphaned continuation appended its path to the silent step
    // and the log recorded `wheel-gap`, which says nothing at all, as having
    // played a clip.
    const run = ++sayRun.current;
    const lines = [...(step.say ?? []), ...(step.sayUnclipped ? [step.sayUnclipped] : [])];
    // HELD BEFORE THE GATE, not after it. The gate can wait ten seconds, and
    // the answers are disabled on `speaking` -- so leaving this until after
    // would let the operator answer "where did it come from" during the
    // silence BEFORE the line they are answering about.
    if (lines.length > 0) {
      setSpeaking(true);
      setSampling(true);
      setWaitingForMic(false);
    } else {
      // CLEARED ON ARRIVAL, not after the gate. The previous step sets
      // `speaking` true and its cleanup bumps the fence, so the `finally`
      // that would clear it never fires -- a silent step therefore inherited
      // `speaking: true` and sat there reading "Speaking..." with the answers
      // dead for a reason that had stopped being true one step ago. It also
      // made the mic gate LOOK like it was blocking the answers when it was
      // not: a test asserting they were disabled on `wheel-with-mic` passed on
      // the stale flag alone, and removing the gate's own block left it green.
      setSpeaking(false);
      setSampling(false);
      // ...AND THE OTHER REASON, for the step that has no line to hold it. Both
      // together are what the answer stack is disabled on, so a step waiting
      // for the microphone is as unanswerable as a step that is still talking.
      setWaitingForMic(step.awaitListening === true);
    }

    // THE ARRIVAL CUE COMES FIRST, ahead of the gate rather than after it.
    //
    // Six steps declare no line at all, and the previous step's cleanup
    // cancels whatever was still playing, so arriving at one of them is total
    // silence -- which at the wheel is indistinguishable from the app having
    // died. That is what this chime is for. Below the gate it fired up to ten
    // seconds late, and measured headless it was 9,998ms of dead air on
    // `wheel-with-mic`: the cue arrived long after the operator had already
    // drawn the conclusion it exists to prevent.
    //
    // ...AND ON EVERY GATED STEP, not only the silent ones. The first version
    // of this fix chimed when there was no line at all, which left the defect
    // in place on the five steps that have a line AND a gate: `mic-route` and
    // its pair wait up to ten seconds for the recogniser, `route-after-mic`
    // waits for it to let go, and all of that is dead air the operator cannot
    // distinguish from the app having stopped. Those are also the steps where
    // being unsure costs most, because the operator is waiting to place a
    // sound they have not heard yet.
    //
    // BEFORE the gate rather than after it, which also keeps it honest: with
    // one to ten seconds between the cue and the measured utterance, the chime
    // is not the output immediately preceding the sample, so it cannot be what
    // the sample is measuring.
    /**
     * ...AND ON EVERY MEASURED ROUTE STEP, which is the half that made the
     * cue a confound instead of a courtesy.
     *
     * Only the gated steps chimed, and only the gated steps then sat through
     * `HFP_SETTLE_MS` of silence before speaking. Every one of those is a
     * post-microphone or mic-open sample. So the six cells of the 2x2 differed
     * not only in the factor under test but in their acoustic run-up: the
     * before-microphone samples went out about 100ms after the previous
     * answer's chime, and the after-microphone ones after a chime plus a
     * second and a half of nothing. A route answer is a judgement about a
     * sound in a stream of sounds, and the stream was correlated with the
     * independent variable.
     *
     * So every sample now gets the same run-up: a chime, then a fixed silence,
     * then the line. See `PRE_SAMPLE_SETTLE_MS`.
     */
    const measured = lines.length > 0 && step.responses.some((r) => r.kind === 'route');
    if (lines.length === 0 || step.awaitListening || step.awaitSilent || measured) chime('good');

    /**
     * WAIT FOR THE MICROPHONE TO BE LIVE, on the steps that say they need it.
     *
     * `setVoiceOn` only flips a flag; the recogniser then has to mount, call
     * getUserMedia and reach `listening`. On the 2026-09-23 drive that took
     * 3497ms, and the step spoke 7ms in -- so the utterance the operator was
     * asked to place went out while the car was still on A2DP, and the answer
     * was filed as "with the microphone open". The one utterance that did land
     * after the flip belonged to a step that never asks about the route.
     *
     * ABOVE THE EMPTY-LINES RETURN, because a step can need the microphone
     * settled without speaking at all. `wheel-with-mic` declares
     * `awaitListening` and no lines: with the gate below the return it was
     * unreachable there, so the one wheel step that exists to be pressed
     * WITH the microphone open never waited, logged neither `mic-settled`
     * nor `mic-never-live`, and sampled whatever the car was doing a second
     * after arrival -- which on the 2026-09-23 drive was still A2DP. That is
     * the identical defect this gate was added to fix, on the other half of
     * the same question.
     *
     * Bounded, because a microphone that never starts (permission refused,
     * another app holding it) must not hang the protocol. On timeout the step
     * still speaks, and the log says the sample is not what it claims to be so
     * the analysis can discard it rather than believe it.
     */
    if (step.awaitListening) {
      const waitedFrom = Date.now();
      // SAID OUT LOUD, on the four steps that have a line AND a gate.
      //
      // The branch above only sets this when there are no lines, so
      // `mic-route`, `mic-route-2`, `mic-route-t` and `mic-heard` -- every step
      // whose subject IS the open microphone -- sat reading "Speaking..."
      // through up to ten seconds of total silence. The answers were correctly
      // dead, so the guard held; what failed was the only thing telling the
      // operator WHICH kind of not-ready they were in, on a screen they are
      // told not to read and with nothing else to go on.
      setWaitingForMic(true);
      // ABANDONMENT IS AN OUTCOME, and it used to be an unrecorded one. The
      // loop's fence check returned straight out of `say()`, ahead of the diag
      // below -- so an answer tapped during the wait (which was possible at
      // all only because the stack was live, fixed above) stamped the step with
      // nothing saying whether the microphone had ever come up. A sample whose
      // conditions are unknown has to be discardable by the analysis, and that
      // means the log has to admit it.
      let abandoned = false;
      try {
        while (!listeningRef.current && Date.now() - waitedFrom < MIC_SETTLE_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 100));
          if (sayRun.current !== run) {
            abandoned = true;
            return;
          }
        }
      } finally {
        const waitedMs = Date.now() - waitedFrom;
        const live = listeningRef.current;
        diag('test', live ? 'mic-settled' : 'mic-never-live', {
          step: step.id,
          waitedMs,
          state: voiceStatusRef.current,
          ...(abandoned ? { abandoned: true } : {}),
        });
        if (!live && !abandoned) {
          setAmbient(
            'The microphone never came up, so this step measures the state WITHOUT it — treat the answer accordingly.',
          );
        }
      }
      setWaitingForMic(false);
    }

    /**
     * WAIT FOR THE MICROPHONE TO BE DOWN, on the steps that say they need it.
     *
     * The closing edge of the same defect the gate above fixes, on the more
     * important half of the comparison. `route-after-mic` was the protocol's
     * only post-microphone sample, its answer WAS the headline conclusion, and
     * it was taken during the teardown: the step effect calls
     * `setVoiceOn(false)` and then `say()` in one synchronous body, so the
     * line went out roughly 7ms after the app asked for the microphone back.
     * "The microphone is shut again" -- printed on the screen, and assumed by
     * every reading of the answer -- was a claim nothing had checked.
     *
     * Two waits, because they are two different facts. The first is bounded
     * polling for the recogniser to stop reporting `listening`, which is the
     * app letting go. The second is a fixed settle for the phone to release
     * the hands-free link afterwards, which no browser API exposes at all --
     * so it is a declared number, logged with the sample, and a drive whose
     * route still moves can tell whether it was simply too short.
     */
    if (step.awaitSilent) {
      const waitedFrom = Date.now();
      // WAS THE RECOGNISER EVEN UP? Recorded, because it is the only part of
      // this gate that is a fact rather than a timer -- see the `finally`.
      const wasLive = listeningRef.current;
      // Same flag as the opening gate, deliberately. It reads "Waiting for the
      // microphone", which is true in both directions, and it is what the
      // answer stack is disabled on -- so the operator cannot answer "where
      // did it come from" about a line that has not been spoken yet.
      setWaitingForMic(true);
      let abandoned = false;
      let stoppedAfterMs: number | null = null;
      try {
        while (listeningRef.current && Date.now() - waitedFrom < MIC_RELEASE_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 100));
          if (sayRun.current !== run) {
            abandoned = true;
            return;
          }
        }
        if (!listeningRef.current) stoppedAfterMs = Date.now() - waitedFrom;
        const settleUntil = Date.now() + HFP_SETTLE_MS;
        while (Date.now() < settleUntil) {
          await new Promise((r) => setTimeout(r, 100));
          if (sayRun.current !== run) {
            abandoned = true;
            return;
          }
        }
      } finally {
        /**
         * ALWAYS WRITTEN, abandoned or not, for the reason the opening gate
         * gives: a sample whose conditions are unknown has to be discardable by
         * the analysis, and that means the log has to admit it.
         *
         * AND HONEST ABOUT WHAT IT MEASURED, which the first version was not.
         * `useVoiceControl`'s cleanup calls `controller.stop()` and then
         * `setStatus(IDLE)`, and `stop()` itself ends with `setState('off')` --
         * both synchronous. So `listeningRef` goes false within one render of
         * the flag flipping, BEFORE the recogniser has done anything and long
         * before the phone releases the hands-free link. The first wait
         * therefore always exited on its first 100ms tick (measured:
         * `stoppedAfterMs=110`, exactly one interval), `MIC_RELEASE_TIMEOUT_MS`
         * was unreachable, and a field documented as "how long the recogniser
         * took to let go" was reporting how long React took to re-render. A
         * test asserting the entry appears could not fail.
         *
         * So the field is renamed to what it is, and the entry says plainly
         * that the wait is a declared one. Nothing in the browser exposes the
         * HFP release; pretending otherwise is worse than admitting it.
         */
        const live = listeningRef.current;
        diag('test', live ? 'mic-still-live' : 'mic-stopped', {
          step: step.id,
          // How long until the APP stopped reporting `listening`. This is a
          // React round trip, not a fact about the microphone -- the name says
          // so now, because the old one claimed the opposite.
          appLetGoAfterMs: stoppedAfterMs ?? undefined,
          // Whether the recogniser was up at all when this step opened. A
          // `false` here means the gate had nothing to wait for and the sample
          // is not "after the microphone" in any meaningful sense.
          wasLive,
          waitedMs: Date.now() - waitedFrom,
          // The only part of the wait that is doing real work, and a DECLARED
          // number rather than an observation. A drive whose route still moves
          // can say whether it was simply too short.
          settleMs: HFP_SETTLE_MS,
          state: voiceStatusRef.current,
          ...(abandoned ? { abandoned: true } : {}),
        });
        if (live && !abandoned) {
          setAmbient(
            'The microphone was still live when this line played, so this step is NOT the microphone-shut condition it says it is — treat the answer accordingly.',
          );
        }
      }
      setWaitingForMic(false);
    }
    /**
     * ABOVE THE SILENT-STEP RETURN, which is where it belonged all along.
     *
     * The previous step's offset must not be stamped onto this one's answer.
     * This sat BELOW the early return, so it never ran on a step with no
     * line, and nothing in the step effect cleared it either — so
     * `wheel-after-mic`, the step added specifically to separate "the
     * microphone took the wheel" from "the media slot lapsed", exported the
     * offset of `route-after-mic-3`, taken however long the operator spent
     * answering in between. `ambient` and `free` inherited
     * `route-after-mic-3t`'s.
     *
     * A step that speaks overwrites it below; a step that does not speak has
     * no utterance of its own, and now exports none.
     */

    /**
     * THE SAME SILENCE BEFORE EVERY SAMPLE, whatever gate it came through.
     *
     * `awaitSilent` steps already waited `HFP_SETTLE_MS` for the hands-free
     * link to come down, and that wait doubled as their run-up. The steps
     * with no gate had none at all. This gives the ungated route samples the
     * same one, so the interval between the arrival chime and the measured
     * utterance is a constant of the protocol rather than a property of
     * whichever cell a step happens to be in.
     *
     * Logged, because it is part of the conditions of the sample: a reader
     * comparing two cells can check that both got it.
     */
    if (measured && !step.awaitSilent) {
      const settleUntil = Date.now() + PRE_SAMPLE_SETTLE_MS;
      diag('test', 'pre-sample-settle', { step: step.id, settleMs: PRE_SAMPLE_SETTLE_MS });
      while (Date.now() < settleUntil) {
        await new Promise((r) => setTimeout(r, 100));
        if (sayRun.current !== run) return;
      }
    }
    stepMicOffsetRef.current = null;
    if (lines.length === 0) {
      // CLEARED on the way out. The previous run's `finally` guard is already
      // false by the time it fires (the fence was bumped above), so arriving
      // at a silent step -- `wheel-back`, `wheel-other`, `wheel-repeat`,
      // `free` -- left `speaking` true until the next step that spoke.
      setSpeaking(false);
      setSampling(false);
      setWaitingForMic(false);
      // ...AND THE INSTRUCTION, SPOKEN. The protocol forces eyes-free on from
      // step one and never unsets it, then puts all 22 steps' instructions in
      // print -- so the mode that means "you should not be reading this" is
      // exactly the mode the operator must read in. Spoken only where there
      // is no measurement utterance to confound: on a step that samples the
      // route or the voice, a TTS line immediately before the sample could
      // itself move the audio session, and then the answer would be about the
      // wrong thing. Those steps keep their printed instruction and the
      // on-demand button below.
      void speakInstruction();
      return;
    }

    // CLIPS ON, HERE, BEFORE ANYTHING IS SAID.
    //
    // `clips.ts` keeps the enabled flag in module state, and the only things
    // that ever set it are `useAudio` (which the drills and the table call)
    // and the Settings toggle. This screen calls neither -- so until
    // 2026-09-23 the one screen whose entire purpose is to exercise the clip
    // path ran with clips OFF, and every utterance it produced fell back to
    // live speechSynthesis. A whole drive's worth of route answers would have
    // been measured against the fallback voice while the step said it had
    // turned the recorded voice on. Caught by the audio-mode e2e, which is
    // the only harness that gets far enough to choose a path at all.

    const audio = settingsRef.current.audio;
    // Awaited, not fired: the gate in speech.ts is synchronous, so an unwarmed
    // manifest silently costs the first line of every step -- which here is
    // usually the only line.
    if (audio.useClips) await prewarmClips();
    if (sayRun.current !== run) return;

    // WHICH BRACKET IS OPEN, so the `finally` can close it. See `say-cancelled`.
    let openTag: string | null = null;
    try {
      for (const [i, text] of lines.entries()) {
        // RE-CHECKED EVERY ITERATION. `cancelSpeech()` settles the awaited
        // promise rather than rejecting it, so cancelling made this loop
        // ADVANCE instead of stop: an answer tapped during line 1 of a
        // two-line step left the second line speaking over the next step and
        // writing that step's name into the wrong bracket.
        if (sayRun.current !== run) return;
        const tag = `${step.id}#${i + 1}`;
        openTag = tag;
        // MEASURED AT THE LINE, not at the answer. See `micClosedAtRef`.
        const sinceMic =
          micClosedAtRef.current === null ? undefined : Date.now() - micClosedAtRef.current;
        if (i === 0) stepMicOffsetRef.current = sinceMic ?? null;
        diag('test', 'say-start', {
          step: step.id,
          condition: run_condition,
          // How long after the app let go of the microphone this line went out.
          // Absent on every cell before the microphone has been up at all,
          // which is the distinction the 2x2 is built on.
          msSinceAppLetGo: sinceMic,
          tag,
          text,
          why,
          line: i + 1,
          of: lines.length,
          volume: effectiveVolume(settingsRef.current.audio),
        });
        const seqBefore = lastSpeechPath()?.seq ?? 0;
        try {
          await speakAsync(text, {
            interrupt: i === 0,
            rate: settingsRef.current.audio.rate,
            voiceURI: settingsRef.current.audio.voiceURI,
            volume: effectiveVolume(settingsRef.current.audio),
            tag,
          });
          if (sayRun.current !== run) return;
          // WHICH VOICE SPOKE IT, taken from the app rather than from the
          // operator. speech.ts decides this and records it; the protocol used
          // to ask anyway, which is a question that cannot produce information.
          // MATCHED ON `tag`, with `seq` as the tiebreak. `for === text` was
          // not enough: `repeatLast()` re-speaks the identical string, so a
          // stray skip-back press between the await resolving and this read
          // leaves a record that passes both the text test and `seq >
          // seqBefore`, and its path -- taken at a different moment, possibly
          // down a different branch -- gets stamped as this line's evidence.
          // The tag is unique per step per line and rides onto the record, so
          // it names this utterance and nothing else; `repeatLast` pointedly
          // does not carry it forward. `seq` still guards the case the tag
          // cannot: the same step spoken again after a Back, whose earlier
          // record carries the same tag.
          const record = lastSpeechPath();
          const mine = record !== null && record.tag === tag && record.seq > seqBefore;
          if (mine && sayRun.current === run) {
            setPaths((prev) => [...prev, record]);
          }
          diag('test', 'say-end', {
            step: step.id,
            condition: run_condition,
            tag,
            text,
            // Unmatched is reported, not silently omitted: a missing path and
            // a path that belonged to someone else are different faults.
            path: mine ? record.path : undefined,
            why: mine ? record.why : undefined,
            partial: mine ? record.partial : undefined,
            matched: mine,
          });
          openTag = null;
        } catch (e) {
          diag('test', 'say-failed', {
            step: step.id,
            text,
            why: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      if (sayRun.current === run) {
        setSpeaking(false);
        setSampling(false);
        setWaitingForMic(false);
      }
      if (openTag !== null) {
        /**
         * AN INTERRUPTED LINE SAYS SO, and it used to say nothing at all.
         *
         * The loop returns on a fence bump before `say-end`, and Back, Skip,
         * Pause, Finish and "Say it again" are all live while a line plays --
         * so every one of those left a `say-start` with no `say-end`.
         * Reproduced in a single run: ten `say-start`, eight `say-end`.
         *
         * That unclosed bracket is the signature of a stalled clip or a
         * `speechSynthesis` that never fired `end`, which is a live hypothesis
         * the log is meant to test. Ordinary operator actions were
         * manufacturing it, and on the TTS path there is no `clip-end
         * reason=stopped` to rescue the reading.
         */
        diag('test', 'say-cancelled', {
          step: step.id,
          condition: run_condition,
          tag: openTag,
          why: sayRun.current === run ? 'threw' : 'left-the-step',
        });
      }
    }
  }, [
    step.id,
    step.say,
    step.sayUnclipped,
    step.awaitListening,
    step.awaitSilent,
    run_condition,
    setSpeaking,
  ]);

  /**
   * Stamp the run and the step onto EVERY entry, not just the `test` ones.
   *
   * Without this, `speak path`, `speak clip-end`, `wheel dispatch`, `focus *`
   * and `route *` carry no step, no condition and no run -- so a clip that
   * broke could be attributed to the step that caused it only by adjacency in
   * the file, and adjacency is precisely what the async `.then()` in clips.ts
   * and the interleaved heartbeat break. Cleared on the way out so entries
   * from an ordinary drill are not filed under a field-test run that ended.
   *
   * DECLARED BEFORE THE STEP EFFECT, and that is load-bearing rather than
   * tidiness. React destroys EVERY cleanup for a commit before it runs ANY
   * create function, so with this declared after the step effect the order on
   * each step change was: step cleanup, context cleanup, step BODY, context
   * re-set. Everything the step effect emits synchronously -- `step-open`,
   * `step-setup`, `focus hold`, and on the clips-off steps the whole of
   * `say()` including `say-start` and `speak path` -- therefore carried no
   * run, no step and no cond at all. Not stale values: none.
   *
   * Worse, the loss was systematic along the protocol's independent variable.
   * `say()` awaits `prewarmClips()` only when clips are ON, so the clip steps
   * yielded long enough for this effect to land and the TTS steps did not --
   * meaning the entire TTS arm of the 2x2, the half the protocol was
   * restructured to add, was the half that lost its `run=`. Declared first,
   * the context is re-established before the step effect body runs.
   */
  useEffect(() => {
    // `condition`, NOT `cond`. The step entries passed `condition` explicitly
    // and this passed `cond`, so a `test` row carried both while every
    // `speak`, `wheel`, `focus`, `route` and `mic` row carried only the short
    // one -- and `grep condition=freeway` in a car park returned the answers
    // and the step-opens and none of the evidence underneath them.
    //
    // NOTHING IS CLEARED HERE. See the effect below the step effect.
    setDiagContext({ run: run.runId, step: step.id, condition: run.condition });
  }, [run.runId, run.condition, step.id]);

  /**
   * Arriving at a step: apply its setup, clear the last step's evidence, log
   * the entry, and say its line.
   *
   * Keyed on the step id rather than the object so that re-rendering for a
   * tapped answer does not make the app say the line again -- which in a car
   * reads as the app having lost its place.
   */
  useEffect(() => {
    setWheelSeen([]);
    setHeard([]);
    // A mark describes ONE utterance or ONE pair of presses; carrying it into
    // the next step would file it against something the operator never saw.
    setMarks([]);
    setAmbient(null);
    setPaths([]);
    /**
     * ...AND THE MEASURE BUTTON, which used to latch on forever.
     *
     * `measureWithWebAudio` RESOLVES normally when its signal is aborted -- the
     * loop condition is `signal?.aborted !== true`, there is no throw -- so an
     * abandoned measurement takes the success path back into `measure()`, hits
     * `if (measureRun.current !== mine) return;`, and never reaches the
     * `setMeasuring(false)` in the `finally`, which is fenced on the same check
     * that just failed. Nothing else reset it: this effect cleared the wheel,
     * the transcript, the ambient line and the paths, and `RunningTest` does
     * not remount between steps.
     *
     * In the car: tap "Measure the cabin" on `ambient`, tap an answer or Skip
     * inside the five seconds, come Back -- and the button reads "Listening..."
     * and is dead for the rest of the run. `ambient` is the one step that
     * cannot be done without it, and the only recovery is Pause and re-enter.
     */
    setMeasuring(false);
    // Disarmed on every step change, so a Finish armed and then abandoned
    // cannot fire on a later step from a single tap.
    setConfirmFinish(false);
    logFieldTestStep(step.id, run.condition, run.stepIndex);

    {
      /**
       * RESOLVED, not declared, and applied on EVERY step rather than only on
       * steps that declare something.
       *
       * A step's `setup` is a delta. Applying only the delta meant the
       * effective state depended on how the operator arrived: resuming at
       * `fallback-audible` ran its comparison at unity because the boost was
       * pinned six steps earlier; stepping BACK out of `mic-route` left the
       * microphone open across four wheel steps; and a stray tap on the mute
       * button silenced the rest of the run, because only step one ever said
       * `muted: false`. Folding the deltas forward makes the state a pure
       * function of the index, identical forward, back, resumed or remounted.
       */
      const resolved = resolveFieldTestSetup(run.stepIndex);
      const next = applyFieldTestSetup(settingsRef.current, resolved);
      saveSettings(next);
      changeRef.current(next);
      // THE PROTOCOL IS HOLDING THEM AGAIN, so the snapshot is owed again.
      //
      // Only ever true after the screen-close cleanup handed them back and
      // React put this screen straight back up; see markFieldTestBeforeOwed
      // for why that cleanup cannot tell such a remount from a real exit.
      markFieldTestBeforeOwed();
      // ...and into the ref IMMEDIATELY, not on the next render.
      //
      // `say()` is called a few lines below, in this same synchronous effect,
      // and it reads the ref to decide whether clips are on. React has not
      // re-rendered yet, so without this line the step speaks under the
      // settings from BEFORE it applied its own -- a step that turns the
      // recorded voice on and then immediately speaks in the fallback voice,
      // while the screen says it set the recorded voice.
      settingsRef.current = next;
      // Both default to OFF rather than carrying, so the absence of any
      // declaration up to this point means off -- the microphone especially.
      const wantsVoice = resolved.voice === true;
      setVoiceWanted(wantsVoice);
      setVoiceOn(wantsVoice, 'field-test');
      setEyesFreeOn(resolved.eyesFree === true, 'field-test');
      // Clips are module state in clips.ts, not settings, so they have to be
      // pushed separately -- and HERE, beside the rest of the setup, rather
      // than inside say(). In say() they were behind the "no lines" early
      // return, so a silent step never pushed them: stepping back from
      // `ambient` (which restores clips) into `route-tts-3` left clips ON for
      // a step whose instruction reads "the recorded voice is off for these
      // three", silently voiding that sample.
      setClipsEnabled(next.audio.useClips);
      setClipVoice(next.audio.clipVoice);
      // The RESOLVED state, so the log says what the step actually ran under
      // rather than what it happened to change.
      diag('test', 'step-setup', { step: step.id, ...resolved });
    }

    // The silent hold is what makes the phone treat this app as what is
    // playing, and therefore what makes the wheel reach it at all. Held for
    // the whole run, not per utterance: the 2026-09-19 fault was a press in
    // the SILENCE going to the radio, which is exactly the gap a per-utterance
    // hold would leave open.
    holdAudioFocus('speech');

    void say('step-open');

    return () => {
      // Bumping the fence is what makes the cleanup effective; cancelling
      // alone only settles the promise and lets the loop run on, which
      // could re-take the media hold seconds after the screen was gone.
      sayRun.current += 1;
      cancelSpeech();
      // ...AND THE STREAM IS CLOSED, not merely disowned. See `measureAbort`.
      measureAbort.current?.abort();
      // The ambient reading takes five seconds, and the operator can answer or
      // skip inside that window. Without this the reading resolved afterwards
      // and painted a cabin measurement into the NEXT step's evidence panel,
      // attributed on screen to a step that did not take it. The comment on
      // `measureRun` claimed this already happened; nothing bumped it.
      measureRun.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, run.condition]);

  /**
   * THE CONTEXT COMES DOWN AFTER THE STEP EFFECT, which is why this is here
   * rather than in the effect that sets it.
   *
   * React destroys every cleanup for a commit in declaration order, so with
   * the clear alongside the set -- declared first, deliberately, so the
   * context is installed before the step body runs -- the order on each step
   * change was: context cleared, THEN the step cleanup's `cancelSpeech()`.
   * Anything still playing therefore wrote `speak clip-end reason=stopped` or
   * `speak tts-end reason=cancelled` with no run, no step and no condition,
   * on Back, Skip, Pause and Finish, none of which are disabled while a line
   * is playing. The round-four fix covered the create phase and left the
   * destroy phase exactly as it was.
   *
   * Declared after the step effect, this cleanup runs after that one, so the
   * lines a teardown emits still name the step that emitted them.
   */
  useEffect(
    () => () => {
      setDiagContext({ run: undefined, step: undefined, condition: undefined });
    },
    [],
  );

  /**
   * KEEP THE SCREEN AWAKE FOR THE RUN, which this screen alone did not.
   *
   * Every drill view calls `requestWakeLock`, and so does `useVoiceControl`
   * while the microphone is live -- so the fifteen non-microphone steps of a
   * twenty-two step protocol ran with the display free to sleep on its
   * ordinary timer. A slept screen is a hidden page: timers throttle, the
   * ambient measurement's loop stalls, and the operator has to wake the phone
   * at every step, which is a glance and a tap they should not be spending at
   * the wheel. The protocol declares eyes-free on nearly every step, and
   * `eyesFreeSession` is a plain flag with no wake-lock wiring of its own.
   */
  useEffect(() => {
    void requestWakeLock('field-test');
    return () => {
      void releaseWakeLock('field-test');
    };
  }, []);

  /**
   * Let go of the media slot and the settings when the screen closes.
   *
   * DEFERRED BY A TICK, AND A REMOUNT TAKES IT BACK. React destroys a commit's
   * cleanups before running any of its create functions, and StrictMode
   * mounts every component twice in development — so this ran DURING run
   * start, between the two passes. The log of every dev run therefore opened
   * with `focus release`, `settings-restored from=run`, a second `focus hold`
   * and then `focus refused AbortError`: the run giving the operator their
   * volume back a millisecond after taking it, and the silent element's
   * `play()` aborted by the pause from a teardown that was never meant to
   * happen. All three lines are false, and they are the first thing anybody
   * reading a development export sees.
   *
   * The deferral is not a development-only trick. An unmount followed
   * immediately by a mount is the same event whoever caused it, and handing
   * the settings back only to seize them again is wrong in both: the window
   * between them is a window in which a crash leaves the protocol's volume
   * on the operator's phone.
   */
  const teardownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (teardownRef.current !== null) {
      clearTimeout(teardownRef.current);
      teardownRef.current = null;
    }
    return () => {
      teardownRef.current = setTimeout(() => {
        teardownRef.current = null;
        releaseAudioFocus('speech');
        // Leaving by the tab bar is the ordinary way out -- it is the lowest,
        // widest strip on the screen -- and it has to give the settings back
        // too, or an abandoned run costs the operator their volume and wheel
        // mode exactly as a completed one used to.
        restoreSettings();
      }, 0);
    };
  }, [restoreSettings]);

  /**
   * Capture whatever the car sends, for as long as a wheel step is showing.
   *
   * Until 2026-09-22 a wheel press reached only the media-session probe, which
   * is not part of the exported log -- so every press the operator ever made
   * was invisible to every diagnosis. Both ends are wired now: `mediaSession`
   * writes it to the log, and this puts it on the screen so the operator can
   * see, in the car, whether the press landed.
   */
  useEffect(() => {
    if (!step.wheel) return;
    /**
     * CLAIM THE CONTROLS FIRST, which this screen never did.
     *
     * `initMediaSession` runs from `announceToMediaSession`, which is on the
     * CLIPS path only -- registration rides along with the first clip. So the
     * screen built to test the wheel was arming a probe over a session that
     * might have no handlers on it at all, and there are two ordinary ways in:
     * a run resumed straight onto a wheel step (the protocol persists
     * position on purpose, and a wheel step is the seventh of twenty), and a
     * first line that found no clip and fell through to live TTS. In either
     * the operator presses the button, nothing arrives, and they answer
     * "Nothing happened at all" -- filing the instrument's own gap in the log
     * as the routing failure under investigation. The button tester already
     * calls this for the same reason (Settings.tsx); the field test did not.
     */
    const armed = ensureMediaSessionHandlers();
    if (!armed) {
      // The browser has no Media Session at all, so the wheel can never reach
      // this app here whatever the car does. Say so on screen rather than
      // letting the operator conclude it from silence.
      setWheelUnavailable(true);
      diag('test', 'wheel-unavailable', { step: step.id, condition: run.condition });
    } else {
      setWheelUnavailable(false);
    }
    setMediaSessionProbe((action) => {
      diag('wheel', 'field-test-arrival', {
        step: step.id,
        action,
        // WAS ANYTHING PLAYING WHEN IT ARRIVED.
        //
        // The wheel block is built as a contrast between pressing while the app
        // talks and pressing in the silence, and on the three steps that
        // declare no line of their own the app reads the INSTRUCTION aloud --
        // including the one whose instruction is "press skip-BACK on the wheel
        // once, in the silence". So the block's independent variable was
        // uncontrolled on half its steps, and nothing in the export said which
        // side of it a given press fell on. Read from the ref rather than the
        // state so it is the value at the instant of arrival.
        whileSpeaking: speakingRef.current,
        // WHICH PRESS OF THE RUN THIS IS. See `pressCountRef`.
        pressIndex: (pressCountRef.current += 1),
        // ...and how long after the microphone let go, absent before it has
        // been up at all. The same clock the route samples carry, so a press
        // and an utterance taken at the same point in the recovery can be read
        // against each other.
        msSinceAppLetGo:
          micClosedAtRef.current === null ? undefined : Date.now() - micClosedAtRef.current,
        // ...and how long after the recogniser last restarted itself, which is
        // a different event and used to be reported as this one. Present only
        // while the microphone is the thing being pressed against.
        msSinceMicRestart:
          micChurnAtRef.current === null ? undefined : Date.now() - micChurnAtRef.current,
      });
      setWheelSeen((prev) => [...prev, action]);
    });
    return () => setMediaSessionProbe(null);
  }, [step.wheel, step.id, run.condition]);

  const { status: voiceStatus } = useVoiceControl({
    enabled: voiceWanted,
    context: `field-test:${step.id}`,
    onAction: (action) => {
      diag('test', 'heard-action', { step: step.id, action });
      setHeard((prev) => [...prev, action]);
    },
    onTranscript: (text) => {
      diag('test', 'heard-text', { step: step.id, text });
      setHeard((prev) => [...prev, text]);
      return null;
    },
    onNotUnderstood: () => {
      diag('test', 'heard-unclear', { step: step.id });
      // AUDIBLE, as it is on every other screen that listens -- the count
      // drill, the true-count drills, Drills and the table all call
      // `ding('attention')` here. This screen printed "(not understood)" and
      // said nothing, so on `mic-heard` the operator speaks, hears silence,
      // and taps "It never heard me" -- which is the signature of the
      // hands-free microphone failure under investigation. The step then
      // manufactures the fault it exists to detect, by withholding the one
      // cue that distinguishes "it rejected what you said" from "it is not
      // listening at all".
      chime('attention');
      setHeard((prev) => [...prev, '(not understood)']);
    },
  });

  /**
   * Mirror the recogniser's reported state into refs that `say()` can poll.
   *
   * Written during render rather than in an effect: `say()` starts from the
   * step effect, which runs BEFORE a passive effect would have had a chance to
   * copy this, and the whole point of the gate is that it sees the truth at
   * the moment it starts waiting.
   */
  const nowListening = voiceStatus.state === 'listening';
  // THE EDGE, CAUGHT WHERE THE STATE IS READ. There is no event for the
  // recogniser going down -- `useVoiceControl` reports a state, and this line
  // is the only place the screen looks at it -- so the transition has to be
  // noticed by comparing against what was there before. Safe under repeated
  // renders: after the assignment below the two agree, so a re-render with the
  // same state is not a second edge.
  /**
   * ONLY WHEN THE STEP HAS STOPPED ASKING FOR THE MICROPHONE.
   *
   * `msSinceAppLetGo` is the spine of the recovery curve: four route samples
   * at roughly 1.5s, 9s, 20s and 31s after the microphone went down, read
   * against a `null` that means "before the microphone was ever up". The edge
   * this watches is `voiceStatus.state`, and on iOS the recogniser ENDS AFTER
   * EVERY UTTERANCE — `voiceControl.ts` restarts it from `onend` and
   * reports `restarting` in between, which its own comment describes as six
   * sessions and five restarts in one drill. So inside the microphone block,
   * which is eight steps long, this clock was being reset several times, and
   * `mic-route-2`, `mic-route-3` and the three TTS ones exported
   * `msSinceAppLetGo=850` on rows where the microphone was OPEN. The earliest
   * and most decisive region of the curve was filled with samples belonging to
   * the opposite cell of the 2x2.
   *
   * The declared setup is the right authority for "has the app stopped
   * asking": it is what `say()` gates on, what the screen prints, and what
   * the operator was told. A recogniser cycling mid-block is not the app
   * letting go of anything.
   */
  const stepWantsVoice = resolveFieldTestSetup(run.stepIndex).voice === true;
  if (listeningRef.current && !nowListening) {
    if (stepWantsVoice) {
      // A RESTART, NOT A CLOSE. Recorded rather than dropped: it is a real
      // event on the audio session, it is the reason this guard exists, and a
      // sample taken 200ms after a recogniser restart is worth being able to
      // find.
      micChurnAtRef.current = Date.now();
    } else {
      micClosedAtRef.current = Date.now();
    }
  }
  /**
   * CLEARED WHEN IT OPENS AGAIN, which the protocol does allow.
   *
   * The previous note said a leg turns the microphone on once and off once,
   * and that is true only of forward travel. `resolveFieldTestSetup` folds
   * setup forward in BOTH directions on purpose, so stepping Back from
   * `route-after-mic` into `wheel-with-mic` — one tap on a control that is
   * always enabled — turns it on again. Without this, every subsequent
   * sample reported an offset "after the microphone let go" measured while
   * the microphone was live, and `null` stopped meaning what the export says
   * it means.
   */
  if (!listeningRef.current && nowListening) {
    micClosedAtRef.current = null;
    micChurnAtRef.current = null;
  }
  listeningRef.current = nowListening;
  voiceStatusRef.current = voiceStatus.state;

  /** Measure the cabin, on the step that asks for it. */
  const measure = useCallback(async () => {
    // A second tap while the first five-second window is still open would
    // hold TWO getUserMedia streams at once -- on iOS, two live microphone
    // indicators for one measurement.
    const mine = ++measureRun.current;
    // ABORTED BY THE STEP CLEANUP, not merely ignored by it. Bumping
    // `measureRun` discarded the result; it could not close the stream, so the
    // microphone stayed open for the rest of the five seconds wherever the
    // operator had gone.
    measureAbort.current?.abort();
    const controller = new AbortController();
    measureAbort.current = controller;
    setMeasuring(true);
    setAmbient('listening…');
    try {
      const reading = await measureWithWebAudio(5000, controller.signal);
      const band = bandFor(reading.dbfs);
      diag('test', 'ambient', {
        step: step.id,
        dbfs: Number(reading.dbfs.toFixed(1)),
        peakDbfs: Number(reading.peakDbfs.toFixed(1)),
        band,
        frames: reading.frames,
      });
      if (measureRun.current !== mine) return;
      setAmbient(
        reading.frames === 0
          ? 'The microphone produced nothing at all — that is not a quiet room.'
          : `${reading.dbfs.toFixed(1)} dBFS (${band}). ${adviceFor(band)}`,
      );
    } catch (e) {
      const why = e instanceof Error ? e.name : String(e);
      diag('test', 'ambient-failed', { step: step.id, why });
      if (measureRun.current === mine) setAmbient(`The microphone could not be opened (${why}).`);
    } finally {
      if (measureAbort.current === controller) measureAbort.current = null;
      if (measureRun.current === mine) setMeasuring(false);
    }
  }, [step.id]);

  /**
   * Say this step's instruction, unclipped.
   *
   * `sayUnclipped`'s path: no phrase manifest covers prose, so this is live
   * TTS by construction. It is not part of any measurement -- nothing asks
   * the operator to judge where THIS came from -- so it is deliberately kept
   * off the steps that do measure.
   */
  const speakInstruction = useCallback(async (why: 'arrival' | 'asked' = 'arrival') => {
    // FENCED, HELD AND INTERRUPTING, exactly as `say()` is.
    //
    // This bumped nothing, set nothing and passed `interrupt: false`, so its
    // own button was never disabled and N taps queued N complete readings that
    // then talked over the operator for the rest of the step. On the six silent
    // steps this is the ONLY way to hear anything, so it is the control most
    // likely to be tapped twice by someone who is not looking at it.
    const run = ++sayRun.current;
    setSpeaking(true);
    // BRACKETED LIKE ANY OTHER UTTERANCE. This is speech the app produces, on
    // the steps whose whole question is what happens during speech, and it
    // used to reach the log as nothing at all — so a wheel press could not be
    // placed inside or outside it. `say()` has carried a start/end pair since
    // the round-3 fix; this is the other half of the same requirement.
    // WHICH KIND OF READING. An arrival reading happens on the silent steps,
    // where there is no sample to confound. An asked-for one can land at any
    // moment, including seconds before a route sample -- so the analysis has
    // to be able to see it and treat that sample accordingly, rather than
    // meeting an unexplained utterance in the middle of the run.
    diag('test', 'instruction-start', { step: step.id, why });
    try {
      await speakAsync(step.instruction, {
        interrupt: true,
        rate: settingsRef.current.audio.rate,
        volume: effectiveVolume(settingsRef.current.audio),
        tag: `${step.id}#instruction`,
      });
    } catch (e) {
      /**
       * SAID OUT LOUD IN THE LOG, because on six steps this is the only
       * audible output the app produces. Swallowed, a speechSynthesis that
       * threw was indistinguishable from an operator who never pressed the
       * button and from a step that advanced first — one of those is a fault
       * in the app and two are not, and `instruction-spoken` was written only
       * on the success path, so absence covered all three.
       */
      diag('test', 'instruction-failed', {
        step: step.id,
        why,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      if (sayRun.current === run) setSpeaking(false);
    }
    if (sayRun.current !== run) {
      // The third of the three. A step left while its instruction was still
      // reading is not a failure, and now says which it was.
      diag('test', 'instruction-abandoned', { step: step.id, why });
      return;
    }
    diag('test', 'instruction-spoken', { step: step.id, why });
  }, [step.id, step.instruction, setSpeaking]);

  /**
   * When the current step became answerable.
   *
   * A GUARD AGAINST THE ROAD, not against the operator. `answer()` stamps and
   * advances on a single tap, and there was no debounce anywhere -- so a bump
   * that turns one press into two answers step N and then, milliseconds
   * later, answers step N+1 with whatever button happens to be under that
   * point. Nothing un-stamps, because `markFieldTestStamped` only ever
   * increments, so the log ends up with two contradictory answers for a step
   * nobody read. The window is short enough to be invisible to a deliberate
   * second tap and long enough to cover a bounce.
   */
  const stepReadyAt = useRef(0);
  useEffect(() => {
    stepReadyAt.current = Date.now();
  }, [step.id]);

  const answer = (responseId: string) => {
    /**
     * THE REFUSAL, SAID OUT LOUD. See the answer button's `aria-disabled`.
     *
     * This is the `disabled` guard, moved into the handler so that it can
     * make a sound and leave a line. A tap here is not a mistake by the
     * operator -- it is the app being deliberately unanswerable, for up to
     * ten seconds, on a screen they cannot look at.
     */
    if (sampling || waitingForMic) {
      diag('test', 'answer-blocked', {
        step: step.id,
        answer: responseId,
        why: waitingForMic ? 'waiting-for-the-microphone' : 'still-speaking',
      });
      chime('blocked');
      return;
    }
    const sinceStep = Date.now() - stepReadyAt.current;
    if (sinceStep < ANSWER_GUARD_MS) {
      diag('test', 'answer-ignored', { step: step.id, answer: responseId, sinceStep });
      // AUDIBLY REFUSED. A tap the screen throws away made no sound at all,
      // which from the driver's seat is indistinguishable from having missed
      // the button -- so the reflex is to tap again, harder, at a stack of
      // six 52px targets. `blocked` is an octave below `bad`: plainly not the
      // sound of an answer being taken.
      chime('blocked');
      return;
    }
    const response = responses.find((r) => r?.id === responseId);
    if (response?.modifier) {
      // ARMS A MARKER AND LEAVES THE STEP OPEN. See `StepResponse.modifier`:
      // this is an observation that is true alongside the answer rather than
      // instead of it, so taking it as the answer would throw the other half
      // away. Toggles, because the only way back from a mis-tap in a moving
      // car is to hit the same button again.
      setMarks((prev) => {
        const next = prev.includes(responseId)
          ? prev.filter((m) => m !== responseId)
          : [...prev, responseId];
        diag('test', 'answer-marked', {
          step: step.id,
          mark: responseId,
          on: !prev.includes(responseId),
        });
        return next;
      });
      // A DIFFERENT SOUND FROM AN ANSWER, because it is a different event.
      // This arms a marker and leaves the step OPEN; a route answer stamps
      // and advances. Both chimed `attention`, so the one fact an eyes-free
      // operator needs after a tap -- did we move on? -- was the one fact the
      // sound did not carry, and the next tap landed on the next step's stack
      // believing it was this one's.
      chime('mark');
      return;
    }
    // Joined here rather than passed as arrays. The log caps a non-primitive
    // by its serialised length and otherwise keeps it as JSON, so an array
    // would export as `["a","b"]` inside a logfmt field -- joining at the call
    // site means the separator is chosen rather than inherited from
    // JSON.stringify, and the field stays greppable.
    stampFieldTest(step.id, run.condition, responseId, {
      // Carried WITH the answer rather than instead of it -- the whole point
      // of a modifier. A step answered "car speakers" having been marked
      // "it moved while playing" exports both, and the 2x2 can still be read
      // from the destination while the move is not lost.
      marks: marks.length > 0 ? marks.join(', ') : undefined,
      // ON THE ROW THE ANALYSIS READS. `say-start` carries the same number, but
      // an answer is read by itself -- `grep answer=` is how the 2x2 gets
      // assembled in a car park -- and a destination without the offset it was
      // sampled at cannot distinguish "the route comes back after a while"
      // from "the route alternates".
      msSinceAppLetGo: stepMicOffsetRef.current ?? undefined,
      wheel: wheelSeen.length > 0 ? wheelSeen.join(', ') : undefined,
      heard: heard.length > 0 ? heard.join(' | ') : undefined,
      paths:
        paths.length > 0
          ? paths
              .map((p) => (p.why ? `${p.path}(${p.why})` : p.partial ? `${p.path}(partial)` : p.path))
              .join(', ')
          : undefined,
    });
    markFieldTestStamped(step.id);
    /**
     * THE TAP IS AUDIBLE, because the operator is not looking at the screen.
     *
     * `answer()` produced no sound and no spoken confirmation. Eyes-free, at
     * speed, a tap that registered and a tap that missed the button felt
     * identical -- and on a six-button stack a near miss is the known hazard,
     * which is why `answer-ignored` and the 350ms bounce guard exist at all.
     * The tone follows the KIND, so hitting `bad` when `good` was meant is
     * audibly wrong rather than silently recorded: that is the confusion the
     * wheel answers spent four conditions manufacturing.
     */
    const kind = responses.find((r) => r?.id === responseId)?.kind;
    chime(kind === 'good' ? 'good' : kind === 'bad' ? 'bad' : 'attention');
    // Answering IS finishing the step: a protocol that needs a tap to record
    // and a second tap to advance gets half as far per red light.
    if (run.stepIndex < FIELD_TEST_STEPS.length - 1) {
      goToFieldTestStep(run.stepIndex + 1);
    } else {
      // THE LAST STEP DOES NOT ADVANCE, so the bounce guard -- which measures
      // from the step CHANGING -- never rearms there. `free` is the step whose
      // instruction is "stamp it the moment it happens", so it is the one step
      // meant to be tapped repeatedly, and it was the only one where a bounce
      // could double-stamp. Rearming here keeps deliberate repeats working and
      // a bounce filtered, on the step that needs both.
      stepReadyAt.current = Date.now();
    }
  };

  const finish = () => {
    // COUNTED FOR THIS CONDITION ONLY. `Object.keys(run.stamps).length` counted
    // every step stamped under any condition, and `setFieldTestCondition`
    // deliberately keeps the stamps when the operator parks and then drives --
    // so a run switched from `car` to `freeway` at step 6 reported "21 of 23"
    // on the freeway leg the moment it reached the end, having measured two of
    // them there.
    const stamped = countStampedSteps(run.stamps, run.condition);
    logFieldTestRunEnd(run.condition, stamped);
    // FENCE FIRST. `cancelSpeech()` settles the awaited promise synchronously
    // and queues the loop's continuation as a microtask; without bumping the
    // fence that continuation's guard still passes, so on the one two-line
    // step it writes `say-start` for line 2 AFTER `run-end` and calls
    // `speakAsync`, which re-takes the media hold the line below just
    // released. Every other exit path bumps this; `finish` was the one that
    // did not.
    sayRun.current += 1;
    cancelSpeech();
    releaseAudioFocus('speech');
    restoreSettings();
    stopFieldTestRun();
    onNavigate('settings');
  };

  return (
    <div className="fieldtest-screen fieldtest-running" data-testid="fieldtest-screen">
      <header className="fieldtest-topbar">
        {/*
          PAUSE, at the top, and distinct from Finish.
          The tab bar stands down during a run because it is the easiest thing
          to hit with a thumb coming off the wheel, which left no way out that
          did not end the run -- and a 20-step protocol on a freeway needs one,
          because traffic does not wait for step 14. This is at the top of the
          screen, the furthest point from where that thumb lands, and it keeps
          the position and every stamp: re-entering offers Resume.
        */}
        <button
          type="button"
          className="settings-back-btn"
          data-testid="fieldtest-pause"
          onClick={() => {
            diag('test', 'run-paused', { step: step.id, condition: run.condition });
            pauseFieldTestRun();
            onNavigate('settings');
          }}
        >
          ← Pause
        </button>
        <span className="u-note" data-testid="fieldtest-progress">
          {conditionLabel} — step {run.stepIndex + 1} of {FIELD_TEST_STEPS.length}
        </span>
      </header>

      {/* ABOVE THE INSTRUCTION, NOT BELOW IT, and the position is the whole
          reason. This row used to sit between the instruction and the evidence
          panel, where its top is whatever the instruction's height happens to
          be — and that height varies from 72px to 130px with the length of the
          step's own text. Measured across the run at all four supported
          viewports: 42px, most of the row's own height, on a control the
          operator reaches for when a passing truck drowned out the line. Under
          the topbar it is a fixed 68px from the top of the screen on every
          step, which is the only position a hand can learn. */}
      {/* A FIXED ROW, OUTSIDE THE SCROLLING PROSE. Both of these are controls
          the operator reaches for, and the head's 190px cap was clipping them:
          the repeat button moved 94.5px across the run, was dead to a tap at
          its own centre on five steps, and was entirely invisible on
          `fallback-audible`; "Measure the cabin" sat 58.7px past the clip on
          the one step that needs it, so that step could not be performed at
          all. Side by side in one row so the slot is the same height whether
          or not the step measures, which is what keeps the answers still. */}
      <div className="fieldtest-controls">

      {/*
        ALWAYS PRESENT, and on a step with no line it reads the instruction
        instead. It used to vanish on the six silent steps, which made the one
        control an operator most wants to find without looking -- "say that
        again", after a truck went past -- the one control whose presence
        depended on which step they were on.
      */}
      <button
        type="button"
        className="fieldtest-stamp"
        data-testid="fieldtest-again"
        disabled={sampling || waitingForMic}
        onClick={() =>
          step.say || step.sayUnclipped
            ? void say('repeat')
            : // `'asked'`, BECAUSE THE OPERATOR ASKED. This branch passed
              // nothing and took the `'arrival'` default, so on the six silent
              // steps -- four of them wheel steps, where `field-test-arrival
              // whileSpeaking=` is read against exactly this utterance -- the
              // export could not tell a re-read the operator requested from
              // the automatic one. The distinction is the reason the field
              // exists.
              void speakInstruction('asked')
        }
      >
        {/* WHICH KIND OF NOT-READY. "Speaking..." during the microphone gate
            was false on the one screen whose whole subject is whether the
            microphone is open, and it was the only signal the operator had
            that the answers were deliberately dead. */}
        {waitingForMic
          ? 'Waiting for the microphone…'
          : sampling
            ? 'Speaking…'
            : step.say || step.sayUnclipped
              ? 'Say it again'
              : 'Read it to me'}
      </button>

      {/*
        THE INSTRUCTION, ON DEMAND, on the steps whose one audio control is
        already spoken for.

        Eyes-free is forced on at step one and never unset, and then every
        step's instruction is printed — so on the seventeen steps that declare
        a line, the thing the operator is being told to DO was eyes-only, while
        the one control that speaks repeated the line instead. The head scrolls
        rather than clipping, which keeps it reachable in a car park and does
        nothing at all for a driver.

        Not spoken on arrival, which was the other candidate: on a step that
        samples the route a TTS line immediately before the sample can move the
        audio session itself, and then the answer is about the wrong thing.
        Asked for, it is the operator's own choice and it is in the log.
      */}
      {(step.say || step.sayUnclipped) && (
        <button
          type="button"
          className="fieldtest-stamp"
          data-testid="fieldtest-read-step"
          disabled={sampling || waitingForMic}
          onClick={() => void speakInstruction('asked')}
        >
          Read the step
        </button>
      )}

      {/*
        A KNOWN POSITION CLASH, LEFT IN PLACE, and the reasoning rather than
        the excuse.

        On the 25 steps that speak, the right-hand control in this row reads
        the step's instruction. On `ambient` there is no line to read, so this
        takes that place — and it opens a raw `getUserMedia` for five
        seconds. One pixel, two meanings, on the screen whose independent
        variable is an open microphone.

        Every fix costs more than it buys. Giving it a slot of its own means a
        third position in a row of `flex: 1 1 0` children, which takes the
        most-reached control on the screen ("Say it again", after a truck went
        past) from half the width to a third on all 31 steps, and leaves the
        six silent steps with one control and two-thirds dead space. Moving it
        into the body shifts `ambient`'s answer stack down by a button pitch,
        which breaks the one invariant three tests exist to hold.

        What is true in mitigation: the microphone is opened on this step
        either way — that is what the step IS — the label says what it
        does rather than naming a generic action, the button reports
        "Listening..." while the stream is live, and both the open and the
        reading are in the log. A driver who taps here expecting a re-read
        gets a labelled five-second measurement on the one step where a
        measurement is what they came for.
      */}
      {step.ambient && (
        <button
          type="button"
          className="fieldtest-stamp"
          data-testid="fieldtest-measure"
          disabled={measuring}
          onClick={() => void measure()}
        >
          {measuring ? 'Listening\u2026' : 'Measure the cabin'}
        </button>
      )}

      </div>

      <div className="fieldtest-body">
      {/*
        EVERYTHING ABOVE THE ANSWERS, IN ONE FIXED-HEIGHT BLOCK.

        The answer stack was top-anchored under this material, so where it sat
        depended on how far the instruction wrapped and on whether the step had
        a repeat button -- measured across the 22 steps, the top of the stack
        travelled 145px. Button pitch is 60px, and one adjacent pair shifted
        69px: the pixel that was "the car did nothing else" on `wheel-gap`
        became "the radio changed track instead" on `wheel-back`. `answer()`
        stamps and advances on that one tap, with no undo. A control a driver
        reaches for by feel cannot move at all, let alone past its neighbour.
      */}
      <div className="fieldtest-head">
      {/* THE STEP ID, ON THE ELEMENT THAT SHOWS ITS TITLE.

          The title is prose and gets reworded -- normalising the route block's
          question to one wording broke three e2e tests that walked the run by
          matching titles exactly, and they broke a full suite later rather than
          where the edit was. The id is the thing that identifies a step
          everywhere else (the log, the stamps, `resolveFieldTestSetup`), so it
          is what a harness should navigate by. Rendered as a data attribute,
          which costs nothing and shows nothing. */}
      <h2 className="fieldtest-title" data-testid="fieldtest-title" data-step={step.id}>
        {step.title}
      </h2>
      <p className="fieldtest-instruction" data-testid="fieldtest-instruction">
        {step.instruction}
      </p>
      {/*
        THE RESOLVED STATE, not the declared delta. `describeFieldTestSetup`
        used to be handed `step.setup`, so a step that declares nothing printed
        "Nothing changed for this step" -- which on a resumed run was an active
        lie: the state it was running under had been set six steps earlier and
        may not have been applied at all.
      */}
      <p className="u-note" data-testid="fieldtest-setup">
        {describeFieldTestSetup(resolveFieldTestSetup(run.stepIndex))}
      </p>
      </div>


      {/*
        ONE REGION, ALWAYS RENDERED, IN ITS OWN ALWAYS-VISIBLE SLOT.

        Every line in here appears as a RESULT of the thing being measured --
        the wheel arriving, a line finishing, the recogniser hearing a word.
        They used to be conditionally rendered directly above the answer stack,
        so at the exact instant the operator acted, the buttons below jumped by
        a line or two. A driver who glanced, chose "The app reacted", looked
        back at the road and tapped, hit "The radio changed track instead" --
        and `answer()` stamps and advances, so the run recorded the opposite of
        the truth with no way back. Reserving the space costs a few empty
        pixels and removes the entire class of error.
      */}
      <div className="fieldtest-evidence" data-testid="fieldtest-evidence">
        {step.wheel && (
          <p className="fieldtest-evidence-line" data-testid="fieldtest-wheel">
            {wheelUnavailable ? (
              'This browser cannot receive wheel buttons at all \u2014 nothing you press can reach the app here. This is not a routing result.'
            ) : wheelSeen.length === 0 ? (
              'Waiting for a wheel button\u2026'
            ) : (
              <>
                <span className="fieldtest-wheel-count">
                  {wheelSeen.length} press{wheelSeen.length === 1 ? '' : 'es'}
                </span>{' '}
                {wheelSeen.map((a) => shortWheelLabel(a)).join(', ')}
              </>
            )}
          </p>
        )}
        {paths.length > 0 && (
          <p className="fieldtest-evidence-line" data-testid="fieldtest-path">
            {/* Stated, never asked. The operator's question was the right one:
                "it's not like they're played the same way and the code doesn't
                know wtf?" -- it does know, so it says so, and the only thing
                left for a person is whether they could hear it. */}
            Played from: {paths.map((pr) => describePath(pr)).join(', then ')}.
          </p>
        )}
        {heard.length > 0 && (
          <p className="fieldtest-evidence-line" data-testid="fieldtest-heard">
            Heard: {heard.join(' \u00b7 ')}
          </p>
        )}
        {ambient && (
          <p className="fieldtest-evidence-line" data-testid="fieldtest-ambient">
            {ambient}
          </p>
        )}
        {marks.length > 0 && (
          /* SAID OUT LOUD ON SCREEN, because arming a mark is the one tap on
             this screen that does not advance. Without a line saying what is
             armed, an operator who is not looking has no way to tell a mark
             they meant from one a bump made -- and the marked button's own
             highlight is invisible to someone watching the road. */
          <p className="fieldtest-evidence-line" data-testid="fieldtest-marks">
            {`Marked: ${marks
              .map((id) => responses.find((r) => r?.id === id)?.label ?? id)
              .join(', ')}. Now say what happened.`}
          </p>
        )}
      </div>

      <div className="fieldtest-answers" data-testid="fieldtest-answers">
        {responses.map((response, slot) =>
          // A SLOT THIS STEP HAS NO ANSWER FOR, held open rather than closed
          // up. See `WHEEL_SLOTS`: the alternative is the answer below it
          // moving up under a thumb that is not looking, and arriving as a
          // different answer to a different question.
          response === null ? (
            <div
              key={`gap-${slot}`}
              className="fieldtest-answer-gap"
              data-testid={`fieldtest-answer-gap-${slot}`}
              aria-hidden="true"
            />
          ) : (
            <button
              type="button"
              key={response.id}
              className={`fieldtest-stamp fieldtest-${response.kind}${
                marks.includes(response.id) ? ' fieldtest-marked' : ''
              }`}
              data-testid={`fieldtest-answer-${response.id}`}
              aria-pressed={response.modifier ? marks.includes(response.id) : undefined}
              /*
               * REFUSED, NOT `disabled`, and the difference is audible.
               *
               * The answers must not be collectable while the app is still
               * talking: a tap during line 1 of `fallback-audible` records a
               * two-line loudness comparison of one line, and on `route-long`,
               * whose premise is the route moving PART WAY THROUGH, an early
               * tap makes `route-moved` unobservable. That part is unchanged.
               *
               * What changed is how the refusal reads from the driver's seat.
               * A `disabled` button fires NO click event, so there was no
               * handler to chime from and no entry to write -- and the
               * answers are dead for up to ten seconds at a stretch across
               * five consecutive steps while the microphone settles. Tapping
               * and getting nothing is indistinguishable from missing a 52px
               * target at speed, and the reflex is to tap again, harder. The
               * only signals were 45% opacity and a label on another control:
               * both require looking, on the screen built not to be looked at.
               *
               * `aria-disabled` keeps the semantics for a screen reader and
               * the styling hook for the eye, while the tap still reaches
               * `answer()`, which refuses it out loud and records it.
               */
              aria-disabled={sampling || waitingForMic ? true : undefined}
              onClick={() => answer(response.id)}
            >
              {response.label}
            </button>
          ),
        )}
      </div>

      <div className="fieldtest-nav">
        <button
          type="button"
          data-testid="fieldtest-prev"
          disabled={run.stepIndex === 0}
          onClick={() => goToFieldTestStep(run.stepIndex - 1)}
        >
          Back
        </button>
        <button
          type="button"
          data-testid="fieldtest-skip"
          disabled={run.stepIndex >= FIELD_TEST_STEPS.length - 1}
          onClick={() => {
            // A skip is evidence too: a step nobody could do at speed is a
            // step to redesign, and that only shows up if it is recorded.
            diag('test', 'step-skipped', { step: step.id, condition: run.condition });
            goToFieldTestStep(run.stepIndex + 1);
          }}
        >
          Skip
        </button>
        {/*
          TWO TAPS, because one tap used to throw the run away. Finish sat 27px
          under the answer stack, bottom-right -- the easiest target for a thumb
          coming off the wheel, and the one you hit when you tap low and right
          without looking -- and re-entering only offers Start, which resets to
          step one with no stamps. A stray tap on step 14 meant beginning again,
          which is exactly how the first two runs died.
        */}
        <button
          type="button"
          data-testid="fieldtest-finish"
          className={confirmFinish ? 'fieldtest-finish-armed' : undefined}
          onClick={() => (confirmFinish ? finish() : setConfirmFinish(true))}
        >
          {confirmFinish ? 'Tap again to end' : 'Finish'}
        </button>
      </div>
      </div>
    </div>
  );
}

/**
 * A path, said the way the operator would say it.
 *
 * `clip-failed-to-tts` gets the longest sentence because it is the worst
 * case and the hardest to notice: the voice changing PART WAY through a
 * line, which sounds like the app glitching rather than like a fallback.
 */
function describePath(record: SpeechPathRecord): string {
  if (record.path === 'clip') return 'the recorded voice';
  if (record.path === 'clip-failed-to-tts') {
    return record.partial
      ? 'the recorded voice, then the phone\u2019s voice part way through (the recording broke)'
      : 'the phone\u2019s voice (the recording failed to play)';
  }
  return record.why === 'clips-off'
    ? 'the phone\u2019s voice (recorded voice is switched off)'
    : 'the phone\u2019s voice (no recording exists for this line)';
}

/**
 * A wheel action in as few characters as possible.
 *
 * `MEDIA_SESSION_LABEL` is written for the settings screen and reads "Skip
 * forward. Goes FORWARD: start, answer, plus one, ..." -- 64 characters of
 * drill mapping. Two presses rendered 128 characters of prose at 12.5px to
 * answer "did two presses arrive?", which is a question answered by a numeral.
 */
function shortWheelLabel(action: string): string {
  const short: Record<string, string> = {
    nexttrack: 'skip-forward',
    previoustrack: 'skip-back',
    seekforward: 'seek-forward',
    seekbackward: 'seek-back',
    play: 'play',
    pause: 'pause',
    stop: 'stop',
  };
  return short[action] ?? action;
}
