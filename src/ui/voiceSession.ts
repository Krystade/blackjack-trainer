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
 * The DEFAULT length of the speaking window, once the microphone is live.
 *
 * Five was chosen to cover the Bluetooth handshake as well as the speaking,
 * because the window used to be counted from the button press. It is not any
 * more -- the wait has its own budget below -- so this is purely how long the
 * operator has to say one word, and two seconds is what that is worth
 * (operator, 2026-10-02). Adjustable, because only driving settles it:
 * `DrillSettings.pushToTalkMs`.
 *
 * It is a window rather than a toggle for the reason the wheel exists at all:
 * while the microphone is open the car owns the buttons, so a second press
 * cannot reach the app to close it. The two things that can end it are this
 * timer and a word actually being recognised -- `useVoiceControl` closes the
 * window the moment it has an action, so a one-word answer costs one word
 * rather than the whole window.
 */
export const PUSH_TO_TALK_MS = 2000;

/** The range the operator can set it to, in quarter seconds. */
export const PUSH_TO_TALK_MIN_MS = 1000;
export const PUSH_TO_TALK_MAX_MS = 8000;
export const PUSH_TO_TALK_STEP_MS = 250;

/**
 * How long the app will WAIT for the microphone before giving the press up.
 *
 * The window above used to be counted from the button press, which spent it on
 * the wrong thing. The 2026-09-30 drive measured the first microphone of a page
 * load reaching `listening` after 6033ms -- one five-second watchdog plus a
 * 460ms retry -- so the first press of a cold page opened five seconds that
 * were over before the engine could hear anything. The operator heard the press
 * acknowledged, spoke into a microphone that was not yet live, and got nothing;
 * the second press worked, because by then it was warm. A bigger number would
 * not have fixed that, because the window is a budget for SPEAKING and the
 * press is not when speaking can start.
 *
 * So the press opens a wait, the wait becomes the speaking window the moment
 * the microphone actually goes live (`markPushToTalkLive`, called from
 * `useVoiceControl` rather than from any screen, so no screen can forget it),
 * and this cap is what stops a microphone that never opens from holding the
 * window -- and the car's buttons with it -- indefinitely.
 *
 * Comfortably past that 6033ms, because a cap that fires before a slow start
 * would close the window in precisely the case it exists to rescue. Two
 * watchdog cycles and change.
 */
export const PUSH_TO_TALK_CAP_MS = 12000;

/**
 * `waiting` is a press whose microphone has not opened yet; `speaking` is the
 * window the press was actually for. Both are open as far as the recogniser is
 * concerned -- it has to be running during the wait, or it would never go live
 * to end it -- which is why `isPushToTalkOpen` covers the pair.
 */
export type PushToTalkPhase = 'closed' | 'waiting' | 'speaking';

let phase: PushToTalkPhase = 'closed';
let talkHandle: ReturnType<typeof setTimeout> | null = null;
let speakingMs: number = PUSH_TO_TALK_MS;

function clearTalkTimer(): void {
  if (talkHandle !== null) {
    clearTimeout(talkHandle);
    talkHandle = null;
  }
}

/** Whether the push-to-talk window is currently open, in either phase. */
export function isPushToTalkOpen(): boolean {
  return phase !== 'closed';
}

/** Which half of the window is running. */
export function pushToTalkPhase(): PushToTalkPhase {
  return phase;
}

/**
 * Open the microphone for one window, restarting it if one is already open.
 *
 * Restarting rather than ignoring: pressing again while it is listening is
 * someone asking for more time, and the alternative -- the window closing
 * under a sentence because it began before the press -- is the failure this
 * whole feature exists to avoid. Pressing again while it is still WAITING is
 * the same request about the other phase, so it restarts the cap.
 */
export function startPushToTalk(context: string, speakMs: number = PUSH_TO_TALK_MS): void {
  const restarted = phase !== 'closed';
  const wasSpeaking = phase === 'speaking';
  clearTalkTimer();
  // Held for `markPushToTalkLive`, which fires later and has no other way to
  // know what this press asked for.
  speakingMs = speakMs;
  // A press during the speaking window buys more speaking; a press while still
  // waiting buys more waiting. Either way it is the same gesture asking for
  // more of whatever is currently running.
  phase = wasSpeaking ? 'speaking' : 'waiting';
  const forMs = wasSpeaking ? speakingMs : PUSH_TO_TALK_CAP_MS;
  diag('mic', restarted ? 'ptt-extend' : 'ptt-open', { context, phase, forMs });
  talkHandle = setTimeout(() => {
    talkHandle = null;
    const why = phase === 'waiting' ? 'never-opened' : 'elapsed';
    phase = 'closed';
    diag('mic', 'ptt-close', { context, why });
    notify();
  }, forMs);
  notify();
}

/**
 * The microphone this window was waiting for is now live.
 *
 * Called from `useVoiceControl`'s state handler, which is the one place that
 * learns this for every screen at once -- the same argument that made its
 * `onListening` cue required rather than optional.
 *
 * Idempotent while speaking. The cloud recogniser ends its own session roughly
 * every ninety seconds and the controller restarts it, so `listening` can
 * arrive a second time inside one window; it must not hand out speaking time
 * the press did not buy.
 */
export function markPushToTalkLive(): void {
  if (phase !== 'waiting') return;
  clearTalkTimer();
  phase = 'speaking';
  diag('mic', 'ptt-live', { forMs: speakingMs });
  talkHandle = setTimeout(() => {
    talkHandle = null;
    phase = 'closed';
    diag('mic', 'ptt-close', { why: 'elapsed' });
    notify();
  }, speakingMs);
  notify();
}

/**
 * Close it now -- a word recognised, or a screen being left.
 *
 * The comment here used to claim an answer already heard closed the window.
 * Nothing called it: the window ran its full length after the word had been
 * graded, holding the car's buttons for the remainder. `useVoiceControl` calls
 * it on every action now, which is what makes a short window cheap -- the
 * length is a ceiling on waiting, not a cost paid every time.
 */
export function endPushToTalk(why: string = 'done'): void {
  clearTalkTimer();
  if (phase === 'closed') return;
  phase = 'closed';
  diag('mic', 'ptt-close', { why });
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
