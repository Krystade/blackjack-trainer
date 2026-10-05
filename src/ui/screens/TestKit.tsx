import { useEffect, useRef, useState } from 'react';
import type { Screen } from '../App';
import {
  KITS,
  KIT_PROGRESS_KEY,
  calibrationAnnouncement,
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
  openMic,
  playThrough,
  routeClipUrl,
  say,
  startRecording,
  tick,
  type HeldMic,
  type Recording,
} from '../../diag/testKitIO';
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
  const [fieldRun, setFieldRun] = useState(() => readFieldTestRun());
  useEffect(() => subscribeFieldTestRun(() => setFieldRun(readFieldTestRun())), []);

  useEffect(() => {
    if (resumed.current) diag('test', 'kit-resumed', { kit: resumed.current.kit, step: resumed.current.stepIndex });
    return () => {
      void mic.current?.close();
    };
  }, []);

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
      void mic.current?.close();
      mic.current = null;
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
          <h2 className="testkit-title">Still unanswered</h2>
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
              place. <em>All three.</em>
            </li>
            <li>
              <strong>Audible at speed, and the wheel after voice.</strong> Can you make out the words on the
              freeway, and does the wheel still work after the mic closes? <em>Freeway drive.</em>
            </li>
          </ul>
          <p className="testkit-lede">
            Pick where you are. Each one asks only what that place can answer, one step at a time. Everything goes
            into the diagnostic log; at the end you copy it and save the recordings.
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
            void mic.current?.close();
            mic.current = null;
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
  onAnswer: (value: string, extra?: Record<string, unknown>) => void;
  onRecording: (name: string, rec: Recording) => void;
  onReload: () => void;
}

function StepView(props: StepProps) {
  const { step } = props;
  switch (step.kind) {
    case 'route':
      return <RouteStep {...props} step={step} />;
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
  const [samples, setSamples] = useState<CalibrationSample[]>([]);
  const cancelled = useRef(false);

  useEffect(() => () => void (cancelled.current = true), []);

  const run = async () => {
    setPhase('announcing');
    await ensureMic('closed');
    await say(`Say each word when it appears. The order is: ${calibrationAnnouncement()}`);
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
      tick();
      const heard = await new Promise<Array<{ transcript: string; confidence: number }>>((resolve) => {
        const timer = setTimeout(() => resolve([]), WORD_SLOT_MS);
        mic.current!.onFinal = (alts) => {
          clearTimeout(timer);
          resolve(alts);
        };
      });
      if (mic.current) mic.current.onFinal = null;
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
      });
      got.push(sample);
      setSamples([...got]);
      setLast(sample.heard[0] ? `heard “${sample.heard[0]}” — ${verdict === 'right' ? 'right' : 'wrong'}` : 'heard nothing');
      await wait(400);
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
          again. If you can't look, just say the next word in that order after each tick.
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
        <p className="testkit-note">
          {current + 1} of {schedule.current.length} · {last}
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
      await navigator.clipboard.writeText(formatDiagnosticLog(entries));
      setCopied(`Copied ${entries.length} lines. Paste them to Claude.`);
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
