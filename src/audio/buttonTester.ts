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
 * tester holds the silent element in audio/audioFocus.ts for as long as it
 * runs. It is not decoration: without it the test cannot produce a negative
 * result you can trust.
 *
 * That hold used to live here, privately. It moved out when the drive of
 * 2026-09-19 showed the drills needed exactly the same thing for exactly the
 * same reason -- the wheel only reached the app while a clip happened to be
 * audible -- and a mechanism two callers need is not the tester's to own.
 *
 * Nothing here decides what a button DOES. It redirects every action to a
 * reporter (see mediaSession.ts's `setMediaSessionProbe`) so a test press
 * cannot also answer a drill question, and puts the mapping back on stop.
 */

import { MEDIA_SESSION_ACTIONS, setMediaSessionProbe, setNowPlaying } from './mediaSession';
import { holdAudioFocus, releaseAudioFocus } from './audioFocus';
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

  holdAudioFocus('button-test');

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
      releaseAudioFocus('button-test');
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
