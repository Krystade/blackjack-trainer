import { useRef, useState } from 'react';
import {
  runCarCheck,
  nextSteps,
  type CheckDefinition,
  type CheckResult,
} from '../../diag/carCheck';
import {
  audioOutCheck,
  clipVoiceCheck,
  mediaSlotCheck,
  wheelPressCheck,
  ambientCheck,
  measureWithWebAudio,
} from '../../diag/carCheckCatalog';
import { releaseAudioFocus } from '../../audio/audioFocus';
import { setVoiceOn } from '../voiceSession';
import { diag } from '../../diag/diagnosticLog';

/**
 * The car check, as a thing you press once.
 *
 * WHY IT IS NOT THE FIELD TEST. The field test is a protocol a person
 * follows, and every one of its steps ends in tapping a stamp -- which is why
 * the driving half had to be cut to four steps. But most of what those steps
 * establish is not a judgement: whether a sentence has a clip, whether an
 * element actually played, whether the media slot is held, how loud the cabin
 * is. The app can determine all of that exactly, and write it down itself.
 *
 * So this runs the evidence half. What is left for a person is pressing one
 * wheel button and listening -- neither of which needs a stamp, because the
 * app names the button that arrives and reports the rest at the end.
 *
 * THE MICROPHONE IS OPENED ONLY IN THE SECOND PHASE, and only to measure.
 * `measureWithWebAudio` takes a raw stream, reads it, and stops every track
 * in a `finally` -- no recognition session is involved at all. The recogniser
 * is explicitly switched OFF for the first phase, because an open microphone
 * flips the car to its hands-free profile and takes the wheel with it, which
 * would make the wheel check unable to pass.
 */
export function CarCheckPanel() {
  const [results, setResults] = useState<CheckResult[]>([]);
  const [running, setRunning] = useState(false);
  const [asking, setAsking] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const micOpen = useRef(false);

  /** A short real clip, so "did sound come out" is answered by real audio. */
  const makeAudio = (): HTMLAudioElement | null => {
    if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null;
    const base = import.meta.env.BASE_URL ?? '/';
    return new window.Audio(`${base}clips/af_bella/correct.mp3`);
  };

  const start = async () => {
    setRunning(true);
    setResults([]);
    setSteps([]);

    const checks: CheckDefinition[] = [
      clipVoiceCheck(),
      audioOutCheck(makeAudio),
      mediaSlotCheck(),
      // Under the e2e flag the wheel wait is short: a test driving a fake
      // button press should not sit through the twelve seconds a real
      // operator needs to get a hand to the wheel.
      wheelPressCheck(
        typeof window !== 'undefined' && window.location.search.includes('e2e=1')
          ? 1500
          : undefined,
      ),
      ambientCheck(measureWithWebAudio),
    ];

    const done: CheckResult[] = [];
    const run = await runCarCheck({
      checks,
      isMicOpen: () => micOpen.current,
      setMicOpen: async (open) => {
        micOpen.current = open;
        // The recogniser is a separate thing from the measurement stream, and
        // must be down for the whole speaker phase: it is what takes the
        // wheel away, and a wheel check run against it can only ever fail.
        if (!open) setVoiceOn(false, 'car-check');
      },
      log: (event, detail) => diag('test', `car-check:${event}`, detail),
      onProgress: (result) => {
        done.push(result);
        setResults([...done]);
        const next = checks[done.length];
        setAsking(next?.askOperator ?? null);
      },
    });

    setAsking(null);
    releaseAudioFocus('car-check');
    setSteps(nextSteps(run.results));
    setRunning(false);
  };

  const mark = (outcome: CheckResult['outcome']) =>
    outcome === 'pass' ? '✓' : outcome === 'fail' ? '✗' : outcome === 'warn' ? '?' : '–';

  return (
    <div className="carcheck" data-testid="carcheck">
      <div className="settings-note-row u-note">
        Runs the parts of the field test the app can answer on its own, in two phases: the speakers
        and the wheel first with the microphone shut, then the microphone alone to measure how loud
        it is. They cannot share a phase — an open microphone flips the car to its call profile,
        which takes the wheel and moves playback to the earpiece. You press one wheel button and
        listen; everything else it works out itself, and writes to the log.
      </div>

      <button
        type="button"
        className="fieldtest-stamp"
        data-testid="carcheck-start"
        disabled={running}
        onClick={() => void start()}
      >
        {running ? 'Running…' : 'Run the car check'}
      </button>

      {asking && (
        <p className="carcheck-ask" data-testid="carcheck-ask">
          {asking}
        </p>
      )}

      {results.length > 0 && (
        <ul className="carcheck-results" data-testid="carcheck-results">
          {results.map((r) => (
            <li key={r.id} data-testid={`carcheck-result carcheck-${r.outcome}`}>
              <span className="carcheck-mark" aria-hidden="true">
                {mark(r.outcome)}
              </span>{' '}
              <strong>{r.id}</strong> — {r.summary}
            </li>
          ))}
        </ul>
      )}

      {steps.length > 0 && (
        <div className="carcheck-next" data-testid="carcheck-next">
          <strong>Next:</strong>
          <ul>
            {steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
