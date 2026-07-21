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
 * real APIs.
 */

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

/** Stops any in-progress/queued speech. No-op when unsupported. */
export function cancelSpeech(): void {
  if (!isSpeechSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // never throw
  }
}

/**
 * Speaks `text`. In e2e mode, records the raw text into `window.__speechLog`
 * instead of calling the real API. Never throws.
 */
export function speak(
  text: string,
  opts?: { interrupt?: boolean; rate?: number; voiceURI?: string },
): void {
  if (isE2eAudioMode()) {
    pushSpeechLog(text);
    return;
  }

  if (!isSpeechSupported()) return;

  try {
    if (opts?.interrupt) {
      window.speechSynthesis.cancel();
    }
    const utterance = new SpeechSynthesisUtterance(text);
    if (opts?.rate) {
      utterance.rate = opts.rate;
    }
    if (opts?.voiceURI && opts.voiceURI !== 'default') {
      const voice = window.speechSynthesis.getVoices().find((v) => v.voiceURI === opts.voiceURI);
      if (voice) {
        utterance.voice = voice;
      }
    }
    window.speechSynthesis.speak(utterance);
  } catch {
    // never throw
  }
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
