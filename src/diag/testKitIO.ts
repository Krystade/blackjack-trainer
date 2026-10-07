/**
 * The test kit's contact with the phone: two ways to make a sound, a
 * microphone that can be held open, a recogniser for the calibration words,
 * and a recorder for the noise bench.
 *
 * Kept apart from testKit.ts so the step data and scoring can be unit-tested
 * without a browser, and so each primitive here is small enough to read
 * against what the log says it did.
 */

import { diag } from './diagnosticLog';
import { activeClipVoice, loadVoiceManifest, manifestLookup, playChimeTone, playClipsAsync } from '../audio/clips';
import { getSharedAudioContext } from '../audio/audioContext';
import { readAudioSessionType } from '../audio/audioSession';
import type { PlayPath } from './testKit';
import type { InputDevice } from './phoneMic';
import { openMicStream } from '../audio/openMicStream';
import { markMicSessionOpened } from '../audio/micSessionCost';

/** The line every route step plays. Long enough to place by ear. */
export const ROUTE_PHRASE = 'You have fourteen. Dealer shows ten.';

/**
 * A URL for one recorded clip of the route phrase in the current voice, or
 * null if the manifest has none. A single file rather than a chain, so the
 * two playback paths are handed byte-identical audio.
 */
export async function routeClipUrl(): Promise<string | null> {
  const voice = await activeClipVoice();
  if (!voice) return null;
  const manifest = await loadVoiceManifest(voice);
  const file =
    manifestLookup(manifest, ROUTE_PHRASE) ??
    manifestLookup(manifest, 'You have fourteen.') ??
    Object.values(manifest)[0] ??
    null;
  if (!file) return null;
  return `${import.meta.env.BASE_URL}clips/${voice}/${file}`;
}

/**
 * Wake the shared AudioContext INSIDE the tap, before any await.
 *
 * iOS lets a context leave 'suspended' only during a user gesture, and the
 * gesture's activation does not survive an await. The 2026-10-05 desk run
 * answered "heard nothing" to the first Web Audio play, with the mic never
 * opened -- either the ring switch (Web Audio obeys it, <audio> does not) or
 * this. Resuming here, and logging the state, separates the two.
 */
export function unlockWebAudio(): void {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    // A one-sample silent buffer started inside the gesture is what actually
    // unlocks output on older WebKit; resume() alone was not always enough.
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start();
  } catch {
    /* logged by the play that follows */
  }
}

/** Resolves when the sound has finished, or with the reason it could not. */
export async function playThrough(path: PlayPath, url: string): Promise<'ended' | string> {
  const ctxState = getSharedAudioContext()?.state ?? 'none';
  diag('test', 'kit-play', { path, session: readAudioSessionType(), audioContext: ctxState });
  try {
    if (path === 'element') {
      const audio = new Audio(url);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        setTimeout(resolve, 10000);
      });
      return 'ended';
    }
    const ctx = getSharedAudioContext();
    if (!ctx) return 'no-audio-context';
    if (ctx.state !== 'running') await ctx.resume();
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(bytes);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start();
      setTimeout(resolve, buffer.duration * 1000 + 2000);
    });
    return 'ended';
  } catch (e) {
    const why = e instanceof Error ? e.name : 'failed';
    diag('test', 'kit-play-failed', { path, why });
    return why;
  }
}

/** A short tick so a word slot can be followed without looking. */
export function tick(): void {
  try {
    // The chime path: Web Audio once a mic has opened (loud speaker / car),
    // the element before. A tick on the earpiece is a tick nobody hears.
    playChimeTone(880, 0.6);
  } catch {
    /* a missing tick costs nothing */
  }
}

/**
 * Say a fixed kit line from its recording, through the same path drills use;
 * the phone's own voice only if no recording exists.
 */
export async function sayRecorded(text: string): Promise<void> {
  const played = await playClipsAsync(text, { interrupt: true });
  if (!played) await say(text);
}

/** Speak a line with the system voice. Used before any mic has been opened. */
export function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    synth.speak(u);
    setTimeout(resolve, 2000 + text.length * 90);
  });
}

/* ------------------------------------------------------------------------ */
/* The microphone, held open by the real recogniser                          */
/* ------------------------------------------------------------------------ */

type Rec = {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }> & { isFinal: boolean }>;
      }) => void)
    | null;
};

export interface HeldMic {
  /** Set while results are wanted; called with every final result. */
  onFinal: ((alternatives: Array<{ transcript: string; confidence: number }>) => void) | null;
  /**
   * How many engine sessions have started since this mic was opened.
   *
   * A step records this when it opens a listening window and again when it
   * closes, so a window that heard nothing can be told apart from a window that
   * spanned a restart. Jack's car run of 2026-10-06 lost 7 of 20 windows to
   * `offered=0`, every one of them after a retry -- and a 6-second window with
   * no speech always ends the session, so a restart always sat between the two
   * attempts. Nothing recorded it, so the deafness was undiagnosable.
   */
  sessions(): number;
  close(): Promise<void>;
}

