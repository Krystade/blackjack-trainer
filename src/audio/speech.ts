/**
 * Thin, deliberately-untested-by-unit wrapper over the browser's speech and
 * audio APIs (`window.speechSynthesis`, `AudioContext`). This is the ONLY
 * file in the app allowed to touch those globals.
 *
 * Every export here is absence-guarded and never throws: unit tests run in
 * node, where `window`, `speechSynthesis`, and `AudioContext` are all
 * undefined, and this module must behave as a silent no-op there.
 *
 * `?e2e=1` in the page URL switches speak()/chime() into a log-only mode
 * (`window.__speechLog`) for Playwright assertions instead of calling the
 * real APIs. e2e mode is checked FIRST in speak()/speakAsync(), before the
 * clip gate below, so `?e2e=1` fully bypasses clips.ts too -- Web Audio is
 * never touched under e2e, keeping all existing e2e specs unaffected.
 *
 * Pre-rendered clip playback (`./clips.ts`) is layered on top: when clips
 * are enabled (`setClipsEnabled`, driven by `AudioSettings.useClips`) and a
 * `segmentForClips` cascade match exists for the text (possibly several
 * concatenated clips), speak()/speakAsync() play it instead of calling live
 * TTS, falling back to the live path below if the cascade misses or
 * playback fails. `opts.rate` flows through to clip playback too (clips.ts
 * forces `preservesPitch = true` so fast clip playback stays natural).
 * clips.ts has no store/React dependency, so this import doesn't change
 * speech.ts's dependency profile.
 */
import { hasClips, isClipsEnabled, playClipsAsync } from './clips';

declare global {
  interface Window {
    __speechLog?: string[];
  }
}

function hasWindow(): boolean {
  return typeof window !== 'undefined';
}

/** True when running under the Playwright e2e harness (`?e2e=1` in the URL). */
export function isE2eAudioMode(): boolean {
  return (
    hasWindow() &&
    typeof window.location !== 'undefined' &&
    typeof window.location.search === 'string' &&
    window.location.search.includes('e2e=1')
  );
}

function pushSpeechLog(entry: string): void {
  if (!hasWindow()) return;
  if (!window.__speechLog) {
    window.__speechLog = [];
  }
  window.__speechLog.push(entry);
}

/** True when this environment can actually speak (real speechSynthesis present). */
export function isSpeechSupported(): boolean {
  return hasWindow() && 'speechSynthesis' in window && !!window.speechSynthesis;
}

/** Available voices, or [] when unsupported. */
export function listVoices(): { name: string; voiceURI: string }[] {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices().map((v) => ({ name: v.name, voiceURI: v.voiceURI }));
  } catch {
    return [];
  }
}

/* ---------------------------------------------------------------------- */
/* Voice selection                                                        */
/* ---------------------------------------------------------------------- */

/**
 * The Web Speech API exposes no quality attribute on `SpeechSynthesisVoice`
 * (just `name`/`lang`/`voiceURI`/`localService`/`default`), so "pick a good
 * voice" is necessarily a curated heuristic over the name string. See
 * docs/research/2026-07-21-web-tts-options.md §1.
 */
const PREFERRED_VOICE_NAME_TOKENS = ['google', 'natural', 'neural', 'premium', 'enhanced', 'siri'];

/** Legacy SAPI voices and macOS novelty voices — the "robotic" complaints. */
const PENALIZED_VOICE_NAME_TOKENS = [
  'microsoft david',
  'microsoft zira',
  'microsoft mark',
  'espeak',
  'albert',
  'bad news',
  'zarvox',
];

const NAME_TOKEN_WEIGHT = 10;
/** Large enough that the language tier always dominates the name score. */
const LANG_EXACT_WEIGHT = 1000;
const LANG_FAMILY_WEIGHT = 500;

function scoreVoiceName(name: string): number {
  const lower = name.toLowerCase();
  let score = 0;
  for (const token of PREFERRED_VOICE_NAME_TOKENS) {
    if (lower.includes(token)) score += NAME_TOKEN_WEIGHT;
  }
  for (const token of PENALIZED_VOICE_NAME_TOKENS) {
    if (lower.includes(token)) score -= NAME_TOKEN_WEIGHT;
  }
  return score;
}

function scoreVoiceLang(voiceLang: string, targetLang: string): number {
  const lower = (voiceLang || '').toLowerCase();
  const target = targetLang.toLowerCase();
  const targetFamily = target.split('-')[0];
  if (lower.startsWith(target)) return LANG_EXACT_WEIGHT;
  if (targetFamily && lower.startsWith(targetFamily)) return LANG_FAMILY_WEIGHT;
  return 0;
}

