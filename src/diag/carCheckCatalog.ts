/**
 * The real checks, wired to real browser APIs.
 *
 * Split from carCheck.ts so the sequencing -- the phase invariant, the
 * microphone discipline, the failure handling -- stays testable without a
 * browser, and so the awkward parts (an element that has to genuinely play,
 * an AnalyserNode that has to genuinely hear something) are isolated here.
 */

import { loadVoiceManifest, segmentForClips, activeClipVoice } from '../audio/clips';
import { narrateAnswerEcho, ANSWER_ECHO_LABELS } from '../audio/narrate';
import { holdAudioFocus, releaseAudioFocus, audioFocusElementIsPlaying } from '../audio/audioFocus';
import { setMediaSessionProbe, MEDIA_SESSION_LABEL } from '../audio/mediaSession';
import { foldFrames, bandFor, adviceFor, type NoiseReading } from './ambientNoise';
import { diag } from './diagnosticLog';
import type { CheckDefinition, CheckResult } from './carCheck';

/** How long to wait for a wheel button before calling it inconclusive. */
export const WHEEL_WAIT_MS = 12_000;
/** How long to listen to the room. Long enough to catch a passing truck. */
export const AMBIENT_WINDOW_MS = 5_000;

const pass = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'pass',
  summary,
  detail,
});
const fail = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'fail',
  summary,
  detail,
});
const warn = (id: string, summary: string, detail?: Record<string, unknown>): CheckResult => ({
  id,
  outcome: 'warn',
  summary,
  detail,
});

/**
 * Does every line the drill speaks on an answer have a recorded clip?
 *
 * This is the check that would have caught the 2026-09-20 voice switch on a
 * driveway instead of costing a drive: the echo was composed in a view, never
 * entered the phrase list, never got a clip, and dropped to the phone's own
 * voice on every single answer.
 */
export function clipVoiceCheck(): CheckDefinition {
  return {
    id: 'clip-voice',
    label: 'Recorded voice covers what the drill says',
    phase: 'speaker',
    run: async () => {
      const voice = await activeClipVoice();
      if (!voice) {
        return warn('clip-voice', 'No clip voice is available to check against.');
      }
      const manifest = await loadVoiceManifest(voice);
      const texts = [...ANSWER_ECHO_LABELS.map((l) => narrateAnswerEcho(l)), 'Correct.', 'Wrong.'];
      const missing = texts.filter((t) => segmentForClips(t, manifest) === null);
      if (missing.length > 0) {
        return fail(
          'clip-voice',
          `${missing.length} of ${texts.length} lines have no clip, and will speak in the phone voice instead.`,
          { missing },
        );
      }
      return pass('clip-voice', `All ${texts.length} checked lines play from the recorded voice.`);
    },
  };
}

/**
 * Did sound actually come out?
 *
 * Asserted on the element having ADVANCED, not on `play()` resolving. A
 * resolved promise means the browser accepted the request; a currentTime that
 * moved means audio was rendered. In a car those come apart constantly.
 */
export function audioOutCheck(makeAudio: () => HTMLAudioElement | null): CheckDefinition {
  return {
    id: 'audio-out',
    label: 'Sound reaches the speakers',
    phase: 'speaker',
    askOperator: 'Listen. You should hear a short line.',
    run: async () => {
      const el = makeAudio();
      if (!el) return fail('audio-out', 'This browser exposes no audio element at all.');
      try {
        await el.play();
      } catch (e) {
        return fail('audio-out', 'The phone refused to play it.', {
          why: e instanceof Error ? e.name : String(e),
        });
      }
      await new Promise((r) => setTimeout(r, 1200));
      const advanced = el.currentTime > 0;
      el.pause();
      return advanced
        ? pass('audio-out', 'Audio played, and the clock moved while it did.', {
            currentTime: Number(el.currentTime.toFixed(2)),
          })
        : fail('audio-out', 'Accepted but never advanced, so nothing was actually rendered.');
    },
  };
}

