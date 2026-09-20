import { useEffect, useState } from 'react';
import { diag } from '../diag/diagnosticLog';

/**
 * Whether eyes-free audio is on, remembered for the life of THIS PAGE LOAD.
 *
 * Exactly the argument ui/voiceSession.ts makes for the microphone toggle,
 * and it applies here with more force, because eyes-free is the switch that
 * decides whether the app SPEAKS AT ALL. It used to be `useState(false)` in
 * six separate views, so it was forgotten on every navigation: turn it on in
 * a count drill, go back to the drill list to pick another, and the app was
 * silent again with nothing on screen saying so. In a car, where the screen
 * is not being looked at, silence is indistinguishable from the app having
 * died.
 *
 * It also made the state unreachable from anywhere but the drill that owned
 * it, which is what the field-test panel ran into (diag/fieldTest.ts): a
 * protocol that sets up its own steps could set audio on, the recorded voice
 * on and the microphone shut, and still produce a completely silent step one,
 * because the one toggle that mattered lived inside the screen it was meant
 * to be testing.
 *
 * NOT PERSISTED, and the reason is the same as the microphone's: one run of
 * the app is one session. A reload or a relaunch starts quiet. Within that
 * run the toggle means what it says.
 */

let eyesFreeOn = false;

const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      /* a subscriber must never take the audio down with it */
    }
  }
}

export function setEyesFreeOn(on: boolean, context: string): void {
  if (eyesFreeOn === on) return;
  eyesFreeOn = on;
  diag('nav', on ? 'eyes-free-on' : 'eyes-free-off', { context });
  notify();
}

export function isEyesFreeOn(): boolean {
  return eyesFreeOn;
}

/**
 * The toggle, as a screen sees it.
 *
 * Same shape as the `useState` it replaces, so the call sites read the same
 * -- the only difference is where the value lives.
 */
export function useEyesFreeToggle(context: string): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(eyesFreeOn);
  useEffect(() => {
    const sync = () => setOn(eyesFreeOn);
    listeners.add(sync);
    // A screen mounting after the toggle changed elsewhere has to catch up.
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);
  return [on, (next: boolean) => setEyesFreeOn(next, context)];
}

/** Test seam: reset the page-scoped fact between cases. */
export function _resetEyesFreeForTest(): void {
  eyesFreeOn = false;
  listeners.clear();
}
