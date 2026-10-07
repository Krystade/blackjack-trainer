import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import {
  KITS,
  KIT_PROGRESS_KEY,
  blindOrder,
  calibrationAnnouncement,
  calibrationOrderLine,
  CALIBRATION_INTRO,
  CALIBRATION_RETRY,
  calibrationSchedule,
  parseProgress,
  scoreSample,
  summariseCalibration,
  type CalibrationSample,
  type KitId,
  type KitStep,
} from '../../diag/testKit';
import {
  exportRecordings,
  listInputsAfterGrant,
  openChosenInput,
  openMic,
  playThrough,
  routeClipUrl,
  sayRecorded,
  startRecording,
  tick,
  unlockWebAudio,
  type HeldInput,
  type HeldMic,
  type Recording,
} from '../../diag/testKitIO';
import {
  accuracyOf,
  fingerVerdict,
  phoneMicSummary,
  pickCarInput,
  pickPhoneInput,
  recogniseVerdict,
  routeVerdict,
  wheelArrived,
  type InputDevice,
  type PhoneRun,
  type RouteRow,
} from '../../diag/phoneMic';
import { setMediaSessionProbe } from '../../audio/mediaSession';
import { readAudioSessionType } from '../../audio/audioSession';
import { diag, formatDiagnosticLog, readDiagnosticLog } from '../../diag/diagnosticLog';
import { listMicrophones, probeMicSpectrum, type MicProbeResult } from '../../diag/micSpectrum';
import { FIELD_TEST_STEPS } from '../../diag/fieldTest';
import { readFieldTestRun, subscribeFieldTestRun } from '../../diag/fieldTestRun';

/**
 * One button per place; every open experiment that place can answer.
 * See diag/testKit.ts for what each step is for and why the order matters.
 */

const START_KEY = 'bjtrainer.testkit.startedAt.v1';
const WORD_SLOT_MS = 6000;
const RECORD_SLOT_MS = 2500;

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function saveProgress(kit: KitId, stepIndex: number): void {
  try {
    store()?.setItem(KIT_PROGRESS_KEY, JSON.stringify({ kit, stepIndex, savedAt: Date.now() }));
  } catch {
    /* resume is a convenience */
  }
}