/**
 * Is the app the phone active media app right now?
 *
 * The direct precondition for the wheel, and until 2026-09-21 it was
 * completely invisible: a dead wheel and a hold that never started produced
 * identical evidence.
 */
export function mediaSlotCheck(): CheckDefinition {
  return {
    id: 'media-slot',
    label: 'The phone treats this app as what is playing',
    phase: 'speaker',
    run: async () => {
      holdAudioFocus('car-check');
      await new Promise((r) => setTimeout(r, 400));
      if (!audioFocusElementIsPlaying()) {
        releaseAudioFocus('car-check');
        return fail(
          'media-slot',
          'The silent hold is not playing, so the wheel will reach the radio instead of this app.',
        );
      }
      return pass('media-slot', 'The hold is playing, so the wheel has something to reach.');
    },
  };
}

/**
 * Which button did the car actually send?
 *
 * The one place a person is still required, and deliberately the cheapest
 * possible ask: press anything, once. No stamping -- the app names what
 * arrived, which is the thing a stamp could only approximate.
 *
 * A timeout WARNS rather than fails. "Nobody pressed a button" and "the car
 * sent it to the radio" are different diagnoses and must not share a verdict.
 */
export function wheelPressCheck(waitMs = WHEEL_WAIT_MS): CheckDefinition {
  return {
    id: 'wheel-press',
    label: 'A wheel button reaches the app',
    phase: 'speaker',
    askOperator: 'Press any button on the steering wheel now.',
    run: async () => {
      const seen: string[] = [];
      setMediaSessionProbe((action) => seen.push(action));
      try {
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline && seen.length === 0) {
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        setMediaSessionProbe(null);
      }
      if (seen.length === 0) {
        return warn(
          'wheel-press',
          'No button arrived. Either none was pressed, or the car sent it somewhere else.',
        );
      }
      const named = seen
        .map((a) => MEDIA_SESSION_LABEL[a as keyof typeof MEDIA_SESSION_LABEL] ?? a)
        .join(', ');
      return pass(`wheel-press`, `The car sent: ${named}.`, { actions: seen });
    },
  };
}

/**
 * Open the microphone and listen to the room.
 *
 * A loud reading is NOT a failure: loud is a fact about the car, not a defect
 * in the app, and marking it red would train the operator to ignore red. Only
 * no-signal fails, because in a moving car that means the app is listening to
 * an input that is not the one in the room.
 */
export function ambientCheck(
  measure: (ms: number) => Promise<NoiseReading>,
  windowMs = AMBIENT_WINDOW_MS,
): CheckDefinition {
  return {
    id: 'ambient',
    label: 'How loud it is in here',
    phase: 'microphone',
    askOperator: 'Stay quiet for five seconds. This is measuring the room, not you.',
    run: async () => {
      let reading: NoiseReading;
      try {
        reading = await measure(windowMs);
      } catch (e) {
        // A refused or absent microphone is a fact about this device, and it
        // deserves a sentence the operator can act on rather than the
        // generic "the check itself failed" a thrown check would produce.
        return fail(
          'ambient',
          'The microphone could not be opened, so the room was never measured.',
          { why: e instanceof Error ? e.name : String(e) },
        );
      }
      if (reading.frames === 0) {
        return fail(
          'ambient',
          'The microphone produced no audio at all, which is not the same as a quiet room.',
        );
      }
      const band = bandFor(reading.dbfs);
      return pass('ambient', `${reading.dbfs.toFixed(1)} dBFS (${band}). ${adviceFor(band)}`, {
        dbfs: Number(reading.dbfs.toFixed(1)),
        peakDbfs: Number(reading.peakDbfs.toFixed(1)),
        band,
        frames: reading.frames,
      });
    },
  };
}

/** One microphone the phone is willing to hand over. */
export interface AudioInputChoice {
  deviceId: string;
  label: string;
}

