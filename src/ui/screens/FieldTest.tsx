import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FIELD_TEST_CONDITIONS,
  FIELD_TEST_STEPS,
  applyFieldTestSetup,
  describeFieldTestSetup,
  logFieldTestRunEnd,
  logFieldTestRunStart,
  logFieldTestStep,
  stampFieldTest,
} from '../../diag/fieldTest';
import {
  goToFieldTestStep,
  markFieldTestStamped,
  readFieldTestRun,
  setFieldTestCondition,
  startFieldTestRun,
  stopFieldTestRun,
  subscribeFieldTestRun,
  type FieldTestRun,
} from '../../diag/fieldTestRun';
import { speakAsync, cancelSpeech } from '../../audio/speech';
import { effectiveVolume } from '../../audio/volume';
import { setMediaSessionProbe, MEDIA_SESSION_LABEL } from '../../audio/mediaSession';
import { holdAudioFocus, releaseAudioFocus } from '../../audio/audioFocus';
import { measureWithWebAudio } from '../../diag/carCheckCatalog';
import { bandFor, adviceFor } from '../../diag/ambientNoise';
import { useVoiceControl } from '../useVoiceControl';
import { setVoiceOn } from '../voiceSession';
import { setEyesFreeOn } from '../eyesFreeSession';
import { diag } from '../../diag/diagnosticLog';
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
          logFieldTestRunStart(run.condition);
          startFieldTestRun(run.condition);
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