/**
 * Open the microphone the way the drills do -- the browser's own recogniser,
 * continuous -- because that is the capture whose routing is in question. A
 * bare getUserMedia stream is a different code path in WebKit and would answer
 * a question nobody asked.
 *
 * Resolves once audio is actually flowing (`onaudiostart`), or after a grace
 * period if the engine never says so.
 */
function recognitionCtor(): (new () => Rec) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export async function openMic(): Promise<HeldMic | { error: string }> {
  const Ctor = recognitionCtor();
  if (!Ctor) return { error: 'no-recogniser' };
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.maxAlternatives = 5;
  rec.lang = 'en-US';

  let alive = true;
  // Counts STARTS THAT SUCCEEDED, so a throwing restart does not inflate it.
  let sessions = 0;
  let ended: () => void = () => {};
  const endedP = new Promise<void>((r) => (ended = r));
  const held: HeldMic = {
    onFinal: null,
    sessions: () => sessions,
    close: async () => {
      if (!alive) return;
      alive = false;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      await Promise.race([endedP, new Promise((r) => setTimeout(r, 2000))]);
      diag('test', 'kit-mic-closed', { session: readAudioSessionType() });
    },
  };

  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (!r.isFinal) continue;
      const alts = Array.from({ length: r.length }, (_, k) => ({
        transcript: r[k]!.transcript.trim(),
        confidence: r[k]!.confidence,
      }));
      held.onFinal?.(alts);
    }
  };
  rec.onerror = (e) => diag('test', 'kit-mic-error', { error: e.error ?? 'unknown' });
  rec.onend = () => {
    ended();
    // The engine ends sessions on its own after silence. Keep it open for as
    // long as the step wants it, which is what a drill does too.
    if (alive) {
      try {
        rec.start();
        sessions += 1;
        /*
         * SAID OUT LOUD, which it was not.
         *
         * The restart was always correct; the silence about it was the problem.
         * A window that hears nothing for 6 seconds ALWAYS ends the session, so
         * a restart always sits between a failed attempt and its retry -- and a
         * word said during the gap is simply gone. In Jack's 2026-10-06 car run
         * every one of the 7 `offered=0` windows followed a retry, and the
         * export held no trace of a single restart, so "he said nothing" and
         * "the engine was between sessions" read identically.
         */
        diag('test', 'kit-mic-restart', { n: sessions, why: 'engine-ended' });
      } catch (e) {
        alive = false;
        /*
         * AND THE DEAD CASE LOUDEST OF ALL. If this throws, nothing ever opens
         * the microphone again and every remaining window of the run reads as
         * "heard nothing" -- which is indistinguishable from a vocabulary that
         * does not work, and would have been believed as one.
         */
        diag('test', 'kit-mic-dead', {
          after: sessions,
          why: e instanceof Error ? e.name : String(e),
        });
      }
    }
  };

  const started = Date.now();
  const audioStarted = new Promise<boolean>((resolve) => {
    rec.onaudiostart = () => resolve(true);
    setTimeout(() => resolve(false), 4000);
  });
  try {
    rec.start();
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'start-failed' };
  }
  sessions = 1;
  // A recogniser start opens the mic just as getUserMedia does.
  markMicSessionOpened();
  const heardAudio = await audioStarted;
  diag('test', 'kit-mic-open', {
    audiostart: heardAudio,
    afterMs: Date.now() - started,
    session: readAudioSessionType(),
  });
  return held;
}

/* ------------------------------------------------------------------------ */
/* Recording, for the desk noise bench                                       */
/* ------------------------------------------------------------------------ */

export interface Recording {
  blob: Blob;
  mime: string;
  /** Word slots, in ms from the start of the recording. */
  labels: Array<{ atMs: number; say: string }>;
}

function recorderMime(): string {
  const MR = (globalThis as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']) {
    if (MR?.isTypeSupported?.(t)) return t;
  }
  return '';
}

export interface ActiveRecorder {
  label(say: string): void;
  stop(): Promise<Recording>;
}

/**
 * Raw audio with the browser's own clean-up switched OFF. The bench needs the
 * cabin as the microphone hears it; noise suppression applied here would be
 * baked into the test data and every recogniser would be scored on audio no
 * recogniser actually receives.
 */