/**
 * Every audio input the browser will admit to, so a reading can name the
 * hardware it was taken on.
 *
 * THE QUESTION THIS EXISTS FOR. Whether the phone's own microphone beats the
 * car's hands-free unit under road noise is an open product question, and the
 * app has never chosen between them -- it takes whatever it is handed, and
 * that has already been observed changing run to run within a single leg.
 * Two readings on two different pieces of hardware with two different DSP
 * chains are not a comparison unless each one says which it was.
 *
 * Never throws and never rejects: an input inventory is a diagnostic, and on
 * iOS `enumerateDevices` may be absent, may reject, and may return entries
 * whose labels are empty until permission has been granted once. An unnamed
 * input is kept -- dropping it would quietly turn a two-microphone sweep into
 * a one-microphone one and the export would look like a phone that only has
 * the one.
 */
export async function listAudioInputs(): Promise<AudioInputChoice[]> {
  try {
    const md = navigator.mediaDevices;
    if (typeof md?.enumerateDevices !== 'function') return [];
    const devices = await md.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || '(unnamed)' }));
  } catch {
    return [];
  }
}

/**
 * Measure the room with Web Audio, folding the frames into one reading.
 *
 * `deviceId` pins which microphone, for the sweep that compares them. Left
 * out, the phone chooses -- which is the behaviour every reading before
 * 2026-09-30 was taken under.
 */
export async function measureWithWebAudio(
  ms: number,
  signal?: AbortSignal,
  deviceId?: string,
): Promise<NoiseReading> {
  const w = window as unknown as {
    AudioContext?: new () => AudioContext;
    webkitAudioContext?: new () => AudioContext;
  };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor || !navigator.mediaDevices?.getUserMedia) return foldFrames([], ms);

  // CONSTRAINED, because the defaults edit the very thing being measured.
  // Safari turns on echo cancellation, noise suppression and automatic gain
  // control unless told otherwise, and AGC in particular destroys the absolute
  // level that an ambient reading IS. Left on, a loud cabin and a quiet one
  // converge toward the same number, and the figure's only use -- comparing
  // one condition against another -- is exactly what it cannot support.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // EXACT, and not `ideal`. A preference the browser is free to ignore
      // would hand back two readings from the SAME microphone under two
      // different device labels, which is worse than having no comparison:
      // it looks like an answer. An exact constraint that cannot be met
      // rejects instead, and the caller records that the input was refused.
      ...(deviceId === undefined ? {} : { deviceId: { exact: deviceId } }),
    },
  });
  const ctx = new Ctor();
  try {
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);

    // WHICH MICROPHONE, recorded with the reading. Over Bluetooth the input is
    // the car's hands-free unit; without it, the phone's own. The two readings
    // are taken on different hardware with different DSP, so a number with no
    // device name attached cannot be compared across the conditions it exists
    // to compare.
    const track = stream.getAudioTracks()[0];
    diag('route', 'ambient-input', {
      label: track?.label || '(unnamed)',
      // Whether the constraints above were actually honoured, which Safari
      // does not guarantee.
      agc: String(track?.getSettings?.().autoGainControl ?? 'unknown'),
      ns: String(track?.getSettings?.().noiseSuppression ?? 'unknown'),
    });

    const frames: Float32Array[] = [];
    const buf = new Float32Array(analyser.fftSize);
    const deadline = Date.now() + ms;
    // ABORTABLE, because the caller can leave. Without this the loop ran to its
    // full five seconds whatever happened on screen, and the `finally` below --
    // the only thing that stops the tracks -- could not run until it did. An
    // answer or a Pause tapped mid-measurement therefore left the microphone
    // open into the NEXT step, which on this app is not merely a privacy
    // surprise: the open microphone is the variable under test, so it corrupts
    // the following sample too.
    while (Date.now() < deadline && signal?.aborted !== true) {
      analyser.getFloatTimeDomainData(buf);
      frames.push(Float32Array.from(buf));
      await new Promise((r) => setTimeout(r, 100));
    }
    return foldFrames(frames, ms);
  } finally {
    // The measurement must never be the thing that leaves a microphone open.
    for (const track of stream.getTracks()) track.stop();
    void ctx.close();
  }
}
