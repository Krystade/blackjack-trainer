import { useEffect, useRef, useState } from 'react';
import './audioRoute.css';
import { diag } from '../../diag/diagnosticLog';
import { ROUTE_ANSWERS, ROUTE_LINES, type RouteAnswer, type RouteKitStep } from '../../diag/routeKit';
import { listenForRouteAnswer, runRouteTrial } from '../../diag/routeKitIO';
import { sayRecorded, unlockWebAudio, type HeldMic } from '../../diag/testKitIO';
import { logRouteSnapshot, pickSpeakerOutput, type DetectedRoute, type RoutePlan } from '../../audio/audioRoute';

type Answer = (value: string, extra?: Record<string, unknown>) => void;

/** Step 1 of every Route kit: what is connected, then how to answer. */
export function RouteSnapshotStep({ onAnswer }: { onAnswer: Answer }) {
  const [route, setRoute] = useState<DetectedRoute | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    unlockWebAudio();
    setBusy(true);
    const r = await logRouteSnapshot('route-kit');
    setRoute(r);
    // Said BEFORE any microphone in the kit opens: it names every answer word,
    // so it must never be on while the recogniser listens.
    await sayRecorded(ROUTE_LINES.intro);
    setBusy(false);
  };

  return (
    <>
      <p className="testkit-instruction">
        After each line, say where you heard it: <strong>car</strong>, <strong>phone</strong>, <strong>headset</strong>,{' '}
        <strong>earpiece</strong> or <strong>nothing</strong>. Tapping works too.
      </p>
      {!route && (
        <button type="button" className="u-btn u-btn-primary testkit-go" disabled={busy} onClick={() => void start()}>
          Start
        </button>
      )}
      {route && (
        <>
          <ul className="routekit-snapshot" data-testid="routekit-snapshot">
            <li>Microphones: {route.inputs.join(', ') || 'none listed'}</li>
            <li>Outputs listed: {route.outputs.map((o) => o.label).join(', ') || 'none'}</li>
            <li>Can pick an output: {route.sinkIdSupported ? 'yes' : 'no'}</li>
            {route.kind === 'unknown' && <li>Names appear once the mic has been used. The next step opens it.</li>}
          </ul>
          <button
            type="button"
            className="u-btn u-btn-primary testkit-go"
            disabled={busy}
            onClick={() =>
              onAnswer('ok', {
                kind: route.kind,
                inputs: route.inputs.join(' | '),
                outputs: route.outputs.map((o) => o.label).join(' | ') || 'none',
                sinkId: route.sinkIdSupported,
              })
            }
          >
            Next
          </button>
        </>
      )}
    </>
  );
}

/**
 * One trial: apply the step's plan, open the mic, play, ask, and take the
 * answer by voice. Runs on its own as the step appears, so after Start the
 * kit needs no looking; Play again redoes it inside a tap if anything failed.
 */
export function RouteVoiceStep({
  step,
  ensureMic,
  mic,
  onAnswer,
}: {
  step: Extract<RouteKitStep, { kind: 'route-voice' }>;
  ensureMic: (want: 'open' | 'closed') => Promise<string | null>;
  mic: React.MutableRefObject<HeldMic | null>;
  onAnswer: Answer;
}) {
  const [phase, setPhase] = useState<'working' | 'asking' | 'done'>('working');
  const [note, setNote] = useState('Opening the microphone…');
  const [heard, setHeard] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const played = useRef('');
  const answered = useRef(false);

  const extra = (): Record<string, unknown> => ({
    strategy: step.strategy,
    hold: step.hold,
    path: step.path,
    mic: step.mic,
    played: played.current,
  });

  const answer = (a: RouteAnswer, via: 'voice' | 'tap', said?: string) => {
    if (answered.current) return;
    answered.current = true;
    cancel.current?.();
    onAnswer(a, { ...extra(), via, heard: said ?? '' });
  };

  const run = async () => {
    answered.current = false;
    cancel.current?.();
    setPhase('working');
    setHeard(null);
    setNote('Opening the microphone…');
    if (step.strategy === 'speaker-sink') {
      // The trial would quietly fall back to Web Audio, which is a different
      // question; skip it instead and say why in the log.
      const r = await logRouteSnapshot(`trial:${step.id}:check`);
      if (!(r.sinkIdSupported && pickSpeakerOutput(r))) {
        answered.current = true;
        diag('test', 'kit-route-skip', { step: step.id, why: r.sinkIdSupported ? 'no-speaker-output' : 'no-setSinkId' });
        onAnswer('skipped', { ...extra(), via: 'auto', why: r.sinkIdSupported ? 'no-speaker-output' : 'no-setSinkId' });
        return;
      }
    }
    const plan: RoutePlan = { strategy: step.strategy, hold: step.hold, evidence: 'drive-decides', why: `kit ${step.id}` };
    setNote(step.mic === 'quiet-close' ? 'Mic on, then off and silent for a moment…' : 'Playing…');
    const res = await runRouteTrial({ id: step.id, plan, path: step.path, mic: step.mic, ensureMic });
    played.current = res.played;
    if (answered.current) return;
    setNote(res.played === 'ended' ? '' : `The line did not play (${res.played}).`);
    setPhase('asking');
    if (res.micError || !mic.current) {
      setNote(`The microphone did not open (${res.micError ?? 'none'}). Tap the answer.`);
      return;
    }
    const l = listenForRouteAnswer(mic.current, step.id);
    cancel.current = l.cancel;
    const got = await l.result;
    if (got) {
      setHeard(got.answer);
      setPhase('done');
      answer(got.answer, 'voice', got.heard);
    }
  };

  const started = useRef(false);
  useEffect(() => {
    // Once per step, StrictMode's rehearsal mount included.
    if (started.current) return;
    started.current = true;
    void run();
    return () => cancel.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <p className="testkit-instruction">
        {phase === 'working' ? 'Listen.' : 'Where did it come from? Say it, or tap.'}
      </p>
      {note && <p className="testkit-note">{note}</p>}
      {heard && <p className="routekit-heard">{heard}</p>}
      <div className="routekit-answers">
        {ROUTE_ANSWERS.map((a) => (
          <button key={a} type="button" className="u-btn testkit-answer" onClick={() => answer(a, 'tap')}>
            {a}
          </button>
        ))}
      </div>
      <button type="button" className="u-btn" disabled={phase === 'working'} onClick={() => void run()}>
        Play again
      </button>
    </>
  );
}
