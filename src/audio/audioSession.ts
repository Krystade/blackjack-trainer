/**
 * The audio session category, which a web page CAN set after all.
 *
 * WHAT I GOT WRONG. On 2026-10-03 I told Jack the earpiece was unfixable
 * because "Safari exposes no part of the audio session to a web page: no
 * category, no options, no `setSinkId`, no output device list." The last three
 * are true. The first is not: `navigator.audioSession` shipped in Safari 17 /
 * iOS 17, and its `type` IS the category intent. His phone is iOS 18.7.
 *
 * WHAT THE TYPES MEAN. 'playback' declares "this page is playing media", which
 * is the intent that belongs on a loud speaker. 'play-and-record' is what
 * WebKit infers the instant anything opens a microphone, and it is the one
 * that routes output to the receiver -- the quiet earpiece at the top of the
 * phone. The W3C draft (First Public Working Draft, Nov 2024) defines the
 * values and says NOTHING about routing or about what happens to a live
 * capture when a page asks for 'playback' mid-session. So whether WebKit
 * honours the request, ignores it, or honours it and kills the recogniser is
 * an open question about his specific phone.
 *
 * WHICH IS WHY EVERYTHING HERE READS BACK. An assignment that is silently
 * swallowed looks exactly like one that worked -- the same trap the volume
 * setter already laid on this device -- and a log that recorded only what was
 * ASKED FOR would let me make the same confident claim a second time. Every
 * row carries `wanted` and `got`, and `got` is read from the browser.
 */
import { diag } from '../diag/diagnosticLog';

/** The values the spec defines. 'auto' means "stop declaring anything". */
export type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'transient'
  | 'transient-solo'
  | 'ambient'
  | 'play-and-record';

interface AudioSessionLike {
  type: string;
}

function session(): AudioSessionLike | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const s = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
    return s && typeof s === 'object' ? s : null;
  } catch {
    return null;
  }
}

/** Does this browser admit to having an audio session at all? */
export function audioSessionSupported(): boolean {
  return session() !== null;
}

/** The category the browser currently believes it is in, or null. */
export function readAudioSessionType(): string | null {
  try {
    return session()?.type ?? null;
  } catch {
    return null;
  }
}

/**
 * Tracks what the last row said, so a drill that speaks after every answer
 * does not write a row per utterance into a log that is read by hand. Only
 * CHANGES and FAILURES are worth a line.
 */
let lastLogged: string | null = null;

/**
 * Ask for a category, and report whether the browser actually took it.
 *
 * Returns true only when the readback matches. False covers every other case:
 * no API, a swallowed assignment, a throwing setter.
 */
export function requestAudioSessionType(wanted: AudioSessionType): boolean {
  const s = session();
  if (!s) {
    if (lastLogged !== 'unsupported') {
      lastLogged = 'unsupported';
      diag('route', 'audio-session', { supported: false, wanted });
    }
    return false;
  }
  let was: string | null = null;
  try {
    was = s.type;
    if (was === wanted) return true;
    s.type = wanted;
  } catch {
    // A throwing setter is a refusal, and the readback below records it.
  }
  const got = readAudioSessionType();
  const ok = got === wanted;
  const key = `${was}>${wanted}=${got}`;
  if (lastLogged !== key) {
    lastLogged = key;
    diag('route', 'audio-session', { supported: true, was, wanted, got, ok });
  }
  return ok;
}

/*
 * WHAT IS NO LONGER HERE: the app never asks for a category on its own.
 *
 * There used to be a route setting ("Sound with the mic on") with two modes
 * that did: 'playback' declared the media intent before every sound, and
 * 'switch' took the microphone down while the app spoke, declared playback,
 * waited out the route's settle time and reopened it afterwards -- the order
 * WebKit bug 218012's thread reports as the workaround. Both were run on the
 * road on 2026-10-04 and neither moved the sound off the earpiece; 'switch'
 * also looped a prompt round its reopen. Every load had been migrating both
 * back to 'auto' already, so the setting and the handoff machinery behind it
 * were retired in the 2026-10-05 settings cull.
 *
 * What stays is the READING side -- `readAudioSessionType`, logged at every
 * mic open and close -- and `requestAudioSessionType` for the car check that
 * still asks the question by hand, so the day WebKit changes is noticed.
 */

/** Test-only: forget what has been logged. */
export function _resetAudioSessionForTest(): void {
  lastLogged = null;
}