/**
 * Picks the best-sounding available voice via a name/lang heuristic (pure,
 * no browser APIs touched). Deterministic: calling it twice on the same
 * list returns the same voice, regardless of input order. Returns `null`
 * for an empty list.
 */
export function pickBestVoice(
  voices: SpeechSynthesisVoice[],
  lang: string = 'en-US',
): SpeechSynthesisVoice | null {
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -Infinity;

  for (const voice of voices) {
    const score = scoreVoiceName(voice.name) + scoreVoiceLang(voice.lang, lang);
    const isBetter =
      best === null ||
      score > bestScore ||
      (score === bestScore && voice.name.localeCompare(best.name) < 0);
    if (isBetter) {
      best = voice;
      bestScore = score;
    }
  }

  return best;
}

function getRawVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSupported()) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

/**
 * Resolves a stored `voiceURI` preference to an actual voice.
 * - A real value is matched on `voiceURI` OR `name`: iOS/Safari can report
 *   different (or empty) `voiceURI` values than desktop for the very same
 *   voice, so URI-only matching silently breaks voice switching there.
 * - Missing/`'default'` falls back to `pickBestVoice` so users get a good
 *   voice without configuring anything.
 * - If nothing matches (a stale explicit preference, or no voices at all),
 *   returns `null` so the caller leaves `utterance.voice` unset rather than
 *   silently substituting something the user didn't choose.
 */
function resolveVoice(voiceURI: string | undefined): SpeechSynthesisVoice | null {
  const voices = getRawVoices();
  if (voiceURI && voiceURI !== 'default') {
    return voices.find((v) => v.voiceURI === voiceURI || v.name === voiceURI) ?? null;
  }
  return pickBestVoice(voices);
}

/** Stops any in-progress/queued speech and settles any pending speakAsync()
 * promise (Safari does not fire `onend` after `cancel()`, so we can't rely
 * on the event to unblock an awaiting caller). No-op when unsupported. */
export function cancelSpeech(): void {
  settleAllPendingSpeeches();
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // never throw
  }
}

/** The live-`speechSynthesis` path, used directly when clips are disabled/
 * absent, and as the fallback when a clip lookup misses or playback fails. */
function speakLive(text: string, opts?: { interrupt?: boolean; rate?: number; voiceURI?: string }): void {
  if (!isSpeechSupported()) return;

  try {
    if (opts?.interrupt) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (opts?.rate) {
      utterance.rate = opts.rate;
    }
    const voice = resolveVoice(opts?.voiceURI);
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // never throw
  }
}

/**
 * Speaks `text`. In e2e mode, records the raw text into `window.__speechLog`
 * instead of calling the real API (clips are fully bypassed in this mode).
 * Otherwise, when clips are enabled and a cascade match exists for `text`,
 * plays the concatenated clip(s) and falls back to live `speechSynthesis`
 * only if that fails. Never throws.
 */
export function speak(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; voiceURI?: string },
): void {
  if (isE2eAudioMode()) {
    pushSpeechLog(text);
    return;
  }

  if (isClipsEnabled() && hasClips(text)) {
    void playClipsAsync(text, { interrupt: opts?.interrupt, rate: opts?.rate }).then((played: boolean) => {
      if (!played) speakLive(text, opts);
    });
    return;
  }

  speakLive(text, opts);
}

/* ---------------------------------------------------------------------- */
/* speakAsync — speech-driven pacing primitive                            */
/* ---------------------------------------------------------------------- */

type PendingSpeech = {
  // Kept even though nothing else reads it: holding the utterance here is
  // what stops the engine from garbage-collecting it mid-speech.
  utterance: SpeechSynthesisUtterance;
  resolve: () => void;
  watchdog: ReturnType<typeof setTimeout>;
};

/**
 * Utterances currently awaiting `onend`/`onerror`/timeout. Two jobs:
 *  1. Keep a module-level reference alive so the engine can't garbage
 *     collect the utterance mid-speech (a real, well-documented gotcha —
 *     a GC'd utterance silently drops its callbacks and hangs forever).
 *  2. Let `cancelSpeech()`/`{interrupt:true}` settle outstanding promises
 *     explicitly, since Safari won't fire `onend` after `cancel()`.
 */
let pendingSpeeches: PendingSpeech[] = [];

