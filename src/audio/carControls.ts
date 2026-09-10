/**
 * Whether the car's steering-wheel buttons can reach this app at all.
 *
 * Two things have to be true, and neither is guessable from the wheel:
 *
 *   1. THE RECORDED VOICE MUST BE ON. `speechSynthesis` is not "media" as far
 *      as a phone OS is concerned -- it creates no media element, claims no
 *      audio focus, and never appears in the now-playing UI. There is nothing
 *      for Media Session to attach to, so no transport button can ever reach
 *      it. Only the pre-rendered clips play through a real HTMLAudioElement.
 *      See audio/mediaSession.ts.
 *
 *   2. THE MICROPHONE MUST BE CLOSED. Opening it switches a Bluetooth link
 *      from A2DP (media) to HFP (hands-free) -- the car then treats the phone
 *      as being on a CALL, which is exactly what was observed on the first
 *      drive: the app appeared as a phone call and every wheel button, hang-up
 *      and answer included, went to the call rather than to the browser. No
 *      web API receives those. So voice control and wheel control are mutually
 *      exclusive, and this is the reason a first drive with both on found
 *      nothing working.
 *
 * The second is not derivable from settings -- voice is a per-session toggle
 * on the drill screens, never persisted -- so it is stated rather than
 * detected. The first is, and is reported here.
 */

export type CarControlsBlocker =
  /** Nothing plays at all, so there is nothing for the car to control. */
  | 'audio-off'
  /** Live speech only: no media element exists for the car to attach to. */
  | 'live-speech';

export interface CarAudioState {
  enabled: boolean;
  useClips: boolean;
}

/**
 * What currently stands between the wheel and the app, worst first.
 *
 * Empty means the settings side is ready -- not that the buttons work, which
 * only a drive can establish.
 */
export function carControlsBlockers(audio: CarAudioState): CarControlsBlocker[] {
  const blockers: CarControlsBlocker[] = [];
  if (!audio.enabled) blockers.push('audio-off');
  if (!audio.useClips) blockers.push('live-speech');
  return blockers;
}

export function describeCarControlsBlocker(blocker: CarControlsBlocker): string {
  switch (blocker) {
    case 'audio-off':
      return 'Audio is off, so nothing plays and the car has nothing to control. Turn on “Audio enabled” above.';
    case 'live-speech':
      return 'The recorded voice is off. Live speech is not “media” to the phone — it opens no player, so the car never sees this app and no wheel button can reach it. Turn on “Use recorded voice” above.';
  }
}

/** The one-line verdict for the panel heading. */
export function carControlsReady(audio: CarAudioState): boolean {
  return carControlsBlockers(audio).length === 0;
}
