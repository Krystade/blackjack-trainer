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
import { hasClips, isClipsEnabled, playClipsResumable, stopClips } from './clips';
import { initMediaSession, setNowPlaying, setPlaybackState } from './mediaSession';

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
  // Clips play through HTMLAudioElement, which speechSynthesis.cancel() knows
  // nothing about. `stopClips` existed for exactly this and had ZERO callers,
  // so leaving a screen mid-clip left the audio playing over whatever came
  // next, and an interrupting live-TTS line spoke ON TOP of the clip chain.
  stopClips();
  settleAllPendingSpeeches();
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // never throw
  }
}

/**
 * The option bag every speaking entry point accepts. `volume` is 0..1 and
 * maps to `SpeechSynthesisUtterance.volume` (and to the chime's gain peak);
 * it is threaded through exactly the same paths `rate` already travels.
 */
export interface SpeechOpts {
  interrupt?: boolean;
  rate?: number;
  voiceURI?: string;
  volume?: number;
}

/**
 * Apply `opts.volume` to an utterance.
 *
 * PRESENCE-checked, not truthiness-checked, unlike `rate` directly above every
 * call site of this helper. `volume: 0` is a legitimate setting — the operator
 * dragging the slider to the floor means silence — and `if (opts.volume)`
 * would silently discard it, leaving the engine default of full volume. That
 * is the single most surprising bug this feature could ship, so it is pinned
 * by its own test.
 */
function applyVolume(utterance: SpeechSynthesisUtterance, opts?: SpeechOpts): void {
  if (opts?.volume !== undefined) {
    utterance.volume = opts.volume;
  }
}

/** The live-`speechSynthesis` path, used directly when clips are disabled/
 * absent, and as the fallback when a clip lookup misses or playback fails. */
