/**
 * Keep this app the phone's "now playing" app, so the wheel keeps reaching it.
 *
 * THE BUG THIS EXISTS TO FIX. Media Session routes a transport button to
 * whoever the phone currently considers the active media app, and that status
 * comes from actually playing through a media element -- not from having once
 * registered a handler. The clips path plays a clip, the clip ends, the
 * element goes idle, and the phone hands the wheel back to whatever played
 * before this app existed: the radio, a podcast, nothing at all.
 *
 * From the driver's seat that is precisely what the operator reported after
 * the drive of 2026-09-19: "buttons worked only when the bot was talking."
 * Which was true, and is the whole symptom -- the app was only the active
 * media app for the two seconds a clip was audible, and the gaps between
 * prompts are exactly when a driver wants to press something.
 *
 * THE FIX is a silent element that never stops. Hold it for as long as the
 * wheel is meant to work and the app stays the active media app between
 * utterances, so a press in a gap arrives instead of vanishing. The button
 * tester already did this for itself and its header already stated the
 * reason; this module is that mechanism pulled out to where the drills can
 * use it too, which is where it was actually needed.
 *
 * WHY KEYED rather than a bare on/off. Two independent things want the hold
 * at once -- a drill that is speaking, and the button tester -- and they
 * start and stop on their own schedules. A boolean would let the tester's
 * `stop` drop a hold the drill still needs, silently restoring the original
 * bug for the rest of the session. Holds are therefore named, and the
 * element plays while any name is outstanding.
 */

import { diag } from '../diag/diagnosticLog';
import { appendLog } from './mediaSessionLog';

/** Who wants the app to stay the active media app. */
export type AudioFocusKey = 'speech' | 'button-test' | 'car-check';

/**
 * A silent WAV as a data URI.
 *
 * One second of 8 kHz 8-bit mono, which is all zeroes after the 44-byte
 * header -- but 8-bit PCM is UNSIGNED, so digital silence is 0x80, not 0x00.
 * Filling it with zeroes instead produces a full-scale DC offset: inaudible
 * on most speakers, a thump on some, and a step every time the loop wraps.
 *
 * Generated rather than shipped: a real asset would be one more file to keep
 * in sync with the service-worker manifest, for ~700 bytes of gain.
 */
export function silentWavDataUri(): string {
  const sampleRate = 8000;
  const samples = sampleRate; // one second
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate: 1 byte per sample
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(0x80, 44); // unsigned-PCM zero

  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

function audioCtor(): (new (src?: string) => HTMLAudioElement) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { Audio?: new (src?: string) => HTMLAudioElement };
  return typeof w.Audio === 'function' ? w.Audio : null;
}

const held = new Set<AudioFocusKey>();
let element: HTMLAudioElement | null = null;

/**
 * Claim the media slot on behalf of `key`, and keep it until every holder
 * has released.
 *
 * MUST BE REACHED FROM A GESTURE, at least the first time. iOS refuses
 * `play()` on an element that no tap ever started, and a refusal here is
 * silent -- the app simply is not the active media app and no button works,
 * which is indistinguishable from the bug this fixes. In practice the first
 * hold rides on a clip that is already playing (see speech.ts), which means
 * the media engine is unlocked by then. A refusal is logged rather than
 * thrown so a drill never dies for want of a wheel.
 *
 * Volume 1 and genuinely silent, not muted: a muted element is not reliably
 * treated as playing media, which would defeat the entire point.
 */
export function holdAudioFocus(key: AudioFocusKey): void {
  const first = held.size === 0;
  held.add(key);
  if (!first && element) return;

  const Ctor = audioCtor();
  if (!Ctor) return;
  try {
    element ??= new Ctor(silentWavDataUri());
    element.loop = true;
    element.volume = 1;
    const el = element;
    void el
      .play()
      .then(() => {
        // `play()` resolving is not the element PLAYING -- report what it
        // actually is, because that is what the head unit reads.
        diag('focus', 'holding', { key, paused: el.paused, holders: held.size });
      })
      .catch((e: unknown) => {
        appendLog({ kind: 'note', action: 'audio-focus-refused', ok: false });
        // The silent failure that makes every wheel button dead. iOS refuses
        // `play()` with no gesture behind it, and before this line the only
        // symptom was a car that ignored the app.
        diag('focus', 'refused', { key, why: e instanceof Error ? e.name : String(e) });
      });
    appendLog({ kind: 'note', action: `audio-focus-hold:${key}`, ok: true });
    diag('focus', 'hold', { key, holders: held.size });
  } catch {
    element = null;
  }
}

/**
 * Drop `key`'s claim. The element stops only once nothing holds it.
 *
 * Releasing matters: a silent loop that ran forever would hold the car's
 * media slot after the user had gone back to their music, and every wheel
 * press would then land on a trainer that is not on screen.
 */
export function releaseAudioFocus(key: AudioFocusKey): void {
  if (!held.delete(key)) return;
  if (held.size > 0) return;
  appendLog({ kind: 'note', action: `audio-focus-release:${key}`, ok: true });
  diag('focus', 'release', { key, holders: held.size });
  if (!element) return;
  try {
    element.pause();
    element.currentTime = 0;
  } catch {
    /* releasing the hold must never throw on the way out */
  }
}

/** Release every hold, whoever placed it. Used when audio is switched off. */
export function releaseAllAudioFocus(): void {
  for (const key of [...held]) releaseAudioFocus(key);
}

/**
 * Whether the hold is genuinely PLAYING, not merely requested.
 *
 * The distinction the car check turns on: `play()` resolving means the
 * browser accepted the request, while `paused === false` means the element is
 * actually the thing producing media. iOS pulls those apart routinely, and
 * the wheel follows the second one.
 */
export function audioFocusElementIsPlaying(): boolean {
  return element !== null && element.paused === false;
}

/** Whether anything currently holds the slot. Exposed for tests and the panel. */
export function audioFocusHolders(): AudioFocusKey[] {
  return [...held];
}

/** Test-only: forget the element and every hold. */
export function _resetAudioFocusForTest(): void {
  held.clear();
  element = null;
}
