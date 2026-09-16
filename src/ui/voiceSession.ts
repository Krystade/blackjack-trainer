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
  listeners.clear();
}
