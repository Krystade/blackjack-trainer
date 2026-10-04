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

/** Test-only: a fresh page. */
export function _resetMicSessionCostForTest(): void {
  micHasBeenLive = false;
}