function settlePendingSpeech(pending: PendingSpeech): void {
  const idx = pendingSpeeches.indexOf(pending);
  if (idx !== -1) pendingSpeeches.splice(idx, 1);
  clearTimeout(pending.watchdog);
  pending.resolve();
}

function settleAllPendingSpeeches(): void {
  const pending = pendingSpeeches;
  pendingSpeeches = [];
  for (const p of pending) {
    clearTimeout(p.watchdog);
    p.resolve();
  }
}

const WATCHDOG_FLOOR_MS = 4000;
const WATCHDOG_BASE_MS = 2000;
const WATCHDOG_PER_CHAR_MS = 90;

/** Generous, text-length-scaled bound so a lost `onend` can never hang the
 * caller forever. */
function estimateWatchdogMs(text: string): number {
  return Math.max(WATCHDOG_FLOOR_MS, WATCHDOG_BASE_MS + text.length * WATCHDOG_PER_CHAR_MS);
}

/** The live-`speechSynthesis` path for `speakAsync`, used directly when
 * clips are disabled/absent, and as the fallback when a clip lookup misses
 * or playback fails. */
function speakAsyncLive(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; voiceURI?: string },
): Promise<void> {
  if (!isSpeechSupported()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    try {
      if (opts?.interrupt) {
        // A fresh interrupting call must settle whatever was previously
        // in-flight -- Safari won't fire onend for it after cancel().
        settleAllPendingSpeeches();
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (opts?.rate) {
        utterance.rate = opts.rate;
      }
      const voice = resolveVoice(opts?.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }

      const pending: PendingSpeech = {
        utterance,
        resolve,
        watchdog: setTimeout(() => settlePendingSpeech(pending), estimateWatchdogMs(text)),
      };
      pendingSpeeches.push(pending);

      utterance.onend = () => settlePendingSpeech(pending);
      utterance.onerror = () => settlePendingSpeech(pending);

      window.speechSynthesis.speak(utterance);
    } catch {
      resolve();
    }
  });
}

/**
 * Like `speak()`, but returns a Promise that resolves once the utterance
 * finishes (or is abandoned) rather than firing and forgetting.
 * `speechSynthesis.speak()` silently *queues* — a caller advancing the UI on
 * a fixed interval falls permanently behind actual speech. Awaiting this
 * lets speech drive the UI instead.
 *
 * In e2e mode, records the raw text into `window.__speechLog` instead of
 * calling any real API (clips are fully bypassed in this mode). Otherwise,
 * when clips are enabled and a cascade match exists for `text`, awaits
 * `playClipsAsync` and falls back to live `speechSynthesis` only if that
 * resolves `false`.
 *
 * Never rejects — a failed/lost utterance (or clip) resolves the promise so
 * it can never break a caller's loop. Guards three real gotchas (see
 * docs/research/2026-07-21-web-tts-options.md §2-3): utterance GC mid-speech
 * (module-level reference kept until settled), Safari not firing `onend`
 * after `cancel()` (`cancelSpeech()`/`{interrupt:true}` settle explicitly),
 * and a lost/never-fired `onend` (watchdog timeout settles it anyway).
 */
export function speakAsync(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; voiceURI?: string },
): Promise<void> {
  if (isE2eAudioMode()) {
    pushSpeechLog(text);
    return Promise.resolve();
  }

  if (isClipsEnabled() && hasClips(text)) {
    return playClipsAsync(text, { interrupt: opts?.interrupt, rate: opts?.rate }).then((played: boolean) => {
      if (played) return;
      return speakAsyncLive(text, opts);
    });
  }

  return speakAsyncLive(text, opts);
}

type AudioContextCtor = new () => AudioContext;

let sharedAudioContext: AudioContext | null = null;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (!hasWindow()) return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

const CHIME_FREQUENCY_HZ: Record<'good' | 'bad' | 'attention', number> = {
  good: 880,
  bad: 220,
  attention: 1320,
};

/**
 * Plays a short (0.12s) gain-ramped sine tone. In e2e mode, records
 * `chime:<kind>` into `window.__speechLog` instead. Never throws.
 */
export function chime(kind: 'good' | 'bad' | 'attention'): void {
  if (isE2eAudioMode()) {
    pushSpeechLog(`chime:${kind}`);
    return;
  }

  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = CHIME_FREQUENCY_HZ[kind];

    const now = ctx.currentTime;
    const duration = 0.12;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch {
    // never throw
  }
}