function clearProgress(): void {
  try {
    store()?.removeItem(KIT_PROGRESS_KEY);
  } catch {
    /* nothing to clear */
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function TestKit({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const resumed = useRef(parseProgress(store()?.getItem(KIT_PROGRESS_KEY) ?? null, Date.now()));
  const [kit, setKit] = useState<KitId | null>(resumed.current?.kit ?? null);
  const [index, setIndex] = useState(resumed.current?.stepIndex ?? 0);
  const [done, setDone] = useState(false);
  const recordings = useRef<Array<{ name: string; rec: Recording }>>([]);
  const mic = useRef<HeldMic | null>(null);
  // The phone-mic kit: one stream held on the chosen input across steps, and
  // what the steps measured, for the summary.
  const input = useRef<HeldInput | null>(null);
  const phoneRun = useRef<PhoneRun>({ answers: {} });
  const [fieldRun, setFieldRun] = useState(() => readFieldTestRun());
  useEffect(() => subscribeFieldTestRun(() => setFieldRun(readFieldTestRun())), []);

  useEffect(() => {
    if (resumed.current) diag('test', 'kit-resumed', { kit: resumed.current.kit, step: resumed.current.stepIndex });
    return () => {
      void releaseAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Every microphone this screen holds: the recogniser and the chosen-input stream. */
  const releaseAll = async (): Promise<void> => {
    const m = mic.current;
    const i = input.current;
    mic.current = null;
    input.current = null;
    setMediaSessionProbe(null);
    await Promise.all([m?.close(), i?.close()]);
  };

  /** The chosen phone input, opened once and held until releaseAll. */
  const ensureInput = async (): Promise<HeldInput | { error: string }> => {
    if (input.current) return input.current;
    const want = phoneRun.current.phone?.deviceId ?? 'default';
    const held = await openChosenInput(want);
    if ('error' in held) {
      diag('test', 'kit-phone-stream-open', { deviceId: want, error: held.error });
      return held;
    }
    input.current = held;
    diag('test', 'kit-phone-stream-open', {
      deviceId: want,
      label: held.label,
      trackSampleRate: held.trackSampleRate,
      session: readAudioSessionType(),
    });
    return held;
  };

  const steps = kit ? KITS[kit].steps : [];
  const step = steps[index];

  const start = (id: KitId) => {
    try {
      store()?.setItem(START_KEY, new Date().toISOString());
    } catch {
      /* the copy falls back to the whole log */
    }
    diag('test', 'kit-start', { kit: id });
    setKit(id);
    setIndex(0);
    setDone(false);
    saveProgress(id, 0);
  };

  const advance = () => {
    if (!kit) return;
    const next = index + 1;
    if (next >= steps.length) {
      void releaseAll();
      clearProgress();
      diag('test', 'kit-finished', { kit });
      setDone(true);
      return;
    }
    saveProgress(kit, next);
    setIndex(next);
  };

  const answer = (value: string, extra: Record<string, unknown> = {}) => {
    if (!step) return;
    diag('test', 'kit-answer', { kit, step: step.id, answer: value, ...extra });
    phoneRun.current.answers[step.id] = value;
    advance();
  };

  const ensureMic = async (want: 'open' | 'closed'): Promise<string | null> => {
    if (want === 'closed') {
      await mic.current?.close();
      mic.current = null;
      return null;
    }
    // Always a fresh session: a step that follows a trip to the Settings app
    // cannot trust one that was open before it.
    await mic.current?.close();
    const held = await openMic();
    if ('error' in held) {
      mic.current = null;
      return held.error;
    }
    mic.current = held;
    return null;
  };

  if (!kit) {
    return (
      <div className="fieldtest-screen testkit-screen" data-testid="testkit-screen">
        <header className="fieldtest-topbar">
          <button type="button" className="u-btn" onClick={() => onNavigate('home')}>
            Back
          </button>
          <h1 className="fieldtest-heading">Test kit</h1>
          <span />
        </header>
        <div className="testkit-body">
          <p className="testkit-lede">
            Pick where you are. Each kit asks only what that place can answer; the answers go into the diagnostic log.
          </p>
          {(Object.keys(KITS) as KitId[]).map((id) => (
            <button key={id} type="button" className="u-btn testkit-kit" onClick={() => start(id)}>
              <span className="testkit-kit-label">{KITS[id].label}</span>
              <span className="testkit-kit-where">{KITS[id].where}</span>
            </button>
          ))}
          <button
            type="button"
            className="u-btn testkit-kit"
            data-testid="fieldtest-open"
            onClick={() => onNavigate('fieldtest')}
          >
            <span className="testkit-kit-label">
              {fieldRun.active ? `Back to the freeway drive — step ${fieldRun.stepIndex + 1} of ${FIELD_TEST_STEPS.length}` : 'Freeway drive'}
            </span>
            <span className="testkit-kit-where">
              Bluetooth on, at road speed. {FIELD_TEST_STEPS.length} steps, run by the wheel and your voice. Answer
              the first two before you pull out.
            </span>
          </button>
          <details className="drill-options testkit-unanswered">
            <summary>Still unanswered (5)</summary>
          <ul className="testkit-open" data-testid="testkit-open-questions">
            <li>
              <strong>Phone speaker with voice on.</strong> Does any way of playing sound stay on the loud speaker
              once the mic is open? <em>Desk.</em>
            </li>
            <li>
              <strong>Which mic, with Bluetooth on.</strong> Is the app listening through the car's call mic or
              the phone's? <em>Car, Bluetooth on.</em>
            </li>
            <li>
              <strong>How often words are heard right.</strong> Single words against two-word forms, in each
              place. <em>Words at speed, or any kit.</em>
            </li>
            <li>
              <strong>Audible at speed, and the wheel after voice.</strong> Can you make out the words on the
              freeway, and does the wheel still work after the mic closes? <em>Freeway drive.</em>
            </li>
            <li>
              <strong>Phone mic with Bluetooth on.</strong> Can the app listen through the phone while the car plays
              the sound? <em>Bluetooth: phone mic?</em>
            </li>
          </ul>
          </details>
        </div>
      </div>
    );
  }

  if (done || !step) {
    return (
      <DoneView
        kit={kit}
        recordings={recordings.current}
        onBack={() => {
          setKit(null);
          setDone(false);
        }}
      />
    );
  }

  return (
    <div className="fieldtest-screen testkit-screen" data-testid="testkit-screen">
      <header className="fieldtest-topbar">
        <button
          type="button"
          className="u-btn"
          onClick={() => {
            void releaseAll();
            clearProgress();
            diag('test', 'kit-abandoned', { kit, step: step.id });
            setKit(null);
          }}
        >
          Stop
        </button>
        <h1 className="fieldtest-heading">{KITS[kit].label}</h1>
        <span className="testkit-count">
          {index + 1}/{steps.length}
        </span>
      </header>
      <div className="testkit-body" data-step={step.id}>
        <h2 className="testkit-title">{step.title}</h2>
        <p className="testkit-why">{step.why}</p>
        <StepView
          key={step.id}
          step={step}
          kit={kit}
          ensureMic={ensureMic}
          mic={mic}
          input={input}
          ensureInput={ensureInput}
          run={phoneRun}
          releaseAll={releaseAll}
          onAnswer={answer}
          onRecording={(name, rec) => recordings.current.push({ name, rec })}
          onReload={() => {
            saveProgress(kit, index + 1);
            diag('test', 'kit-reload', { kit });
            window.location.reload();
          }}
        />
        <button type="button" className="u-btn testkit-skip" onClick={() => answer('skipped')}>
          Skip this step
        </button>
      </div>
    </div>
  );
}

interface StepProps {
  step: KitStep;
  kit: KitId;
  ensureMic: (want: 'open' | 'closed') => Promise<string | null>;
  mic: React.MutableRefObject<HeldMic | null>;
  input: React.MutableRefObject<HeldInput | null>;
  ensureInput: () => Promise<HeldInput | { error: string }>;
  run: React.MutableRefObject<PhoneRun>;
  releaseAll: () => Promise<void>;
  onAnswer: (value: string, extra?: Record<string, unknown>) => void;
  onRecording: (name: string, rec: Recording) => void;
  onReload: () => void;
}

function StepView(props: StepProps) {
  const { step } = props;
  switch (step.kind) {
    case 'route':
      return <RouteStep {...props} step={step} />;
    case 'route-blind':
      return <BlindStep {...props} step={step} />;
    case 'instruction':
      return (
        <>
          <p className="testkit-instruction">{step.body}</p>
          <Answers answers={step.answers} onAnswer={props.onAnswer} />
        </>
      );
    case 'reload':
      return (
        <>
          <p className="testkit-instruction">
            The app will reload and come straight back here. Then it plays the line again.
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={props.onReload}>
            Reload now
          </button>
        </>
      );
    case 'spectrum':
      return <SpectrumStep {...props} />;
    case 'calibrate':
      return <CalibrateStep {...props} />;
    case 'record':
      return <RecordStep {...props} step={step} />;
    case 'phone-inputs':
      return <PhoneInputsStep {...props} />;
    case 'phone-probe':
      return <PhoneProbeStep {...props} />;
    case 'phone-finger':
      return <PhoneFingerStep {...props} />;
    case 'phone-route':
      return <PhoneRouteStep {...props} step={step} />;
    case 'phone-recognise':
      return <PhoneRecogniseStep {...props} />;
    case 'wheel-press':
      return <WheelPressStep {...props} step={step} />;
    case 'phone-summary':
      return <PhoneSummaryStep {...props} />;
  }
}

function Answers({ answers, onAnswer, extra }: { answers: readonly string[]; onAnswer: StepProps['onAnswer']; extra?: Record<string, unknown> }) {
  return (
    <div className="testkit-answers">
      {answers.map((a) => (
        <button key={a} type="button" className="u-btn testkit-answer" onClick={() => onAnswer(a, extra)}>
          {a}
        </button>
      ))}
    </div>
  );
}

function RouteStep({ step, ensureMic, onAnswer }: StepProps & { step: Extract<KitStep, { kind: 'route' }> }) {
  const [state, setState] = useState<'ready' | 'working' | 'played'>('ready');
  const [note, setNote] = useState('');

  const play = async () => {
    unlockWebAudio();
    setState('working');
    setNote('');
    if (step.mic === 'open') {
      setNote('Opening the microphone…');
      const err = await ensureMic('open');
      if (err) setNote(`The microphone did not open (${err}). Answer what you hear anyway.`);
    } else if (step.mic === 'closed-after-open') {
      setNote('Closing the microphone…');
      await ensureMic('closed');
      await wait(1600);
    }
    const url = await routeClipUrl();
    if (!url) {
      setNote('No recorded clip is available, so nothing can be played.');
      setState('played');
      return;
    }
    setNote('Playing…');
    const result = await playThrough(step.path, url);
    setNote(result === 'ended' ? '' : `Playback failed (${result}).`);
    setState('played');
  };

  return (
    <>
      <p className="testkit-instruction">
        Press Play and listen, then tap where the voice came from.
        {step.mic === 'open' && ' The microphone is on for this one.'}
      </p>
      <button type="button" className="u-btn u-btn-primary testkit-go" disabled={state === 'working'} onClick={() => void play()}>
        {state === 'played' ? 'Play again' : 'Play'}
      </button>
      {note && <p className="testkit-note">{note}</p>}
      {state === 'played' && <Answers answers={step.answers} onAnswer={onAnswer} extra={{ path: step.path, mic: step.mic }} />}
    </>
  );
}

function BlindStep({ step, mic, ensureMic, onAnswer }: StepProps & { step: Extract<KitStep, { kind: 'route-blind' }> }) {
  const order = useRef(blindOrder(step.trials));
  const [trial, setTrial] = useState(0);
  const [state, setState] = useState<'ready' | 'working' | 'played' | 'done'>('ready');
  const [note, setNote] = useState('');
  const results = useRef<Array<{ path: string; answer: string }>>([]);

  const play = async () => {
    unlockWebAudio();
    setState('working');
    setNote('');
    // One session for the whole block: reopening between plays would make
    // each one the first play after a mic open, which is a different state.
    if (!mic.current) {
      setNote('Opening the microphone…');
      const err = await ensureMic('open');
      if (err) setNote(`The microphone did not open (${err}). Answer what you hear anyway.`);
    }
    const url = await routeClipUrl();
    if (!url) {
      setNote('No recorded clip is available.');
      setState('played');
      return;
    }
    setNote('Playing…');
    const result = await playThrough(order.current[trial]!, url);
    setNote(result === 'ended' ? '' : `Playback failed (${result}).`);
    setState('played');
  };

  const answer = (a: string) => {
    const path = order.current[trial]!;
    results.current.push({ path, answer: a });
    diag('test', 'kit-blind', { step: step.id, trial: trial + 1, of: step.trials, path, answer: a });
    if (trial + 1 >= step.trials) {
      void ensureMic('closed');
      setState('done');
    } else {
      setTrial(trial + 1);
      setState('ready');
    }
  };

  if (state === 'done') {
    const tally = (path: string) => {
      const rows = results.current.filter((r) => r.path === path);
      const hit = rows.filter((r) => r.answer === step.target).length;
      // WHERE IT ACTUALLY WENT, not just how often it went right. `0 of 3`
      // alone was the whole report Jack got from his first car run, and it
      // cannot say whether the sound came from the phone, the earpiece or
      // nowhere -- which is the only thing the step was asked to find out.
      const where = rows.map((r) => r.answer).join(', ');
      return `${hit} of ${rows.length} on the ${step.target.toLowerCase()}${where ? ` (${where})` : ''}`;
    };
    return (
      <>
        <ul className="testkit-results" data-testid="testkit-blind-result">
          <li>
            Normal playback: <strong>{tally('element')}</strong>
          </li>
          <li>
            Web Audio: <strong>{tally('webaudio')}</strong>
          </li>
        </ul>
        <button
          type="button"
          className="u-btn u-btn-primary testkit-go"
          onClick={() => onAnswer('done', { element: tally('element'), webaudio: tally('webaudio') })}
        >
          Next
        </button>
      </>
    );
  }

  return (
    <>
      <p className="testkit-instruction">
        Play {trial + 1} of {step.trials}. Press Play, listen, and tap where it came from. The microphone stays on for
        all of them.
      </p>
      <button
        type="button"
        className="u-btn u-btn-primary testkit-go"
        disabled={state === 'working'}
        onClick={() => void play()}
      >
        {state === 'played' ? 'Play again' : 'Play'}
      </button>
      {note && <p className="testkit-note">{note}</p>}
      {state === 'played' && (
        <div className="testkit-answers">
          {step.answers.map((a) => (
            <button key={a} type="button" className="u-btn testkit-answer" onClick={() => answer(a)}>
              {a}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SpectrumStep({ ensureMic, onAnswer }: StepProps) {
  const [rows, setRows] = useState<Array<{ name: string; r: MicProbeResult }> | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    await ensureMic('closed');
    const out: Array<{ name: string; r: MicProbeResult }> = [];
    out.push({ name: 'default', r: await probeMicSpectrum({ ms: 4000 }) });
    setRows([...out]);
    const mics = await listMicrophones();
    for (const m of mics) {
      if (m.deviceId === 'default' || m.deviceId === '') continue;
      out.push({ name: m.label || m.deviceId.slice(0, 8), r: await probeMicSpectrum({ deviceId: m.deviceId, ms: 4000 }) });
      setRows([...out]);
    }
    setBusy(false);
  };

  return (
    <>
      <p className="testkit-instruction">
        Press Start, then count out loud from one to ten, at normal volume, until it says done. It measures each
        microphone for four seconds.
      </p>
      {!rows && (
        <button type="button" className="u-btn u-btn-primary testkit-go" disabled={busy} onClick={() => void run()}>
          Start
        </button>
      )}
      {rows && (
        <ul className="testkit-results">
          {rows.map(({ name, r }) => (
            <li key={name}>
              <strong>{name}</strong>: {r.error ? `failed (${r.error})` : `${r.verdict} · high ${r.highRatio.toFixed(3)}`}
              {r.label && ` · ${r.label}`}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="testkit-note">Measuring… keep counting.</p>}
      {rows && !busy && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done', { probes: rows.length })}>
          Done — next
        </button>
      )}
    </>
  );
}

function CalibrateStep({ ensureMic, mic, onAnswer }: StepProps) {
  const schedule = useRef(calibrationSchedule());
  const [phase, setPhase] = useState<'ready' | 'announcing' | 'listening' | 'scored'>('ready');
  const [current, setCurrent] = useState(0);
  const [last, setLast] = useState<string>('');
  const [lastRight, setLastRight] = useState<boolean | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const cancelled = useRef(false);

  useEffect(() => () => void (cancelled.current = true), []);

  const run = async () => {
    setPhase('announcing');
    await ensureMic('closed');
    await sayRecorded(CALIBRATION_INTRO);
    await sayRecorded(calibrationOrderLine());
    const err = await ensureMic('open');
    if (err || !mic.current) {
      setLast(`The microphone did not open (${err ?? 'unknown'}).`);
      setPhase('scored');
      return;
    }
    setPhase('listening');
    const got: CalibrationSample[] = [];
    for (let i = 0; i < schedule.current.length && !cancelled.current; i++) {
      const word = schedule.current[i]!;
      setCurrent(i);
      // Two tries per word. On 2026-10-05 a slot that heard nothing moved on
      // silently, the operator repeated the word, and the repeat landed in the
      // NEXT slot -- one silence became two misses. A retry on the same word,
      // said out loud on screen, keeps the answer in its own slot.
      let heard: Array<{ transcript: string; confidence: number }> = [];
      let attempt = 0;
      let tookMs = 0;
      for (attempt = 1; attempt <= 2 && heard.length === 0 && !cancelled.current; attempt++) {
        setRetrying(attempt === 2);
        if (attempt === 2) {
          // Said out loud, not just shown: a retry only on screen is invisible
          // while driving, and the repeat then lands one word late.
          diag('test', 'kit-calibrate-retry', { say: word.say });
          await sayRecorded(CALIBRATION_RETRY);
          await wait(250);
        }
        tick();
        const t0 = Date.now();
        heard = await new Promise<Array<{ transcript: string; confidence: number }>>((resolve) => {
          const timer = setTimeout(() => resolve([]), WORD_SLOT_MS);
          if (!mic.current) return resolve([]);
          mic.current.onFinal = (alts) => {
            // The kit's own "Again." heard back by the open mic is not an answer.
            if (/^\s*again\W*$/i.test(alts[0]?.transcript ?? '')) return;
            clearTimeout(timer);
            resolve(alts);
          };
        });
        tookMs = Date.now() - t0;
        if (mic.current) mic.current.onFinal = null;
      }
      attempt -= 1;
      setRetrying(false);
      const sample: CalibrationSample = {
        word,
        heard: heard.map((h) => h.transcript),
        confidence: heard[0]?.confidence ?? null,
      };
      const { verdict, rescued } = scoreSample(sample);
      diag('test', 'kit-calibrate', {
        say: word.say,
        form: word.form,
        heard: sample.heard[0] ?? '',
        alternatives: sample.heard.slice(1).join(' | '),
        confidence: sample.confidence,
        offered: sample.heard.length,
        verdict,
        rescued,
        attempt,
        tookMs,
      });
      got.push(sample);
      setSamples([...got]);
      setLast(sample.heard[0] ? `Heard “${sample.heard[0]}” — ${verdict === 'right' ? 'right' : 'wrong'}` : 'Heard nothing — moving on');
      setLastRight(verdict === 'right');
      await wait(1000);
    }
    await ensureMic('closed');
    const s = summariseCalibration(got);
    diag('test', 'kit-calibrate-summary', {
      oneWord: `${s.oneWord.right}/${s.oneWord.total}`,
      twoWord: `${s.twoWord.right}/${s.twoWord.total}`,
      wrongAction: s.wrongAction,
      rescuable: s.rescuable,
    });
    setPhase('scored');
  };

  if (phase === 'ready') {
    return (
      <>
        <p className="testkit-instruction">
          A word appears with a tick. Say it. Twenty words, in pairs: <em>{calibrationAnnouncement()}</em> Then the same
          again. If it says &ldquo;Again&rdquo;, say the same word once more. If you can't look, just say the next word in that order after each tick.
        </p>
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void run()}>
          Start
        </button>
      </>
    );
  }
  if (phase === 'announcing') return <p className="testkit-note">Reading out the order…</p>;
  if (phase === 'listening') {
    const word = schedule.current[current]!;
    return (
      <>
        <p className="testkit-word" data-testid="testkit-word">
          {word.say}
        </p>
        <p className="testkit-listening">{retrying ? 'Didn’t catch that — say it again' : 'Listening… say it once'}</p>
        {last && (
          <p className={`testkit-heard ${lastRight ? 'testkit-heard-right' : 'testkit-heard-wrong'}`}>
            Last word: {last}
          </p>
        )}
        <p className="testkit-note">
          {current + 1} of {schedule.current.length}
        </p>
      </>
    );
  }
  const s = summariseCalibration(samples);
  return (
    <>
      <ul className="testkit-results" data-testid="testkit-calibration">
        <li>
          Single words: <strong>{s.oneWord.right}/{s.oneWord.total}</strong> right
        </li>
        <li>
          Two-word forms: <strong>{s.twoWord.right}/{s.twoWord.total}</strong> right
        </li>
        <li>Heard as a different move: {s.wrongAction}</li>
        {s.misheard.length > 0 && <li>Misheard: {s.misheard.map((m) => `${m.said} → ${m.heard}`).join(', ')}</li>}
        {last && samples.length === 0 && <li>{last}</li>}
      </ul>
      <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done')}>
        Next
      </button>
    </>
  );
}

/* ------------------------------------------------------------------------ */
/* "Bluetooth: phone mic?" kit                                                */
/* ------------------------------------------------------------------------ */

const FINGER_WINDOW_MS = 3000;
const FINGER_WORD = 'hello';

function PhoneInputsStep({ run, onAnswer }: StepProps) {
  const [devices, setDevices] = useState<InputDevice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const go = async () => {
    setBusy(true);
    const r = await listInputsAfterGrant();
    const phone = pickPhoneInput(r.devices);
    const car = pickCarInput(r.devices, phone);
    run.current.phone = phone;
    run.current.car = car;
    run.current.inputCount = r.devices.length;
    diag('test', 'kit-inputs', {
      count: r.devices.length,
      labels: r.devices.map((d) => d.label || '(no label)').join(' | '),
      ids: r.devices.map((d) => d.deviceId || '(no id)').join(' | '),
      permissionError: r.error ?? '',
      chosen: phone.label,
      chosenId: phone.deviceId,
      matchedIphone: phone.matched,
      car: car?.label ?? '',
      carId: car?.deviceId ?? '',
      session: readAudioSessionType(),
    });
    setDevices(r.devices);
    setNote(r.error ? `The microphone permission failed (${r.error}).` : '');
    setBusy(false);
  };

  const phone = run.current.phone;
  return (
    <>
      <p className="testkit-instruction">
        Press List. The app asks for the microphone once, reads the names of every input, and picks the iPhone one on
        its own.
      </p>
      {!devices && (
        <button type="button" className="u-btn u-btn-primary testkit-go" disabled={busy} onClick={() => void go()}>
          List inputs
        </button>
      )}
      {note && <p className="testkit-note">{note}</p>}
      {devices && (
        <>
          <ul className="testkit-results" data-testid="testkit-inputs">
            {devices.map((d) => (
              <li key={d.deviceId + d.label}>
                <strong>{d.label || '(no label)'}</strong> · {d.deviceId.slice(0, 10) || 'no id'}
                {phone && d.deviceId === phone.deviceId ? ' · chosen' : ''}
                {run.current.car && d.deviceId === run.current.car.deviceId ? ' · car' : ''}
              </li>
            ))}
            {devices.length === 0 && <li>No inputs listed.</li>}
          </ul>
          <p className="testkit-note">
            {phone?.matched
              ? `Using "${phone.label}".`
              : 'No input is named iPhone, so "default" will be used. Later checks are weaker.'}
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done', { count: devices.length })}>
            Next
          </button>
        </>
      )}
    </>
  );
}

function PhoneProbeStep({ run, onAnswer }: StepProps) {
  const [rows, setRows] = useState<Array<{ name: string; r: MicProbeResult }> | null>(null);
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    const out: Array<{ name: string; r: MicProbeResult }> = [];
    const phone = run.current.phone ?? { deviceId: 'default', label: 'default', matched: false };
    const pr = await probeMicSpectrum({ deviceId: phone.deviceId, ms: 4000 });
    run.current.phoneProbe = { verdict: pr.verdict, highRatio: pr.highRatio, error: pr.error };
    diag('test', 'kit-phone-probe', {
      which: 'phone',
      deviceId: phone.deviceId,
      verdict: pr.verdict,
      highRatio: pr.highRatio,
      highBins: pr.highBins,
      label: pr.label,
      trackSampleRate: pr.trackSampleRate,
      contextSampleRate: pr.contextSampleRate,
      error: pr.error ?? '',
    });
    out.push({ name: `Phone (${phone.label})`, r: pr });
    setRows([...out]);
    const car = run.current.car;
    if (car) {
      const cr = await probeMicSpectrum({ deviceId: car.deviceId, ms: 4000 });
      run.current.carProbe = { verdict: cr.verdict, highRatio: cr.highRatio, error: cr.error };
      diag('test', 'kit-phone-probe', {
        which: 'car',
        deviceId: car.deviceId,
        verdict: cr.verdict,
        highRatio: cr.highRatio,
        highBins: cr.highBins,
        label: cr.label,
        trackSampleRate: cr.trackSampleRate,
        error: cr.error ?? '',
      });
      out.push({ name: `Car (${car.label})`, r: cr });
      setRows([...out]);
    } else {
      run.current.carProbe = null;
      diag('test', 'kit-phone-probe', { which: 'car', skipped: 'no-car-input-listed' });
    }
    setBusy(false);
  };

  return (
    <>
      <p className="testkit-instruction">
        Press Start, then count out loud from one to ten at normal volume until it says done. It measures the phone
        input for four seconds{run.current.car ? ', then the car input for four more' : ''}.
      </p>
      {!rows && (
        <button type="button" className="u-btn u-btn-primary testkit-go" disabled={busy} onClick={() => void go()}>
          Start
        </button>
      )}
      {rows && (
        <ul className="testkit-results" data-testid="testkit-probe-rows">
          {rows.map(({ name, r }) => (
            <li key={name}>
              <strong>{name}</strong>: {r.error ? `failed (${r.error})` : `${r.verdict} · high ${r.highRatio.toFixed(3)}`}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="testkit-note">Measuring… keep counting.</p>}
      {rows && !busy && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done', { probes: rows.length })}>
          Next
        </button>
      )}
    </>
  );
}

function PhoneFingerStep({ run, ensureInput, onAnswer }: StepProps) {
  type Phase = 'ready' | 'opening' | 'cover' | 'measuring-covered' | 'uncover' | 'measuring-open' | 'done' | 'failed';
  const [phase, setPhase] = useState<Phase>('ready');
  const [note, setNote] = useState('');
  const covered = useRef(0);

  const open = async () => {
    setPhase('opening');
    const held = await ensureInput();
    if ('error' in held) {
      setNote(`The input did not open (${held.error}).`);
      setPhase('failed');
      return;
    }
    setNote(`Holding "${held.label}" open.`);
    setPhase('cover');
  };

  const measure = async (which: 'covered' | 'open') => {
    const held = await ensureInput();
    if ('error' in held) {
      setNote(`The input did not open (${held.error}).`);
      setPhase('failed');
      return;
    }
    setPhase(which === 'covered' ? 'measuring-covered' : 'measuring-open');
    tick();
    const m = await held.measure(FINGER_WINDOW_MS);
    tick();
    diag('test', 'kit-finger-window', { which, rms: m.rms, peak: m.peak, frames: m.frames });
    if (which === 'covered') {
      covered.current = m.rms;
      setPhase('uncover');
      return;
    }
    run.current.finger = { coveredRms: covered.current, openRms: m.rms };
    const f = fingerVerdict(covered.current, m.rms);
    diag('test', 'kit-finger', {
      coveredRms: covered.current,
      openRms: m.rms,
      ratio: f.ratio,
      db: f.db,
      verdict: f.verdict,
    });
    setNote(
      f.verdict === 'no-signal'
        ? 'Nothing was heard when uncovered.'
        : `Covered was ${Math.round(f.ratio * 100)}% of uncovered (${f.db.toFixed(1)} dB): ${f.verdict}.`,
    );
    setPhase('done');
  };

  return (
    <>
      {phase === 'ready' && (
        <>
          <p className="testkit-instruction">
            This opens the phone input and keeps it open for the next steps. You will cover the small holes on the
            bottom edge of the phone with a fingertip for 3 seconds, then uncover them for 3 seconds, saying "{FINGER_WORD}"
            over and over both times.
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void open()}>
            Open the input
          </button>
        </>
      )}
      {phase === 'opening' && <p className="testkit-note">Opening…</p>}
      {phase === 'cover' && (
        <>
          <p className="testkit-instruction">Cover the bottom mic holes now. Then press the button and say "{FINGER_WORD}" repeatedly.</p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void measure('covered')}>
            Covered: start 3 seconds
          </button>
        </>
      )}
      {phase === 'measuring-covered' && <p className="testkit-word">covered: say "{FINGER_WORD}"</p>}
      {phase === 'uncover' && (
        <>
          <p className="testkit-instruction">Uncover the holes. Press the button and say "{FINGER_WORD}" repeatedly again.</p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void measure('open')}>
            Uncovered: start 3 seconds
          </button>
        </>
      )}
      {phase === 'measuring-open' && <p className="testkit-word">uncovered: say "{FINGER_WORD}"</p>}
      {note && <p className="testkit-note" data-testid="testkit-finger-note">{note}</p>}
      {(phase === 'done' || phase === 'failed') && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer(phase)}>
          Next
        </button>
      )}
    </>
  );
}

function PhoneRouteStep({ step, run, ensureInput, onAnswer }: StepProps & { step: Extract<KitStep, { kind: 'phone-route' }> }) {
  const order = useRef(blindOrder(step.trials));
  const [trial, setTrial] = useState(0);
  const [state, setState] = useState<'ready' | 'working' | 'played' | 'done'>('ready');
  const [note, setNote] = useState('');
  const results = useRef<RouteRow[]>([]);

  const play = async () => {
    unlockWebAudio();
    setState('working');
    setNote('');
    // The chosen input stays open for every play; this only reopens it if an
    // earlier step was skipped.
    const held = await ensureInput();
    if ('error' in held) setNote(`The input did not open (${held.error}). Answer what you hear anyway.`);
    const url = await routeClipUrl();
    if (!url) {
      setNote('No recorded clip is available.');
      setState('played');
      return;
    }
    setNote('Playing…');
    const result = await playThrough(order.current[trial]!, url);
    setNote(result === 'ended' ? '' : `Playback failed (${result}).`);
    setState('played');
  };

  const answer = (a: string) => {
    const path = order.current[trial]!;
    results.current.push({ path, answer: a });
    diag('test', 'kit-blind', { step: step.id, trial: trial + 1, of: step.trials, path, answer: a, input: 'phone-held' });
    if (trial + 1 >= step.trials) {
      run.current.route = [...results.current];
      diag('test', 'kit-phone-route', {
        overall: routeVerdict(results.current),
        element: routeVerdict(results.current.filter((r) => r.path === 'element')),
        webaudio: routeVerdict(results.current.filter((r) => r.path === 'webaudio')),
      });
      setState('done');
    } else {
      setTrial(trial + 1);
      setState('ready');
    }
  };

  if (state === 'done') {
    const tally = (path: string) => {
      const rows = results.current.filter((r) => r.path === path);
      const hit = rows.filter((r) => r.answer === step.target).length;
      const where = rows.map((r) => r.answer).join(', ');
      return `${hit} of ${rows.length} on the ${step.target.toLowerCase()}${where ? ` (${where})` : ''}`;
    };
    return (
      <>
        <ul className="testkit-results" data-testid="testkit-phone-route-result">
          <li>
            Normal playback: <strong>{tally('element')}</strong>
          </li>
          <li>
            Web Audio: <strong>{tally('webaudio')}</strong>
          </li>
        </ul>
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done', { element: tally('element'), webaudio: tally('webaudio') })}>
          Next
        </button>
      </>
    );
  }

  return (
    <>
      <p className="testkit-instruction">
        Play {trial + 1} of {step.trials}. Press Play, listen, and tap where it came from. The phone input stays open
        for all of them.
      </p>
      <button type="button" className="u-btn u-btn-primary testkit-go" disabled={state === 'working'} onClick={() => void play()}>
        {state === 'played' ? 'Play again' : 'Play'}
      </button>
      {note && <p className="testkit-note">{note}</p>}
      {state === 'played' && (
        <div className="testkit-answers">
          {step.answers.map((a) => (
            <button key={a} type="button" className="u-btn testkit-answer" onClick={() => answer(a)}>
              {a}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PhoneRecogniseStep({ run, mic, ensureMic, ensureInput, onAnswer }: StepProps) {
  type Phase = 'ready' | 'wait-covered' | 'listening' | 'wait-open' | 'scored' | 'failed';
  const [phase, setPhase] = useState<Phase>('ready');
  const [round, setRound] = useState<'covered' | 'uncovered'>('covered');
  const [current, setCurrent] = useState(0);
  const [last, setLast] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [note, setNote] = useState('');
  const schedule = useRef(calibrationSchedule(1));
  const samples = useRef<{ covered: CalibrationSample[]; uncovered: CalibrationSample[] }>({ covered: [], uncovered: [] });
  const cancelled = useRef(false);
  const [acc, setAcc] = useState<{ covered: number; uncovered: number } | null>(null);

  useEffect(() => () => void (cancelled.current = true), []);

  const open = async () => {
    // The phone-input stream first, then the recogniser on top of it: the
    // recogniser captures from whatever the route input is by then.
    const held = await ensureInput();
    if ('error' in held) diag('test', 'kit-phone-recognise-note', { input: held.error });
    const err = await ensureMic('open');
    if (err || !mic.current) {
      setNote(`The recogniser did not open (${err ?? 'unknown'}).`);
      setPhase('failed');
      return;
    }
    setPhase('wait-covered');
  };

  const listen = async (which: 'covered' | 'uncovered') => {
    setRound(which);
    setPhase('listening');
    const got: CalibrationSample[] = [];
    for (let i = 0; i < schedule.current.length && !cancelled.current; i++) {
      const word = schedule.current[i]!;
      setCurrent(i);
      let heard: Array<{ transcript: string; confidence: number }> = [];
      let attempt = 1;
      for (; attempt <= 2 && heard.length === 0 && !cancelled.current; attempt++) {
        setRetrying(attempt === 2);
        tick();
        heard = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve([]), WORD_SLOT_MS);
          if (!mic.current) return resolve([]);
          mic.current.onFinal = (alts) => {
            clearTimeout(timer);
            resolve(alts);
          };
        });
        if (mic.current) mic.current.onFinal = null;
      }
      setRetrying(false);
      const sample: CalibrationSample = {
        word,
        heard: heard.map((h) => h.transcript),
        confidence: heard[0]?.confidence ?? null,
      };
      const { verdict, rescued } = scoreSample(sample);
      diag('test', 'kit-phone-recognise', {
        round: which,
        say: word.say,
        form: word.form,
        heard: sample.heard[0] ?? '',
        alternatives: sample.heard.slice(1).join(' | '),
        confidence: sample.confidence,
        verdict,
        rescued,
        attempt: attempt - 1,
      });
      got.push(sample);
      setLast(sample.heard[0] ? `Heard “${sample.heard[0]}”, ${verdict === 'right' ? 'right' : 'wrong'}` : 'Heard nothing');
      await wait(900);
    }
    samples.current[which] = got;
    if (which === 'covered') {
      setPhase('wait-open');
      return;
    }
    await ensureMic('closed');
    const c = accuracyOf(summariseCalibration(samples.current.covered));
    const u = accuracyOf(summariseCalibration(samples.current.uncovered));
    run.current.recognise = { covered: c, uncovered: u };
    diag('test', 'kit-phone-recognise-summary', {
      covered: c,
      uncovered: u,
      verdict: recogniseVerdict(c, u),
    });
    setAcc({ covered: c, uncovered: u });
    setPhase('scored');
  };

  return (
    <>
      {phase === 'ready' && (
        <>
          <p className="testkit-instruction">
            Ten words, twice. First with a fingertip over the phone’s bottom mic holes, then uncovered. A word appears
            with a tick; say it once.
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void open()}>
            Start
          </button>
        </>
      )}
      {phase === 'wait-covered' && (
        <>
          <p className="testkit-instruction">Round 1 of 2: COVER the phone’s mic holes, then press the button.</p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void listen('covered')}>
            Covered: begin
          </button>
        </>
      )}
      {phase === 'wait-open' && (
        <>
          <p className="testkit-instruction">Round 2 of 2: UNCOVER the mic holes, then press the button.</p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void listen('uncovered')}>
            Uncovered: begin
          </button>
        </>
      )}
      {phase === 'listening' && (
        <>
          <p className="testkit-note">{round === 'covered' ? 'Covered round' : 'Uncovered round'}</p>
          <p className="testkit-word" data-testid="testkit-word">
            {schedule.current[current]!.say}
          </p>
          <p className="testkit-listening">{retrying ? 'Didn’t catch that, say it again' : 'Listening… say it once'}</p>
          {last && <p className="testkit-heard">Last word: {last}</p>}
          <p className="testkit-note">
            {current + 1} of {schedule.current.length}
          </p>
        </>
      )}
      {note && <p className="testkit-note">{note}</p>}
      {phase === 'scored' && acc && (
        <ul className="testkit-results" data-testid="testkit-phone-recognise-result">
          <li>
            Covered: <strong>{Math.round(acc.covered * 100)}%</strong> right
          </li>
          <li>
            Uncovered: <strong>{Math.round(acc.uncovered * 100)}%</strong> right
          </li>
        </ul>
      )}
      {(phase === 'scored' || phase === 'failed') && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer(phase)}>
          Next
        </button>
      )}
    </>
  );
}

function WheelPressStep({ step, run, ensureInput, onAnswer }: StepProps & { step: Extract<KitStep, { kind: 'wheel-press' }> }) {
  const [phase, setPhase] = useState<'ready' | 'waiting' | 'done'>('ready');
  const [left, setLeft] = useState(step.seconds);
  const [arrived, setArrived] = useState<string[]>([]);
  const cancelled = useRef(false);

  useEffect(
    () => () => {
      cancelled.current = true;
      // Restore: nothing else arms the probe on this screen.
      setMediaSessionProbe(null);
    },
    [],
  );

  const go = async () => {
    // The chosen input is what the car is reacting to; keep it open.
    await ensureInput();
    const actions: string[] = [];
    const t0 = Date.now();
    setMediaSessionProbe((action) => {
      actions.push(action);
      diag('test', 'kit-wheel-action', { action, atMs: Date.now() - t0 });
    });
    setPhase('waiting');
    tick();
    for (let s = step.seconds; s > 0 && !cancelled.current && !wheelArrived(actions); s--) {
      setLeft(s);
      await wait(1000);
    }
    setMediaSessionProbe(null);
    if (cancelled.current) return;
    run.current.wheel = { actions };
    const ok = wheelArrived(actions);
    const hasSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
    diag('test', 'kit-wheel', {
      arrived: ok,
      actions: actions.join(',') || '(none)',
      waitedMs: Date.now() - t0,
      mediaSession: hasSession,
    });
    setArrived(actions);
    setPhase('done');
  };

  return (
    <>
      {phase === 'ready' && (
        <>
          <p className="testkit-instruction">
            Press the button below, then press skip-forward on the steering wheel within {step.seconds} seconds.
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void go()}>
            Start
          </button>
        </>
      )}
      {phase === 'waiting' && (
        <>
          <p className="testkit-word">Press skip-forward on the wheel now</p>
          <p className="testkit-note">{left}s left</p>
        </>
      )}
      {phase === 'done' && (
        <>
          <p className="testkit-note" data-testid="testkit-wheel-result">
            {wheelArrived(arrived) ? `Arrived: ${arrived.join(', ')}.` : `Nothing arrived${arrived.length ? ` except ${arrived.join(', ')}` : ''}.`}
          </p>
          <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer(wheelArrived(arrived) ? 'arrived' : 'none')}>
            Next
          </button>
        </>
      )}
    </>
  );
}

function PhoneSummaryStep({ run, releaseAll, onAnswer }: StepProps) {
  const [summary] = useState(() => phoneMicSummary(run.current));

  useEffect(() => {
    // Everything held is released the moment the verdicts are on screen.
    void releaseAll();
    const flat: Record<string, unknown> = { overall: summary.overall, overallText: summary.overallText };
    for (const l of summary.lines) flat[l.id] = `${l.verdict}: ${l.text}`;
    diag('test', 'kit-phone-summary', flat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <p className="testkit-instruction" data-testid="testkit-phone-overall">
        <strong>{summary.overallText}</strong>
      </p>
      <ul className="testkit-results" data-testid="testkit-phone-summary">
        {summary.lines.map((l) => (
          <li key={l.id}>
            {l.question}: <strong>{l.verdict}</strong>. {l.text}
          </li>
        ))}
      </ul>
      <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer('done', { overall: summary.overall })}>
        Finish
      </button>
    </>
  );
}

function RecordStep({ step, kit, ensureMic, onAnswer, onRecording }: StepProps & { step: Extract<KitStep, { kind: 'record' }> }) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'saved' | 'failed'>('ready');
  const [shown, setShown] = useState('');
  const [error, setError] = useState('');

  const run = async () => {
    await ensureMic('closed');
    const rec = await startRecording();
    if ('error' in rec) {
      setError(rec.error);
      setPhase('failed');
      return;
    }
    setPhase('recording');
    if (step.what === 'words') {
      // One round is enough per place; each word is labelled at its tick.
      for (const w of calibrationSchedule(1)) {
        setShown(w.say);
        tick();
        rec.label(w.say);
        await wait(RECORD_SLOT_MS);
      }
    } else {
      for (let left = step.seconds; left > 0; left--) {
        setShown(`${left}s`);
        await wait(1000);
      }
    }
    const recording = await rec.stop();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    onRecording(`${kit}-${step.what}-${stamp}`, recording);
    setPhase('saved');
  };

  return (
    <>
      <p className="testkit-instruction">
        {step.what === 'words'
          ? 'Say each word as it appears, like you would in a drill. Ten words, 2.5 seconds each.'
          : `Stay quiet for ${step.seconds} seconds while it records the cabin. Keep driving normally.`}
      </p>
      {phase === 'ready' && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void run()}>
          Start recording
        </button>
      )}
      {phase === 'recording' && (
        <p className="testkit-word" data-testid="testkit-word">
          {shown}
        </p>
      )}
      {phase === 'failed' && <p className="testkit-note">Recording failed ({error}).</p>}
      {(phase === 'saved' || phase === 'failed') && (
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => onAnswer(phase)}>
          Next
        </button>
      )}
    </>
  );
}

function DoneView({ kit, recordings, onBack }: { kit: KitId; recordings: Array<{ name: string; rec: Recording }>; onBack: () => void }) {
  const [copied, setCopied] = useState('');
  const [saved, setSaved] = useState('');

  const copy = async () => {
    let since = '';
    try {
      since = store()?.getItem(START_KEY) ?? '';
    } catch {
      since = '';
    }
    const entries = readDiagnosticLog().filter((e) => !since || e.at >= since);
    try {
      // NAMED AS A SUBSET. This button copies only the lines since this kit
      // started, so without the scope line the file reads as the whole log and
      // an earlier run looks lost -- which is exactly how it was read on
      // 2026-10-06, after two car runs gave opposite results.
      // Only when something was ACTUALLY filtered out. With no start mark the
      // filter above keeps every line, and a full log must not carry a scope
      // warning it has not earned -- a header that always warns gets skipped.
      const scope = since
        ? `the ${KITS[kit].label} run started at ${since.slice(11, 19)}`
        : undefined;
      await navigator.clipboard.writeText(formatDiagnosticLog(entries, scope));
      setCopied(
        scope
          ? `Copied ${entries.length} lines from THIS run only. Earlier runs are in Settings → Diagnostic log.`
          : `Copied ${entries.length} lines. Paste them to Claude.`,
      );
    } catch {
      setCopied('Copy failed. Use Settings → Diagnostic log → Copy instead.');
    }
  };

  return (
    <div className="fieldtest-screen testkit-screen" data-testid="testkit-screen">
      <header className="fieldtest-topbar">
        <button type="button" className="u-btn" onClick={onBack}>
          Back
        </button>
        <h1 className="fieldtest-heading">{KITS[kit].label} — done</h1>
        <span />
      </header>
      <div className="testkit-body">
        <button type="button" className="u-btn u-btn-primary testkit-go" onClick={() => void copy()}>
          Copy results
        </button>
        {copied && <p className="testkit-note">{copied}</p>}
        <button
          type="button"
          className="u-btn testkit-go"
          disabled={recordings.length === 0}
          onClick={() => void exportRecordings(recordings).then((r) => setSaved(r))}
        >
          Save recordings ({recordings.length})
        </button>
        {saved && <p className="testkit-note">Recordings: {saved}.</p>}
        <p className="testkit-why">
          Recordings contain your voice. They stay on this phone until you save them, and they are never committed to
          the repository.
        </p>
      </div>
    </div>
  );
}
