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
import {
  audioSessionSupported,
  outputRoutePreference,
  readAudioSessionType,
} from '../audio/audioSession';
import { getSharedAudioContext, resumeSharedAudioContext } from '../audio/audioContext';
import { cachedToneDataUri } from '../audio/tone';
import type { CheckDefinition, CheckResult } from './carCheck';

/** How long to wait for a wheel button before calling it inconclusive. */
export const WHEEL_WAIT_MS = 12_000;
/** How long to listen to the room. Long enough to catch a passing truck. */
export const AMBIENT_WINDOW_MS = 5_000;
/** The cue's pitch, for the chime check. Matches `ready` in speech.ts. */
export const CUE_TONE_HZ = 880;
/**
 * How much longer than its own duration a clip may take before it counts
 * as broken. 1.4x is well clear of decode and of the worst honest reading
 * on a healthy run, and well under the 1.47x and 2.48x the Web Audio route
 * produced on 2026-10-02.
 */
export const CLIP_SPEED_TOLERANCE = 1.4;

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
        /**
         * WITH THE TWO FACTS THAT NARROW IT. The verdict cannot be narrowed --
         * "nobody pressed" and "the car sent it to the radio" are genuinely
         * indistinguishable from inside the app -- but the 2026-10-04 run
         * warned twice with no detail whatsoever, which left the operator
         * nothing to weigh either.
         *
         * How long it waited decides whether a slow hand explains it. Whether
         * the silent hold was still playing decides whether a press COULD have
         * arrived: the hold is what makes this app the active media app, and
         * without it the car has no reason to send anything here.
         */
        const slotHeld = audioFocusElementIsPlaying();
        const waited = waitMs >= 1000 ? `${Math.round(waitMs / 1000)}` : (waitMs / 1000).toFixed(1);
        return warn(
          'wheel-press',
          `No button arrived in ${waited} seconds. Either none was pressed, or the car sent it somewhere else${
            slotHeld ? '' : ' -- and the silent hold had stopped, so it had nowhere to send it'
          }.`,
          { waitedMs: waitMs, slotHeld },
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
/* ------------------------------------------------------------------------ */
/* The checks that exist because the desktop suite cannot see any of this   */
/* ------------------------------------------------------------------------ */

/**
 * WHY THIS SECTION EXISTS, in Jack's words on 2026-10-03: "you running the
 * tests here on my computer vs me using the app on my phone just doesn't
 * equate."
 *
 * He is right, and the week proves it. Every fault that reached the car was
 * invisible to all 719 end-to-end tests and visible immediately on the phone:
 *
 *   - a Web Audio graph that never wakes, so every chime was silent
 *   - an output route that moves to the earpiece and stays there
 *   - clips stretched from 3.0s to 7.7s by a resampling path
 *   - `HTMLMediaElement.volume` possibly being read-only on iOS, still open
 *
 * Headless Chromium on Windows has a graph that always resumes, one output
 * route, no audio session and a writable `volume`. It cannot fail any of
 * these, which is the definition of a test that cannot fail.
 *
 * So they run HERE, on the device, in the browser that actually has the bug.
 * Each one below names the fault it would have caught.
 */

/**
 * Is the Web Audio graph actually awake?
 *
 * 2026-10-03, on the phone, twice on two page loads:
 *
 *   17:12:10.573  audio-unlock    reason=gesture state=suspended rate=48000
 *   17:12:18.556  chime           kind=ready volume=1
 *   17:12:18.658  chime-suspended kind=ready state=suspended
 *
 * A gesture resumed the context and it was still suspended eight seconds
 * later, so every chime was synthesised into silence while recorded clips
 * played perfectly. The chimes have since moved to a media element and no
 * longer depend on this -- which is exactly why it is worth checking rather
 * than assuming: if the graph is still dead, anything that drifts back into
 * it is silent, and nothing else in the app would say so.
 *
 * A dead graph WARNS rather than fails: nothing the drill does needs it any
 * more, so it is a fact to carry rather than a fault to stop for.
 */
export function audioGraphCheck(): CheckDefinition {
  return {
    id: 'audio-graph',
    label: 'The Web Audio graph wakes up',
    phase: 'speaker',
    run: async () => {
      const ctx = getSharedAudioContext();
      if (!ctx) return warn('audio-graph', 'This browser exposes no AudioContext.');
      resumeSharedAudioContext();
      // Resume is fire-and-forget and settles asynchronously; a graph that is
      // going to wake does it well inside this.
      await new Promise((r) => setTimeout(r, 400));
      const detail = { state: ctx.state, rate: ctx.sampleRate };
      return ctx.state === 'running'
        ? pass('audio-graph', 'The graph is running, so a generated tone would be heard.', detail)
        : warn(
            'audio-graph',
            `The graph is ${ctx.state} after a resume. Nothing in the drill needs it, but anything that used it would be silent.`,
            detail,
          );
    },
  };
}

/**
 * Does setting `volume` on an element do anything at all?
 *
 * STILL AN OPEN QUESTION, and it decides whether the app has any software
 * level control over its own voice. WebKit has long made
 * `HTMLMediaElement.volume` read-only on iOS -- the hardware buttons being the
 * only volume control -- and assignment is IGNORED rather than refused, so a
 * Volume setting that does nothing looks exactly like a clip that played
 * quietly. The `volume-ignored` line in clips.ts can only report it when a
 * clip happens to play at a non-default level; this asks directly.
 *
 * 0.37 deliberately: not 0, not 1, not 0.5, and not a value any code path in
 * the app would set on its own, so a reading of 0.37 cannot be a coincidence.
 */
export function elementVolumeCheck(makeAudio: () => HTMLAudioElement | null): CheckDefinition {
  return {
    id: 'element-volume',
    label: 'The app can set its own volume',
    phase: 'speaker',
    run: async () => {
      const el = makeAudio();
      if (!el) return fail('element-volume', 'This browser exposes no audio element at all.');
      const wanted = 0.37;
      try {
        el.volume = wanted;
      } catch (e) {
        return fail('element-volume', 'Setting the volume threw.', {
          why: e instanceof Error ? e.name : String(e),
        });
      }
      const got = el.volume;
      const detail = { wanted, got: Number(got.toFixed(3)) };
      return Math.abs(got - wanted) < 0.01
        ? pass('element-volume', 'The volume setting reaches the audio, so the slider works.', detail)
        : fail(
            'element-volume',
            `Ignored: asked for ${wanted}, reads back ${got.toFixed(2)}. The Volume setting cannot change the voice on this phone -- only the hardware buttons can.`,
            detail,
          );
    },
  };
}

/**
 * Does the microphone-open cue actually make a sound?
 *
 * "I didn't hear any chime indicating the mic was activated" was reported on
 * 2026-10-02 and was still true on 2026-10-03, through two different causes:
 * first the cue fired 70ms into a three-second prompt and was masked, then the
 * held cue fired into silence and the oscillator played into a suspended
 * graph. Both times the app believed it had chimed.
 *
 * The tone is generated WAV data played on a pooled element (audio/tone.ts),
 * so this plays one and waits for `ended`. An element that accepts `play()`
 * and never finishes is the exact shape of both failures.
 */
export function chimeAudibleCheck(): CheckDefinition {
  return {
    id: 'chime-audible',
    label: 'The microphone cue plays to the end',
    phase: 'speaker',
    askOperator: 'Listen for a short beep.',
    run: async () => {
      if (typeof window === 'undefined' || typeof window.Audio !== 'function') {
        return fail('chime-audible', 'This browser exposes no audio element at all.');
      }
      const el = new window.Audio();
      el.src = cachedToneDataUri(CUE_TONE_HZ);
      el.volume = 0.5;
      const startedAt = Date.now();
      const finished = new Promise<string>((resolve) => {
        el.onended = () => resolve('ended');
        el.onerror = () => resolve('error');
        // A 120ms tone that has not finished in two seconds has not played.
        setTimeout(() => resolve('timeout'), 2_000);
      });
      try {
        await el.play();
      } catch (e) {
        return fail('chime-audible', 'The phone refused to play the cue.', {
          why: e instanceof Error ? e.name : String(e),
        });
      }
      const how = await finished;
      const ms = Date.now() - startedAt;
      const detail = { how, ms };
      if (how === 'ended') {
        return pass('chime-audible', `The cue played and finished in ${ms}ms.`, detail);
      }
      return fail(
        'chime-audible',
        how === 'timeout'
          ? 'The cue started and never finished, so the beep was not heard.'
          : 'The cue could not be decoded.',
        detail,
      );
    },
  };
}

/**
 * Does a recorded line take as long as the recording?
 *
 * THE 2026-10-02 FAULT, measured. Above 100% the clips were routed through a
 * GainNode, and on the phone that stretched them:
 *
 *   "You have fifteen. Dealer shows five."   3029ms at 100%, 4455ms at 200%
 *   "You have ace, seven. Dealer shows six." 3099ms at 100%, 7687ms at 150%
 *
 * Choppy, then silent. The route is gone, and this is what would catch it
 * coming back -- or any other cause of the same thing, which is the point:
 * it measures the SYMPTOM rather than the mechanism. A clip whose wall time
 * runs far past its own duration is a clip the cabin hears break up,
 * whatever did it.
 *
 * The tolerance is generous on purpose. Decode and the gap between clips are
 * real time too, and a check that cries wolf on a slow first fetch is a check
 * that gets ignored.
 */
export function clipSpeedCheck(makeAudio: () => HTMLAudioElement | null): CheckDefinition {
  return {
    id: 'clip-speed',
    label: 'A recorded line plays at its own speed',
    phase: 'speaker',
    run: async () => {
      const el = makeAudio();
      if (!el) return fail('clip-speed', 'This browser exposes no audio element at all.');
      const ready = new Promise<boolean>((resolve) => {
        if (el.readyState >= 1) return resolve(true);
        el.onloadedmetadata = () => resolve(true);
        el.onerror = () => resolve(false);
        setTimeout(() => resolve(false), 5_000);
      });
      if (typeof el.load === 'function') el.load();
      if (!(await ready)) return warn('clip-speed', 'The clip never loaded, so nothing was timed.');

      const expectedMs = Math.round((el.duration || 0) * 1000);
      if (!expectedMs) return warn('clip-speed', 'The clip reports no duration, so nothing was timed.');

      const askedAt = Date.now();
      /**
       * FROM THE SOUND, NOT FROM THE REQUEST.
       *
       * This used to start the clock at the `play()` call, and the 2026-10-04
       * run read 1.26 and 1.23 on a phone that was stretching nothing: around
       * 170ms of decode and audio-route setup on a 696ms line, counted as
       * playback. Besides accusing the phone of a fault it did not have, it
       * spent the margin -- a 1.4 tolerance against a 1.25 baseline leaves
       * 0.15, and the fault this check exists for measured 1.47x.
       *
       * `playing` is the event that means sound is coming out. Where an
       * element never fires it, `startedAt` stays at the request and the
       * reading degrades to exactly what it used to be rather than to nothing.
       */
      let startedAt = askedAt;
      el.onplaying = () => {
        startedAt = Date.now();
      };
      const finished = new Promise<string>((resolve) => {
        el.onended = () => resolve('ended');
        el.onerror = () => resolve('error');
        // Four times the recording, which is past anything worth waiting for.
        setTimeout(() => resolve('timeout'), expectedMs * 4 + 2_000);
      });
      try {
        await el.play();
      } catch (e) {
        return fail('clip-speed', 'The phone refused to play the clip.', {
          why: e instanceof Error ? e.name : String(e),
        });
      }
      const how = await finished;
      const actualMs = Date.now() - startedAt;
      el.pause();
      const ratio = Number((actualMs / expectedMs).toFixed(2));
      // `startMs` is kept rather than discarded: a long wait before the first
      // word is its own symptom in a car, and it is the half of the old
      // reading that was real.
      const detail = { expectedMs, actualMs, ratio, startMs: startedAt - askedAt, how };
      if (how !== 'ended') {
        return fail('clip-speed', 'The clip started and never finished.', detail);
      }
      return ratio <= CLIP_SPEED_TOLERANCE
        ? pass('clip-speed', `A ${expectedMs}ms line took ${actualMs}ms. Nothing is stretching it.`, detail)
        : fail(
            'clip-speed',
            `A ${expectedMs}ms line took ${actualMs}ms (${ratio}x). The voice will sound choppy or drop out.`,
            detail,
          );
    },
  };
}

/**
 * Which speaker is the sound coming from, before and after the microphone?
 *
 * THE ONE THING ONLY A PERSON CAN ANSWER, and the fault that cost the most
 * this week. Jack, 2026-10-03: "Whenever I turn on the mic it switches my
 * speaker to the phone speaker like I'm on a phone call... It works fine until
 * I turn on voice and then it's stuck like that." Asked whether turning voice
 * off brings the loud speaker back: no, it stays on the earpiece for the rest
 * of the session.
 *
 * iOS puts the audio session into play-and-record the moment anything opens a
 * microphone, and play-and-record sends output to the receiver. I wrote here
 * that Safari exposes no part of the audio session to a page and there was
 * nothing to call. That was wrong: `navigator.audioSession` shipped in Safari
 * 17 and its `type` is the category -- see audio/audioSession.ts. So this now
 * REPORTS the category alongside the question, which is the measurement the
 * hardware-rate probe failed to be.
 *
 * IT IS STILL A QUESTION, because the category is what the app ASKED for and
 * the speaker is what the cabin HEARD, and those two came apart once already.
 * `warn` rather than `fail` on a bad answer: the earpiece is the platform's
 * behaviour today, not a regression. What the check is for is noticing the day
 * it changes -- in either direction.
 *
 * IT PLAYS THROUGH THE POOL, not a fresh element. The 2026-10-04 run reported
 * `fail why=NotAllowedError` twice and never asked Jack anything: this check
 * runs last, roughly forty seconds after the gesture that started the run and
 * after `getUserMedia`, and a brand-new `Audio` is locked by then. The pool's
 * elements were unlocked inside the gesture, which is the whole reason the
 * pool exists.
 */
export function outputRouteCheck(playClip: () => Promise<string>): CheckDefinition {
  return {
    id: 'output-route',
    label: 'Which speaker the voice comes out of',
    phase: 'microphone',
    askOperator:
      'Listen, then say where it came from: the loud speaker at the bottom of the phone, or the quiet earpiece at the top?',
    run: async () => {
      const asked = outputRoutePreference();
      const before = readAudioSessionType() ?? 'unknown';
      const how = await playClip();
      const session = {
        setting: asked,
        sessionSupported: audioSessionSupported(),
        sessionType: readAudioSessionType() ?? 'unknown',
        sessionWas: before,
        how,
      };
      if (how !== 'ended') {
        // A sound that never reached the cabin leaves NOTHING to judge, and
        // the honest verdict is that the check did not run -- not that the
        // route is bad.
        return fail(
          'output-route',
          `Nothing played (${how}), so there was nothing to listen to.`,
          session,
        );
      }
      // Deliberately inconclusive on its own: the verdict is the operator's,
      // and recording it as a pass would be the app answering its own
      // question. The panel asks; this only guarantees there was a sound to
      // judge, and says which category the session was in while it played.
      return warn(
        'output-route',
        `Played with the microphone open, session type "${session.sessionType}". Only you can say which speaker that was.`,
        session,
      );
    },
  };
}

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
