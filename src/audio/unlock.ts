/**
 * Unlock the audio on the operator's first touch.
 *
 * WHY THIS EXISTS. Jack asked, after the 2026-10-02 drive, whether the phone
 * could be louder off Bluetooth. The setting already went to 200% and he was
 * at 100%, so the headroom was there -- and raising it would have made the car
 * QUIETER. Three things in sequence, all downstream of one missing gesture:
 *
 *   1. `amplify()` (audio/clips.ts) refuses to route unless the shared
 *      AudioContext is `running`, because a suspended graph makes a routed
 *      clip SILENT rather than quiet. Its own comment said "nothing in the app
 *      resumes this context from a user gesture", and nothing did. iOS starts
 *      a context suspended, so the boost never applied.
 *   2. A chain above unity built a brand-new element rather than taking an
 *      unlocked one, so `play()` met the iOS activation check on every line.
 *   3. The rejection falls through to live TTS, which `utteranceVolume` caps
 *      at 1.0 -- there is no amplified path for `speechSynthesis` at all.
 *
 * So: no boost, every line in the fallback voice, at the same level.
 *
 * `resume()` and the first `play()` on an element are both honoured only
 * inside a user activation, and neither the drill nor the clip chain ever runs
 * inside one -- they run off timers and recogniser callbacks. The one place
 * the app reliably HAS a gesture is the operator's first tap, which is also
 * before any drill has started. So the unlock belongs there and nowhere else.
 *
 * Once per page load, deliberately. An element that has played is unlocked for
 * the life of the page, and a context that has been resumed inside a gesture
 * stays resumable afterwards; re-running this on every tap would build pools
 * nobody uses.
 */
import { getSharedAudioContext, resumeSharedAudioContext } from './audioContext';
import { primeClipAudio } from './clips';
import { diag } from '../diag/diagnosticLog';

/**
 * The events that carry a user activation and that this app actually gets.
 *
 * `pointerdown` is what a tap produces and comes first. `click` is the one a
 * keyboard-activated button produces, which `pointerdown` never fires -- and
 * Settings is reachable that way on a desktop, which is where the field test
 * is driven from.
 */
const GESTURE_EVENTS = ['pointerdown', 'click'] as const;

let unlocked = false;

/** True once a real gesture has unlocked the audio on this page load. */
export function isAudioUnlocked(): boolean {
  return unlocked;
}

/**
 * Do the unlock. MUST be called synchronously from inside a user gesture:
 * both halves of it are activation-gated, and called from anywhere else they
 * resolve harmlessly and change nothing, which is the failure being fixed.
 */
export function unlockAudioNow(reason: string): void {
  if (unlocked) return;
  unlocked = true;
  // The two halves fail independently -- a page can have `Audio` and no
  // `AudioContext` -- and the element gate is the one that silenced a clip on
  // the drive, so neither is allowed to skip the other.
  let state = 'none';
  let rate = 0;
  try {
    const ctx = getSharedAudioContext();
    resumeSharedAudioContext();
    state = ctx?.state ?? 'none';
    /**
     * THE HARDWARE SAMPLE RATE, which is the one number that would have told
     * us why volumes above 100% wrecked playback on 2026-10-02 without having
     * to infer it from clip durations.
     *
     * An AudioContext is fixed at the rate it is constructed with. The clips
     * are 24kHz files; if this reads 48000 the graph was resampling every one
     * of them in real time, and if it reads 16000 or 8000 the open microphone
     * had already pulled the audio session into play-and-record or Bluetooth
     * HFP -- which is also the reason the sound comes out of the earpiece
     * instead of the bottom speaker. Clips and chimes use the graph once a
     * microphone has opened, and the rate still names the route.
     */
    rate = ctx?.sampleRate ?? 0;
    rate = ctx?.sampleRate ?? 0;
  } catch {
    /* a graph that will not build must not stop the elements */
  }
  try {
    primeClipAudio();
  } catch {
    /* nor the other way round */
  }
  /**
   * The state BEFORE the resume settles, which is the useful one: `resume()`
   * is fire-and-forget, so this says what the gesture found.
   *
   * `rate` IS THE ONE NUMBER THAT NAMES THE OUTPUT ROUTE, and on 2026-10-02 we
   * had to infer it from clip durations instead. An AudioContext is fixed at
   * the rate it is built with. 48000 is the speaker. 16000 or 8000 means the
   * audio session had already been pulled into play-and-record or Bluetooth
   * HFP by the open microphone -- which is also why an <audio> element comes out
   * of the earpiece at the top of the phone (Web Audio stays on the loud
   * speaker).
   */
  diag('speak', 'audio-unlock', { reason, state, rate });
}

/**
 * Listen for the first gesture. Returns a remover, so a caller that unmounts
 * before the operator has touched anything leaves nothing behind.
 */
export function installAudioUnlock(): () => void {
  if (typeof window === 'undefined') return () => {};
  const w = window;
  if (typeof w.addEventListener !== 'function') return () => {};

  const remove = (): void => {
    for (const type of GESTURE_EVENTS) {
      try {
        w.removeEventListener(type, onGesture, true);
      } catch {
        /* never throw while tidying up */
      }
    }
  };

  function onGesture(): void {
    unlockAudioNow('gesture');
    // Removed rather than left with a cheap early return: these are capture
    // listeners on every tap in the app, and the work they exist for is done.
    remove();
  }

  for (const type of GESTURE_EVENTS) {
    try {
      w.addEventListener(type, onGesture, true);
    } catch {
      /* a page that refuses the listener still runs the drill */
    }
  }
  return remove;
}

/** Test-only: forget that this page was ever unlocked. */
export function _resetAudioUnlockForTest(): void {
  unlocked = false;
}