function speakLive(text: string, opts?: SpeechOpts): void {
  if (!isSpeechSupported()) return;

  try {
    if (opts?.interrupt) {
      // Interrupt means interrupt EVERYTHING audible, not just the utterance
      // queue: a clip chain started by a previous call is still playing and
      // would otherwise be talked over.
      stopClips();
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (opts?.rate) {
      utterance.rate = opts.rate;
    }
    applyVolume(utterance, opts);
    const voice = resolveVoice(opts?.voiceURI);
    if (voice) {
      utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // never throw
  }
}

/* ---------------------------------------------------------------------- */
/* Last-utterance tracking — the "say that again" primitive                */
/* ---------------------------------------------------------------------- */

/**
 * The most recent thing the app SAID, backing the Repeat control.
 *
 * Deliberately the raw spoken string rather than a re-derived prompt. The
 * pre-existing eyes-free long-press (`ZonePad`'s `onRepeat`) rebuilds the
 * prompt from current state, which quietly makes it a different feature: it
 * can only ever repeat the prompt, never the correction, the result, or the
 * count that just went by — and it re-reads state that may have moved on
 * since. Storing what was actually uttered means Repeat is honest at every
 * point in the flow, which is the whole point when the user is driving and
 * missed a phrase.
 */
let lastSpoken: string | null = null;

/** Records an utterance. Called by every public speaking entry point, and by
 * nothing else — see `chime()`, which pointedly does not call it. */
function rememberSpoken(text: string): void {
  lastSpoken = text;
}

/** The last spoken text, or `null` when nothing has been said yet. */
export function getLastSpoken(): string | null {
  return lastSpoken;
}

/**
 * Re-speaks the last utterance, returning whether there was anything to say.
 *
 * Always interrupts, regardless of `opts`: a repeat that queued behind the
 * utterance it is repeating would make the user sit through the thing they
 * already missed before hearing it again.
 *
 * Does NOT re-record what it speaks. A repeat is not new information, so
 * repeating twice must not be able to shift what "last" means.
 */
export function repeatLast(opts?: SpeechOpts): boolean {
  const text = lastSpoken;
  if (text === null) return false;
  speak(text, { ...opts, interrupt: true });
  lastSpoken = text;
  return true;
}

/** Test-only reset of the module-level memory above. */
export function _resetLastSpokenForTest(): void {
  lastSpoken = null;
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
  opts?: SpeechOpts,
): void {
  rememberSpoken(text);
  if (isE2eAudioMode()) {
    pushSpeechLog(text);
    return;
  }

  if (isClipsEnabled() && hasClips(text)) {
    announceToMediaSession(text);
    void playClipsResumable(text, {
      interrupt: opts?.interrupt,
      rate: opts?.rate,
      volume: opts?.volume,
    }).then(({ played, remainder }) => {
      if (played) return;
      // A chain that broke PART WAY through reports what is still unsaid.
      // Speaking `text` there would repeat the half the clips already
      // delivered -- the user heard the opening twice and the good audio was
      // thrown away for nothing. Fall back to the remainder when there is
      // one, and to the whole utterance only when nothing played at all.
      speakLive(remainder ?? text, opts);
    });
    return;
  }

  speakLive(text, opts);
}

/**
 * Hand the car's transport controls to this app, and tell the head unit what
 * is being said.
 *
 * Called from the clips path only -- see mediaSession.ts for why live TTS
 * cannot participate. Registration is one-shot and happens on first clip
 * playback rather than at startup, because a Media Session claimed before
 * any audio exists is either ignored or, worse, steals the now-playing slot
 * from whatever the driver actually had going.
 */
function announceToMediaSession(text: string): void {
  initMediaSession({
    repeat: () => {
      repeatLast();
    },
    stop: () => {
      cancelSpeech();
    },
  });
  setNowPlaying(text, (import.meta.env.BASE_URL as string | undefined) ?? '');
  setPlaybackState('playing');
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
  opts?: SpeechOpts,
): Promise<void> {
  if (!isSpeechSupported()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    try {
      if (opts?.interrupt) {
        // A fresh interrupting call must settle whatever was previously
        // in-flight -- Safari won't fire onend for it after cancel(). It must
        // also stop any clip chain, which speechSynthesis cannot see.
        stopClips();
        settleAllPendingSpeeches();
        window.speechSynthesis.cancel();
      }

      const utterance = new SpeechSynthesisUtterance(text);
      if (opts?.rate) {
        utterance.rate = opts.rate;
      }
      applyVolume(utterance, opts);
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
  opts?: SpeechOpts,
): Promise<void> {
  rememberSpoken(text);
  if (isE2eAudioMode()) {
    pushSpeechLog(text);
    return Promise.resolve();
  }

  if (isClipsEnabled() && hasClips(text)) {
    announceToMediaSession(text);
    return playClipsResumable(text, {
      interrupt: opts?.interrupt,
      rate: opts?.rate,
      volume: opts?.volume,
    }).then(({ played, remainder }) => {
      if (played) return;
      // Same resume rule as `speak` above: only re-speak what the broken
      // chain never got to. This path also drives drill PACING, so repeating
      // the whole utterance here stretched the gap between cards as well as
      // saying the opening twice.
      return speakAsyncLive(remainder ?? text, opts);
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

/**
 * Test-only drop of the cached context.
 *
 * `sharedAudioContext` is memoized for the page's lifetime (constructing an
 * AudioContext per chime is both wasteful and, on iOS, subject to the
 * user-gesture unlock rules). That cache outlives a single test: a spec that
 * swaps in a fresh fake `window.AudioContext` would otherwise keep chiming
 * into the PREVIOUS test's fake and silently assert nothing.
 */
export function _resetSharedAudioContextForTest(): void {
  sharedAudioContext = null;
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

/** Full-volume peak of the chime's gain envelope, scaled by `opts.volume`. */
const CHIME_PEAK_GAIN = 0.3;

const CHIME_FREQUENCY_HZ: Record<'good' | 'bad' | 'attention', number> = {
  good: 880,
  bad: 220,
  attention: 1320,
};

/**
 * Plays a short (0.12s) gain-ramped sine tone. In e2e mode, records
 * `chime:<kind>` into `window.__speechLog` instead. Never throws.
 */
export function chime(kind: 'good' | 'bad' | 'attention', opts?: { volume?: number }): void {
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
    // The chime rides the same volume setting as speech, so turning the app
    // down turns ALL of it down. Scaling the envelope peak (rather than
    // routing through another GainNode) keeps the attack/release shape
    // identical at every volume. Absent opts, the historical 0.3 stands.
    const peak = CHIME_PEAK_GAIN * (opts?.volume ?? 1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + duration);

    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(now);
    oscillator.stop(now + duration);
  } catch {
    // never throw
  }
}
