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
import { activeClipVoice, loadVoiceManifest, manifestLookup } from '../audio/clips';
import { getSharedAudioContext } from '../audio/audioContext';
import { readAudioSessionType } from '../audio/audioSession';
import { toneDataUri } from '../audio/tone';
import type { PlayPath } from './testKit';
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
    void new Audio(toneDataUri(880, 0.6)).play().catch(() => {});
  } catch {
    /* a missing tick costs nothing */
  }
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
  let ended: () => void = () => {};
  const endedP = new Promise<void>((r) => (ended = r));
  const held: HeldMic = {
    onFinal: null,
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
      } catch {
        alive = false;
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