export async function startRecording(): Promise<ActiveRecorder | { error: string }> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    return { error: 'no-recorder' };
  }
  let stream: MediaStream;
  try {
    stream = await openMicStream({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    return { error: e instanceof Error ? e.name : 'getusermedia-failed' };
  }
  const mime = recorderMime();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const labels: Recording['labels'] = [];
  const t0 = Date.now();
  recorder.start(1000);
  const track = stream.getAudioTracks()[0];
  diag('test', 'kit-record-start', { mime: recorder.mimeType, input: track?.label ?? '' });

  return {
    label: (say) => labels.push({ atMs: Date.now() - t0, say }),
    stop: () =>
      new Promise<Recording>((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: recorder.mimeType || mime });
          diag('test', 'kit-record-stop', { bytes: blob.size, ms: Date.now() - t0, labels: labels.length });
          resolve({ blob, mime: blob.type, labels });
        };
        recorder.stop();
      }),
  };
}

function extensionFor(mime: string): string {
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('webm')) return 'webm';
  return 'audio';
}

/**
 * Hand recordings to the operator. The share sheet on a phone (Save to Files,
 * Mail, AirDrop), a download anywhere else. Labels travel as a JSON file
 * beside each recording so the bench knows where each word starts.
 */
export async function exportRecordings(
  items: Array<{ name: string; rec: Recording }>,
): Promise<'shared' | 'downloaded' | 'cancelled' | 'nothing'> {
  if (items.length === 0) return 'nothing';
  const files: File[] = [];
  for (const { name, rec } of items) {
    files.push(new File([rec.blob], `${name}.${extensionFor(rec.mime)}`, { type: rec.mime }));
    files.push(
      new File([JSON.stringify({ mime: rec.mime, labels: rec.labels }, null, 2)], `${name}.json`, {
        type: 'application/json',
      }),
    );
  }
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.canShare?.({ files }) && nav.share) {
    try {
      await nav.share({ files, title: 'Blackjack trainer recordings' });
      return 'shared';
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  return 'downloaded';
}

/* ------------------------------------------------------------------------ */
/* The phone-mic kit: a stream held open on one chosen input                  */
/* ------------------------------------------------------------------------ */

/**
 * Ask for the microphone once so labels are filled in, release it at once,
 * and return every audio input the browser names.
 */
export async function listInputsAfterGrant(): Promise<{ devices: InputDevice[]; error?: string }> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia || !media.enumerateDevices) return { devices: [], error: 'no-mediadevices' };
  let error: string | undefined;
  try {
    const s = await openMicStream({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch (e) {
    error = e instanceof Error ? e.name : 'getusermedia-failed';
  }
  const devices = (await media.enumerateDevices().catch(() => []))
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  return { devices, error };
}

export interface HeldInput {
  label: string;
  trackSampleRate: number | null;
  /** RMS and peak of the input over the next `ms`, not played anywhere. */
  measure(ms: number): Promise<{ rms: number; peak: number; frames: number }>;
  close(): Promise<void>;
}

/**
 * Hold a getUserMedia stream open on one device, with nothing played back and
 * no clean-up processing, so its level is the microphone's own. `exact` so a
 * device that cannot be honoured fails instead of quietly giving another.
 */
export async function openChosenInput(deviceId: string): Promise<HeldInput | { error: string }> {
  const media = navigator.mediaDevices;
  if (!media?.getUserMedia) return { error: 'no-getusermedia' };
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  try {
    stream = await openMicStream({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const track = stream.getAudioTracks()[0] ?? null;
    const Ctor: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    if (ctx.state !== 'running') await ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(analyser);
    // Deliberately not connected to the destination: mic to speaker is feedback.
    const buf = new Float32Array(analyser.fftSize);
    const s = stream;
    const c = ctx;
    const sr = track?.getSettings?.().sampleRate;
    const input: HeldInput = {
      label: track?.label ?? '',
      trackSampleRate: typeof sr === 'number' ? sr : null,
      measure: async (ms) => {
        let sumSq = 0;
        let n = 0;
        let peak = 0;
        let frames = 0;
        const until = Date.now() + ms;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 40));
          analyser.getFloatTimeDomainData(buf);
          frames += 1;
          for (let i = 0; i < buf.length; i++) {
            const v = buf[i]!;
            sumSq += v * v;
            n += 1;
            if (Math.abs(v) > peak) peak = Math.abs(v);
          }
        }
        return { rms: n ? Math.sqrt(sumSq / n) : 0, peak, frames };
      },
      close: async () => {
        s.getTracks().forEach((t) => t.stop());
        await c.close().catch(() => {});
        diag('test', 'kit-phone-stream-closed', { label: track?.label ?? '' });
      },
    };
    return input;
  } catch (e) {
    stream?.getTracks().forEach((t) => t.stop());
    await ctx?.close().catch(() => {});
    return { error: e instanceof Error ? e.name : 'failed' };
  }
}
