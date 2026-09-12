/**
 * "Press a button and I'll tell you what it's called."
 *
 * THE PROBLEM. A steering wheel has physical buttons; a browser has Media
 * Session action names. Between them sits a mapping only the head unit knows,
 * and it is not documented anywhere the driver can reach. A ring selector with
 * up/down/left/right/centre, volume up/down, and pick-up/hang-up is nine
 * physical controls; the browser can hear at most eight names, and a typical
 * car sends three of them. Which three, and from which buttons, is a question
 * that can only be answered by pressing one and being told -- from the driver's
 * seat, out loud, with no console and no screen.
 *
 * WHY IT NEEDS TO HOLD AUDIO. Media Session only routes to whoever the phone
 * considers the active media app, and that status comes from actually playing
 * through a media element. With nothing playing, the car's buttons go to
 * whatever played last -- the radio, a podcast -- and the app hears nothing at
 * all, which is indistinguishable from "that button does not exist". So the
 * tester keeps a silent looping element playing for as long as it runs. It is
 * not decoration: without it the test cannot produce a negative result you can
 * trust.
 *
 * Silence, specifically, and generated rather than shipped: a looping voice
 * clip under a test that may run for several minutes would be unbearable, a
 * muted element does not reliably hold audio focus, and a real asset would be
 * one more file to keep in sync with the manifest for no gain. The WAV below is
 * assembled byte by byte at ~700 bytes.
 *
 * Nothing here decides what a button DOES. It redirects every action to a
 * reporter (see mediaSession.ts's `setMediaSessionProbe`) so a test press
 * cannot also answer a drill question, and puts the mapping back on stop.
 */

import { MEDIA_SESSION_ACTIONS, setMediaSessionProbe, setNowPlaying } from './mediaSession';
import type { MediaSessionAction } from './mediaSession';
import { appendLog } from './mediaSessionLog';

/** One press, as the panel shows it. */
export interface ButtonPress {
  action: string;
  /** Wall clock, so two presses a second apart are visibly two presses. */
  at: number;
}

export interface ButtonTesterHandle {
  stop: () => void;
}

/**
 * A silent WAV as a data URI.
 *
 * One second of 8 kHz 8-bit mono, which is all zeroes after the 44-byte header
 * -- but 8-bit PCM is UNSIGNED, so digital silence is 0x80, not 0x00. Filling
 * it with zeroes instead produces a full-scale DC offset: inaudible on most
 * speakers, a thump on some, and a step every time the loop wraps.
 */
function silentWavDataUri(): string {
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

/**
 * Start the test. Returns a handle whose `stop` restores normal behaviour.
 *
 * `onPress` is called for every action the car sends, including ones it sends
 * on its own -- `play` in particular arrives unprompted whenever the head unit
 * thinks playback stopped, and seeing that happen is half the diagnosis. The
 * caller decides what to do with it (the Settings panel speaks the name and
 * lists it).
 *
 * Safe to call where there is no Audio and no Media Session: the probe is still
 * armed, so the test simply reports nothing, which is the truthful outcome.
 */
export function startButtonTest(onPress: (press: ButtonPress) => void): ButtonTesterHandle {
  appendLog({ kind: 'note', action: 'button-test-start', ok: true });

  let holder: HTMLAudioElement | null = null;
  const Ctor = audioCtor();
  if (Ctor) {
    try {
      holder = new Ctor(silentWavDataUri());
      holder.loop = true;
      // Audible-but-silent rather than muted: a muted element is not reliably
      // treated as playing media, which is the entire point of keeping it.
      holder.volume = 1;
      void holder.play().catch(() => {
        // Autoplay refused -- the caller started this from a tap, so this
        // should not happen, but a failed hold must not throw into the panel.
        // The test still runs; it is just less likely to receive anything.
        appendLog({ kind: 'note', action: 'button-test-hold-refused', ok: false });
      });
    } catch {
      holder = null;
    }
  }

  // Tell the car what it is looking at, so the head unit shows the test rather
  // than a stale prompt from the last drill.
  setNowPlaying('Button test — press a wheel button');

  setMediaSessionProbe((action) => {
    onPress({ action, at: Date.now() });
  });

  return {
    stop: () => {
      setMediaSessionProbe(null);
      appendLog({ kind: 'note', action: 'button-test-stop', ok: true });
      if (holder) {
        try {
          holder.pause();
          holder.src = '';
        } catch {
          /* releasing the hold must never throw on the way out */
        }
        holder = null;
      }
    },
  };
}

/**
 * The actions that were armed but never arrived, given what was pressed.
 *
 * The useful half of the result. "Skip forward is nexttrack" is worth knowing;
 * "nothing on this wheel emits previoustrack" is worth MORE, because it means a
 * mapping that depends on it can never work in this car however it is worded.
 */
export function unheardActions(pressed: readonly string[]): MediaSessionAction[] {
  const heard = new Set(pressed);
  return MEDIA_SESSION_ACTIONS.filter((a) => !heard.has(a));
}
