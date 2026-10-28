import { useEffect, useRef, useState } from 'react';
import './audioRoute.css';
import type { AudioSettings } from '../../store/types';
import {
  detectRoute,
  lastDetectedRoute,
  planRoute,
  type DetectedRoute,
  type RoutePref,
  type RouteStrategySetting,
} from '../../audio/audioRoute';
import { diag } from '../../diag/diagnosticLog';
import { openMic, type HeldMic } from '../../diag/testKitIO';
import { listenForRouteAnswer, runRouteTrial } from '../../diag/routeKitIO';
import { ROUTE_ANSWERS, describeRoute, expectedAnswer, type RouteAnswer } from '../../diag/routeKit';

const PREFS: Array<{ value: RoutePref; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'phone', label: 'Phone speaker' },
  { value: 'bluetooth', label: 'Bluetooth' },
];

const STRATEGIES: Array<{ value: RouteStrategySetting; label: string; note: string }> = [
  { value: 'auto', label: 'Auto', note: 'The way with the most evidence for the route in use.' },
  { value: 'web-audio', label: 'Web Audio', note: 'What drills do now. Loud speaker 7 of 7 with the mic on.' },
  {
    value: 'play-and-record',
    label: 'Declare play and record',
    note: 'Tells the phone before the mic opens, so nothing switches when it does. Untested.',
  },
  {
    value: 'speaker-sink',
    label: 'Speaker output',
    note: 'Sends recorded lines to the loud speaker by name, if the phone lists one. Untested.',
  },
];

type TestState =
  | { phase: 'idle' }
  | { phase: 'working'; note: string }
  | { phase: 'asking'; note: string }
  | { phase: 'done'; answer: RouteAnswer; via: 'voice' | 'tap'; heard?: string; expected: RouteAnswer };

/**
 * Settings -> In the car -> Audio route. The choice, what the phone says is
 * connected, the sound path behind it, and a one-tap test that plays a line
 * with the mic open and asks, by voice, where it was heard.
 */
