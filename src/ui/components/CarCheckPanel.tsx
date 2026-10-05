import { useRef, useState } from 'react';
import {
  runCarCheck,
  nextSteps,
  type CheckDefinition,
  type CheckResult,
} from '../../diag/carCheck';
import {
  audioGraphCheck,
  audioOutCheck,
  chimeAudibleCheck,
  clipSpeedCheck,
  clipVoiceCheck,
  elementVolumeCheck,
  mediaSlotCheck,
  outputRouteCheck,
  wheelPressCheck,
  ambientCheck,
  measureWithWebAudio,
} from '../../diag/carCheckCatalog';
import {
  buildCheck,
  handoffPhaseChecks,
  offlineClipCheck,
  storageCheck,
  wakeLockCheck,
} from '../../diag/deviceChecks';
import { activeClipVoice, loadVoiceManifest, manifestLookup } from '../../audio/clips';
import { parseVersion, runningBuildId, versionUrl } from '../../updateCheck';
import { releaseAudioFocus } from '../../audio/audioFocus';
import { playPooledTone } from '../../audio/clips';
import { setVoiceOn } from '../voiceSession';
import { diag } from '../../diag/diagnosticLog';

/**
 * Just enough of a recogniser to find out whether one will start.
 *
 * Not the app's `VoiceController`: that one restarts itself, backs off, holds
 * a wake lock and keeps a watchdog, all of which would make the measurement
 * about the controller rather than about the device.
 */
interface SpeechRecognitionLike {
  onstart: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

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

  /**
   * A clip URL to look for in the cache, or null when the recorded voice is
   * off. Asks the manifest the app actually loaded rather than guessing a
   * filename: a guess that happened to be absent would report a tunnel
   * failure that does not exist.
   */
  const clipUrlForCache = async (): Promise<string | null> => {
    const voice = await activeClipVoice();
    if (!voice) return null;
    const manifest = await loadVoiceManifest(voice);
    const file = manifestLookup(manifest, 'Correct.');
    if (!file) return null;
    const base = import.meta.env.BASE_URL ?? '/';
    return new URL(`${base}clips/${voice}/${file}`, window.location.href).toString();
  };

  /** Reading `localStorage` can itself throw in some privacy modes. */
  const probeStorage = () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  /**
   * Open a real recogniser and resolve when it is LIVE, which is what the
   * handoff pays after every spoken line.
   *
   * Deliberately a bare recogniser rather than `getUserMedia`. Acquiring a
   * raw stream is the cheap part; what Switch actually waits for is the
   * recognition session's own handshake, measured at `confirmedInMs=1233` on
   * the 2026-10-04 drive. Measuring the stream instead would report a cost
   * several times lower than the real one and make the setting look free.
   */
  const reopenRecogniser = (): Promise<boolean> => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const rec = new Ctor();
      const finish = (live: boolean) => {
        if (settled) return;
        settled = true;
        try {
          rec.abort();
        } catch {
          /* a recogniser that will not abort is not this check's problem */
        }
        resolve(live);
      };
      rec.onstart = () => finish(true);
      rec.onerror = () => finish(false);
      rec.onend = () => finish(false);
      // A recogniser that neither starts nor errors is the worst case and the
      // one that would hang the run: it resolves as a failure, which is the
      // honest reading -- the microphone did not come back.
      window.setTimeout(() => finish(false), 8000);
      try {
        rec.start();
      } catch {
        finish(false);
      }
    });
  };

  const start = async () => {
    setRunning(true);
    setResults([]);
    setSteps([]);

    const checks: CheckDefinition[] = [
      clipVoiceCheck(),
      audioOutCheck(makeAudio),
      /**
       * THE DEVICE-ONLY CHECKS, added 2026-10-03 for the reason Jack gave:
       * "you running the tests here on my computer vs me using the app on my
       * phone just doesn't equate." Every fault that reached the car this week
       * was invisible to all 719 end-to-end tests and obvious on the phone --
       * a graph that never wakes, a volume setter that may be ignored, a cue
       * that never sounds, clips stretched to twice their length. Headless
       * Chromium has none of those failure modes, so the checks have to run
       * where the failures are. See audio/carCheckCatalog.ts for what each one
       * caught.
       */
      audioGraphCheck(),
      elementVolumeCheck(makeAudio),
      chimeAudibleCheck(),
      clipSpeedCheck(makeAudio),
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
      /**
       * THE CAPABILITIES A DRIVE RESTS ON, added 2026-10-04 because the first
       * on-device suite was the wrong half. Jack: "This wasn't the main thing
       * I wanted to test. Supposed to test functionality more like the field
       * test rather than the logic which can start testing on the computer."
       *
       * Each of these is refused silently in conditions that only exist on a
       * phone -- a locked screen, a tunnel, private browsing, a PWA running
       * last week's shell -- and each one presents as the app simply stopping.
       */
      wakeLockCheck(),
      offlineClipCheck(clipUrlForCache),
      storageCheck(probeStorage()),
      buildCheck(runningBuildId, async () => {
        const res = await fetch(versionUrl(window.location.href), { cache: 'no-store' });
        if (!res.ok) return null;
        return parseVersion((await res.json()) as unknown);
      }),
      // Last, and in the microphone phase on purpose: it is the only check
      // whose answer depends on the microphone having been opened, which is
      // the event that moves the output to the earpiece.
      /**
       * Through the POOL, not `makeAudio`. This check runs last, about forty
       * seconds after the button press that started the run, and the
       * 2026-10-04 readings show what that costs a fresh element:
       * `output-route outcome=fail why=NotAllowedError`, twice, with Jack
       * never asked the one question the whole check exists for.
       */
      outputRouteCheck(() => {
        const base = import.meta.env.BASE_URL ?? '/';
        return playPooledTone(`${base}clips/af_bella/correct.mp3`, 1, {
          releaseAfterMs: 4000,
        });
      }),
      /**
       * AND THEN THE SAME QUESTION WITH THE MICROPHONE SHUT, which is the one
       * measurement the whole earpiece problem turns on and the one no
       * desktop browser can be asked. The pair is the experiment:
       * `output-route` above played with the microphone open, this plays with
       * it closed and playback declared, and the difference between what Jack
       * hears is the answer.
       *
       * The order inside the phase is `handoffPhaseChecks`'s, not this
       * array's, because reopening the microphone first would destroy the
       * thing being measured.
       */
      ...handoffPhaseChecks({
        playClip: () => {
          const base = import.meta.env.BASE_URL ?? '/';
          return playPooledTone(`${base}clips/af_bella/correct.mp3`, 1, {
            releaseAfterMs: 4000,
          });
        },
        reopenMic: reopenRecogniser,
      }),
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
        Runs the field-test checks the app can do on its own, in two parts. First the speakers and
        the steering wheel, with the microphone off. Then the microphone alone, to measure how loud
        the car is. They run separately because an open microphone switches the car to call mode,
        which takes over the wheel and moves sound to the earpiece. You press one wheel button and
        listen; the app checks everything else and saves the results to the log.
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
