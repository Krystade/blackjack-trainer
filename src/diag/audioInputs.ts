/**
 * The audio inputs the phone offers, and an ambient reading taken on one of
 * them. Used by the field test's ambient step and its microphone sweep.
 *
 * Moved out of carCheckCatalog.ts (A122) when the car-check runner and its
 * checks were deleted: nothing had called runCarCheck since the Test kit took
 * over every check (551ed72), and these two were the catalog's only live
 * exports.
 */

import { foldFrames, type NoiseReading } from './ambientNoise';
import { diag } from './diagnosticLog';
import { openMicStream } from '../audio/openMicStream';

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
  const stream = await openMicStream({
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