export function AudioRouteSettings({
  audio,
  onChange,
  disabled,
}: {
  audio: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  disabled?: boolean;
}) {
  const pref: RoutePref = audio.audioRoute ?? 'auto';
  const strategy: RouteStrategySetting = audio.routeStrategy ?? 'auto';
  const [route, setRoute] = useState<DetectedRoute>(() => lastDetectedRoute());
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  const mic = useRef<HeldMic | null>(null);
  const cancelListen = useRef<(() => void) | null>(null);

  useEffect(() => {
    let live = true;
    void detectRoute().then((r) => live && setRoute(r));
    return () => {
      live = false;
      cancelListen.current?.();
      void mic.current?.close();
      mic.current = null;
    };
  }, []);

  const plan = planRoute(pref, strategy, route);

  const ensureMic = async (want: 'open' | 'closed'): Promise<string | null> => {
    await mic.current?.close();
    mic.current = null;
    if (want === 'closed') return null;
    const held = await openMic();
    if ('error' in held) return held.error;
    mic.current = held;
    return null;
  };

  const finish = (answer: RouteAnswer, via: 'voice' | 'tap', heard?: string) => {
    cancelListen.current?.();
    cancelListen.current = null;
    const r = lastDetectedRoute();
    setRoute(r);
    const expected = expectedAnswer(pref, r);
    diag('route', 'route-test', {
      answer,
      via,
      heard: heard ?? '',
      expected,
      ok: answer === expected,
      pref,
      strategy: plan.strategy,
      hold: plan.hold,
      route: r.kind,
      guess: r.guess ?? 'none',
      label: r.bluetooth?.label ?? r.first ?? 'none',
    });
    setTest({ phase: 'done', answer, via, heard, expected });
    void ensureMic('closed');
  };

  const runTest = async () => {
    setTest({ phase: 'working', note: 'Opening the microphone…' });
    const fresh = await detectRoute();
    setRoute(fresh);
    const p = planRoute(pref, strategy, fresh);
    const { played, micError } = await runRouteTrial({
      id: 'settings-test',
      plan: p,
      path: p.strategy === 'speaker-sink' ? 'element' : 'webaudio',
      mic: 'open',
      ensureMic,
    });
    setRoute(lastDetectedRoute());
    setTest({ phase: 'asking', note: played === 'ended' ? '' : `The line did not play (${played}).` });
    if (micError || !mic.current) return; // taps only
    const l = listenForRouteAnswer(mic.current, 'settings-test');
    cancelListen.current = l.cancel;
    const got = await l.result;
    if (got) finish(got.answer, 'voice', got.heard);
  };

  return (
    <div className="audio-route" data-testid="audio-route">
      <div className="settings-row">
        <span className="settings-label">Audio route</span>
        <div className="segmented" role="group" aria-label="Audio route">
          {PREFS.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`segmented-btn${o.value === pref ? ' segmented-btn-active' : ''}`}
              aria-pressed={o.value === pref}
              onClick={() => onChange({ audioRoute: o.value })}
              disabled={disabled}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-note-row u-note audio-route-detected" data-testid="audio-route-detected">
        <strong>Connected:</strong> {describeRoute(route)}
        <br />
        <strong>Plays through:</strong> {STRATEGIES.find((s) => s.value === plan.strategy)?.label}
        {plan.hold === 'phone' && ', listening on the phone mic'}
        {plan.hold === 'bluetooth' && `, listening on ${route.bluetooth?.label ?? 'the Bluetooth mic'}`}
        {' · '}
        <span className={`audio-route-evidence audio-route-evidence-${plan.evidence}`} data-testid="audio-route-evidence">
          {plan.evidence === 'measured' ? 'measured' : 'a drive decides'}
        </span>
      </div>
      <details className="drill-options audio-route-strategy">
        <summary>Sound path while listening</summary>
        <div className="audio-route-options" role="radiogroup" aria-label="Sound path while listening">
          {STRATEGIES.map((s) => (
            <label key={s.value} className="audio-route-option">
              <input
                type="radio"
                name="route-strategy"
                value={s.value}
                checked={strategy === s.value}
                onChange={() => onChange({ routeStrategy: s.value })}
                disabled={disabled}
              />
              <span>
                <span className="audio-route-option-label">{s.label}</span>
                <span className="audio-route-option-note">{s.note}</span>
              </span>
            </label>
          ))}
        </div>
      </details>
      <div className="audio-route-test">
        <button
          type="button"
          className="u-btn"
          data-testid="audio-route-test"
          disabled={disabled || test.phase === 'working' || test.phase === 'asking'}
          onClick={() => void runTest()}
        >
          Test this route
        </button>
        <span className="u-note audio-route-test-hint">Plays a line with the mic on, then asks where you heard it.</span>
      </div>
      {test.phase === 'working' && <p className="u-note audio-route-status">{test.note}</p>}
      {test.phase === 'asking' && (
        <div className="audio-route-ask" data-testid="audio-route-ask">
          <p className="u-note audio-route-status">
            {test.note && `${test.note} `}Where did it come from? Say it, or tap.
          </p>
          <div className="audio-route-answers">
            {ROUTE_ANSWERS.map((a) => (
              <button key={a} type="button" className="u-btn audio-route-answer" onClick={() => finish(a, 'tap')}>
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
      {test.phase === 'done' && (
        <p
          className={`u-note audio-route-status audio-route-result${test.answer === test.expected ? ' audio-route-result-ok' : ''}`}
          data-testid="audio-route-result"
        >
          {test.answer}
          {test.via === 'voice' ? ` (heard “${test.heard}”)` : ' (tapped)'}
          {test.answer === test.expected ? ' — as it should be.' : ` — expected ${test.expected}. Logged.`}
        </p>
      )}
    </div>
  );
}