function StartGate({
  run,
  onStart,
  onNavigate,
}: {
  run: FieldTestRun;
  onStart: () => void;
  onNavigate: (screen: Screen) => void;
}) {
  const condition =
    FIELD_TEST_CONDITIONS.find((c) => c.id === run.condition) ?? FIELD_TEST_CONDITIONS[0]!;

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

      <button
        type="button"
        className="fieldtest-stamp"
        data-testid="fieldtest-start"
        onClick={onStart}
      >
        Start — {FIELD_TEST_STEPS.length} steps
      </button>

      <ol className="fieldtest-steps">
        {FIELD_TEST_STEPS.map((step) => (
          <li className="fieldtest-step" key={step.id}>
            <div className="fieldtest-instruction">{step.title}</div>
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
  const [wheelSeen, setWheelSeen] = useState<string[]>([]);
  const [heard, setHeard] = useState<string[]>([]);
  const [ambient, setAmbient] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  // The settings are read inside effects that must not re-run when an
  // unrelated setting changes, so the latest copy lives in a ref.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const changeRef = useRef(onSettingsChange);
  changeRef.current = onSettingsChange;

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
  const say = useCallback(async (why: string) => {
    const lines = [...(step.say ?? []), ...(step.sayUnclipped ? [step.sayUnclipped] : [])];
    if (lines.length === 0) return;
    setSpeaking(true);
    try {
      for (const [i, text] of lines.entries()) {
        diag('test', 'say-start', { step: step.id, text, why, line: i + 1, of: lines.length });
        try {
          await speakAsync(text, {
            interrupt: i === 0,
            rate: settingsRef.current.audio.rate,
            voiceURI: settingsRef.current.audio.voiceURI,
            volume: effectiveVolume(settingsRef.current.audio),
          });
          diag('test', 'say-end', { step: step.id, text });
        } catch (e) {
          diag('test', 'say-failed', {
            step: step.id,
            text,
            why: e instanceof Error ? e.message : String(e),
          });
        }
      }
    } finally {
      setSpeaking(false);
    }
  }, [step.id, step.say, step.sayUnclipped]);

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
    setAmbient(null);
    logFieldTestStep(step.id, run.condition, run.stepIndex);

    if (step.setup) {
      const next = applyFieldTestSetup(settingsRef.current, step.setup);
      saveSettings(next);
      changeRef.current(next);
      if (step.setup.voice !== undefined) setVoiceOn(step.setup.voice, 'field-test');
      if (step.setup.eyesFree !== undefined) setEyesFreeOn(step.setup.eyesFree, 'field-test');
      diag('test', 'step-setup', { step: step.id, ...step.setup });
    }

    // The silent hold is what makes the phone treat this app as what is
    // playing, and therefore what makes the wheel reach it at all. Held for
    // the whole run, not per utterance: the 2026-09-19 fault was a press in
    // the SILENCE going to the radio, which is exactly the gap a per-utterance
    // hold would leave open.
    holdAudioFocus('speech');

    void say('step-open');

    return () => {
      cancelSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id, run.condition]);

  /** Let go of the media slot and the microphone when the screen closes. */
  useEffect(
    () => () => {
      releaseAudioFocus('speech');
      setVoiceOn(false, 'field-test');
    },
    [],
  );

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
    setMediaSessionProbe((action) => {
      diag('wheel', 'field-test-arrival', { step: step.id, action });
      setWheelSeen((prev) => [...prev, action]);
    });
    return () => setMediaSessionProbe(null);
  }, [step.wheel, step.id]);

  useVoiceControl({
    enabled: step.setup?.voice === true,
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
      setHeard((prev) => [...prev, '(not understood)']);
    },
  });

  /** Measure the cabin, on the step that asks for it. */
  const measure = useCallback(async () => {
    setAmbient('listening…');
    try {
      const reading = await measureWithWebAudio(5000);
      const band = bandFor(reading.dbfs);
      diag('test', 'ambient', {
        step: step.id,
        dbfs: Number(reading.dbfs.toFixed(1)),
        peakDbfs: Number(reading.peakDbfs.toFixed(1)),
        band,
        frames: reading.frames,
      });
      setAmbient(
        reading.frames === 0
          ? 'The microphone produced nothing at all — that is not a quiet room.'
          : `${reading.dbfs.toFixed(1)} dBFS (${band}). ${adviceFor(band)}`,
      );
    } catch (e) {
      const why = e instanceof Error ? e.name : String(e);
      diag('test', 'ambient-failed', { step: step.id, why });
      setAmbient(`The microphone could not be opened (${why}).`);
    }
  }, [step.id]);

  const answer = (responseId: string) => {
    // Joined here rather than passed as arrays: the log sanitises any
    // non-primitive with String(), so an array would be stringified anyway --
    // doing it at the call site means the separator is chosen rather than
    // inherited from Array.prototype.toString.
    stampFieldTest(step.id, run.condition, responseId, {
      wheel: wheelSeen.length > 0 ? wheelSeen.join(', ') : undefined,
      heard: heard.length > 0 ? heard.join(' | ') : undefined,
    });
    markFieldTestStamped(step.id);
    // Answering IS finishing the step: a protocol that needs a tap to record
    // and a second tap to advance gets half as far per red light.
    if (run.stepIndex < FIELD_TEST_STEPS.length - 1) {
      goToFieldTestStep(run.stepIndex + 1);
    }
  };

  const finish = () => {
    const stamped = Object.keys(run.stamps).length;
    logFieldTestRunEnd(run.condition, stamped);
    cancelSpeech();
    releaseAudioFocus('speech');
    setVoiceOn(false, 'field-test');
    stopFieldTestRun();
    onNavigate('settings');
  };

  return (
    <div className="fieldtest-screen" data-testid="fieldtest-screen">
      <header className="fieldtest-topbar">
        <span className="u-note" data-testid="fieldtest-progress">
          {conditionLabel} — step {run.stepIndex + 1} of {FIELD_TEST_STEPS.length}
        </span>
      </header>

      <div className="fieldtest-body">
      <h2 className="fieldtest-title" data-testid="fieldtest-title">
        {step.title}
      </h2>
      <p className="fieldtest-instruction" data-testid="fieldtest-instruction">
        {step.instruction}
      </p>
      {step.setup && <p className="u-note">{describeFieldTestSetup(step.setup)}</p>}

      {(step.say || step.sayUnclipped) && (
        <button
          type="button"
          className="fieldtest-stamp"
          data-testid="fieldtest-again"
          disabled={speaking}
          onClick={() => void say('repeat')}
        >
          {speaking ? 'Speaking…' : 'Say it again'}
        </button>
      )}

      {step.ambient && (
        <>
          <button
            type="button"
            className="fieldtest-stamp"
            data-testid="fieldtest-measure"
            onClick={() => void measure()}
          >
            Measure the cabin
          </button>
          {ambient && (
            <p className="u-note" data-testid="fieldtest-ambient">
              {ambient}
            </p>
          )}
        </>
      )}

      {step.wheel && (
        <p className="u-note" data-testid="fieldtest-wheel">
          {wheelSeen.length === 0
            ? 'Waiting for a wheel button…'
            : `The car sent: ${wheelSeen
                .map((a) => MEDIA_SESSION_LABEL[a as keyof typeof MEDIA_SESSION_LABEL] ?? a)
                .join(', ')}`}
        </p>
      )}

      {heard.length > 0 && (
        <p className="u-note" data-testid="fieldtest-heard">
          Heard: {heard.join(' · ')}
        </p>
      )}

      <div className="fieldtest-answers" data-testid="fieldtest-answers">
        {step.responses.map((response) => (
          <button
            type="button"
            key={response.id}
            className={`fieldtest-stamp fieldtest-${response.kind}`}
            data-testid={`fieldtest-answer-${response.id}`}
            onClick={() => answer(response.id)}
          >
            {response.label}
          </button>
        ))}
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
        <button type="button" data-testid="fieldtest-finish" onClick={finish}>
          Finish
        </button>
      </div>
      </div>
    </div>
  );
}
