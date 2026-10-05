/**
 * The price of opening the microphone, which is paid once and not refunded.
 *
 * WHAT WAS MEASURED. Jack, 2026-10-03: "Whenever I turn on the mic it switches
 * my speaker to the phone speaker like I'm on a phone call... It works fine
 * until I turn on voice and then it's stuck like that." Asked directly whether
 * turning voice back off brings the loud speaker back, the answer was no: it
 * stays on the earpiece for the rest of the session.
 *
 * That is iOS putting the audio session into play-and-record the moment
 * anything opens a microphone, and play-and-record sends output to the
 * receiver -- the quiet earpiece at the top of the phone -- rather than to the
 * loud speaker at the bottom. The Phone app escapes it with
 * `AVAudioSession.setCategory(.playAndRecord, options: .defaultToSpeaker)`,
 * which is the speakerphone button. Safari exposes none of the audio session
 * to a web page: no category, no options, no `setSinkId`, no output device
 * list. There is nothing to call.
 *
 * It is not even a rate change, so the app cannot detect it either -- the
 * hardware probe read 48000 on every `mic-open` and every `mic-closed` of that
 * same drive (diag/environment.ts). The only evidence is the operator's ears.
 *
 * SO THE APP TELLS THE TRUTH INSTEAD. Closing the recogniser between prompts
 * was the obvious fix and it would not have worked: the session outlives the
 * recogniser, which is what "stuck" means. What is left is making the trade
 * visible -- voice answers cost the loud speaker until the app is reopened,
 * and the wheel answers without a microphone at all.
 *
 * A MODULE-LEVEL FLAG because the effect is a property of the PAGE, not of any
 * component or any drill: once a microphone has opened, every screen for the
 * rest of that page load is on the earpiece, including screens that never
 * asked for voice.
 */
let micHasBeenLive = false;

/** Called when a recogniser session actually reaches 'listening'. */
export function markMicSessionOpened(): void {
  micHasBeenLive = true;
}

/**
 * Has anything opened the microphone during this page load?
 *
 * True means the audio is on the earpiece and will stay there until the app is
 * closed and reopened.
 */
export function micSessionCostPaid(): boolean {
  return micHasBeenLive;
}

/**
 * Is a voice session running right now -- the recogniser started and not yet
 * torn down, including the moments it is deafened while the app talks?
 *
 * Clips read this to choose their output path. Measured on Jack's phone,
 * 2026-10-05, three runs with the mic open: Web Audio reached the loud speaker
 * 7 times out of 7, the <audio> element 2 out of 7. Web Audio also obeys the
 * ring switch when NO capture is live (silent twice with the switch on), but
 * not while it is -- so this is the window in which Web Audio is both audible
 * and on the right speaker. clips.ts also keeps Web Audio for the rest of the
 * page once the mic has been opened at all, because the element stays on the
 * earpiece after capture ends.
 */
let voiceCaptureActive = false;

export function setVoiceCaptureActive(active: boolean): void {
  voiceCaptureActive = active;
}

export function isVoiceCaptureActive(): boolean {
  return voiceCaptureActive;
}

/** Test-only: a fresh page. */
export function _resetMicSessionCostForTest(): void {
  micHasBeenLive = false;
  voiceCaptureActive = false;
}
