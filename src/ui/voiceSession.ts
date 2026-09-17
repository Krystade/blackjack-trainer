import { useEffect, useState } from 'react';
import { diag } from '../diag/diagnosticLog';

/**
 * Whether voice is on, remembered for the life of THIS PAGE LOAD.
 *
 * The toggle used to be `useState(false)` inside each screen, which meant it
 * was forgotten on every navigation: turn voice on in a count drill, go back
 * to the drill list to pick another, and the microphone was off again with
 * nothing saying so. In a car, where the screen is not being looked at, that
 * is indistinguishable from the microphone having failed -- and it is a fair
 * share of "it seems like the mic doesn't stay active" (operator, 2026-09-15).
 *
 * THE LIFETIME IS THE POINT, and it is deliberately narrower than persistence.
 *
 * `voiceHistory.ts` states the standing promise: "the microphone itself is
 * still opened only by an explicit per-session toggle". Writing this to
 * localStorage would break that -- the app would open a microphone on launch
 * because of something the operator did yesterday. A module-level variable
 * keeps the promise exactly: one run of the app is one session, a reload or a
 * relaunch starts with voice off, and within that run the toggle means what it
 * says.
 *
 * The microphone follows the SCREEN, not this flag: `useVoiceControl` still
 * unmounts with the screen that owns it, so leaving a drill for Settings
 * closes the microphone and coming back re-opens it. This only remembers the
 * answer to "did you ask for voice", which is the part the operator gave.
 */
let voiceOn = false;

/**
 * Whether a microphone session has demonstrably worked during this page load.
 *
 * Kept here rather than in the controller because the controller is rebuilt on
 * every navigation, and the fact it needs is about the PAGE: has the operator
 * granted the microphone and has it actually produced audio. Without that,
 * every screen change resets the evidence, and the first `not-allowed` after
 * a navigation -- which iOS produces for a `start()` with no user gesture
 * behind it -- would be read as a fresh refusal and stop voice for good.
 */
let micWorked = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a subscriber must never take the microphone down with it */
    }
  }
}

export function setVoiceOn(on: boolean, context: string): void {
  if (voiceOn === on) return;
  voiceOn = on;
  diag('mic', on ? 'toggle-on' : 'toggle-off', { context });
  notify();
}

export function isVoiceOn(): boolean {
  return voiceOn;
}

export function micHasWorked(): boolean {
  return micWorked;
}

export function markMicWorked(): void {
  if (micWorked) return;
  micWorked = true;
  diag('mic', 'proven-granted');
}

/**
 * The toggle, as a screen sees it.
 *
 * Same shape as the `useState` it replaces, so the four call sites read the
 * same as they did -- the only difference is where the value lives.
 */
export function useVoiceToggle(context: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(voiceOn);
  useEffect(() => {
    const sync = () => setOn(voiceOn);
    listeners.add(sync);
    // A screen mounting after the toggle changed elsewhere has to catch up.
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return [on, (next: boolean) => setVoiceOn(next, context)];
}

/** Test seam: reset the page-scoped facts between cases. */
export function _resetVoiceSessionForTest(): void {
  voiceOn = false;
  micWorked = false;
  endPushToTalk();
  listeners.clear();
}

/* ---------------------------------------------------------------------- */
/* Push to talk                                                            */
/* ---------------------------------------------------------------------- */

/**
 * How long the microphone stays open for one wheel press.
 *
 * NOT the two seconds the request guessed at, and the difference is the
 * Bluetooth link rather than the speaking. Opening the microphone flips the
 * car from A2DP to HFP, and that re-negotiation is not instant -- the first
 * stretch of the window is deaf while the route settles, and a two-second
 * window would spend most of itself on the handshake and close again before
 * the count arrived. Five gives a real second or two of listening after the
 * link is up, which is all "plus four" needs.
 *
 * It is a window rather than a toggle for the reason the wheel exists at all:
 * while the microphone is open the car owns the buttons, so a second press
 * cannot reach the app to close it. The only thing that can end the window is
 * the app itself.
 */
export const PUSH_TO_TALK_MS = 5000;

let talkingUntil: number | null = null;
let talkHandle: ReturnType<typeof setTimeout> | null = null;

/** Whether the push-to-talk window is currently open. */
export function isPushToTalkOpen(): boolean {
  return talkingUntil !== null;
}

/**
 * Open the microphone for one window, restarting it if one is already open.
 *
 * Restarting rather than ignoring: pressing again while it is listening is
 * someone asking for more time, and the alternative -- the window closing
 * under a sentence because it began before the press -- is the failure this
 * whole feature exists to avoid.
 */
export function startPushToTalk(context: string): void {
  const restarted = talkingUntil !== null;
  talkingUntil = Date.now() + PUSH_TO_TALK_MS;
  diag('mic', restarted ? 'ptt-extend' : 'ptt-open', { context, forMs: PUSH_TO_TALK_MS });
  if (talkHandle !== null) clearTimeout(talkHandle);
  talkHandle = setTimeout(() => {
    talkHandle = null;
    talkingUntil = null;
    diag('mic', 'ptt-close', { context });
    notify();
  }, PUSH_TO_TALK_MS);
  notify();
}

/** Close it now -- a screen being left, or an answer already heard. */
export function endPushToTalk(): void {
  if (talkHandle !== null) {
    clearTimeout(talkHandle);
    talkHandle = null;
  }
  if (talkingUntil === null) return;
  talkingUntil = null;
  diag('mic', 'ptt-close', { reason: 'done' });
  notify();
}

/**
 * The push-to-talk window as a screen sees it.
 *
 * Shares `listeners` with the voice toggle deliberately: both answer the same
 * question -- should this screen's microphone be open right now -- and a
 * screen that subscribed to one and not the other would hold the microphone
 * open after the window closed.
 */
export function usePushToTalk(): boolean {
  const [open, setOpen] = useState(isPushToTalkOpen());
  useEffect(() => {
    const sync = () => setOpen(isPushToTalkOpen());
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return open;
}
