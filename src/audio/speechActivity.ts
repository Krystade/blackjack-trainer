/**
 * The one channel by which the speaker tells the microphone it is making a
 * noise -- and, more importantly, that it has stopped.
 *
 * WHY IT IS ITS OWN MODULE. This lived in speech.ts, which meant only the live
 * TTS path could report an ending: clips settle in clips.ts, and clips.ts
 * cannot import speech.ts because speech.ts already imports clips.ts. So the
 * half of the app that actually speaks -- the recorded voice ships on by
 * default -- had no way to say when it had finished. Extracted for the same
 * reason audioContext.ts was.
 *
 * WHY AN ENDING MATTERS AT ALL. The deaf window is sized up front from
 * `estimateSpeechMs`, which is a guess, and against recorded clips it is
 * consistently short: clips run slower than 16 characters a second and carry
 * leading and trailing silence. From the 2026-10-02 drive, both measured:
 *
 *   said="You have seventeen. Dealer shows nine."  estimate 2375ms, clip 3550ms
 *     -> the window shut 476ms BEFORE the prompt finished
 *   said="Stand."                                  estimate  400ms, clip 1240ms
 *     -> 142ms
 *
 * For those 476 milliseconds the microphone was live under the app's own
 * voice. `looksLikeLateSelfEcho` covers the long ones on their words, but it
 * deliberately will not touch anything shorter than three words -- that floor
 * is what protects real answers, every one of which is one or two words. So a
 * one-word echo depends on the timer alone, and the timer should stop guessing
 * the moment it has a measurement.
 */

/**
 * 'start' carries an ESTIMATE of how long the app is about to talk for.
 * 'end' carries the fact that it has stopped, and is the only one of the two
 * that is measured rather than guessed.
 */
export type SpeechActivityPhase = 'start' | 'end';

/**
 * `text` is optional and carried only for the diagnostic log, and for telling
 * the app's own voice apart from the operator's (see audio/selfEcho.ts).
 *
 * What the app said is the other half of "it didn't hear me": every utterance
 * deafens the microphone for its own duration plus a tail, so a verbose
 * setting can leave the operator answering into a window that was never open.
 * The suppression window alone does not show that; the sentence that caused it
 * does.
 */
export type SpeechActivityListener = (
  estimatedMs: number,
  text?: string,
  phase?: SpeechActivityPhase,
) => void;

/**
 * One listener, not a list: the consumer is the voice controller, and only one
 * recogniser can run per page (a second ends the first), so exactly one thing
 * ever needs telling.
 */
let speechActivityListener: SpeechActivityListener | null = null;

export function setSpeechActivityListener(fn: SpeechActivityListener | null): void {
  speechActivityListener = fn;
}

/** The app is ABOUT to make a noise, for roughly this long. */
export function notifyActivityMs(ms: number, text?: string): void {
  const listener = speechActivityListener;
  if (!listener || ms <= 0) return;
  try {
    listener(ms, text, 'start');
  } catch {
    /* the microphone's bookkeeping must never break making a sound */
  }
}

/**
 * The app has STOPPED making a noise, measured rather than estimated.
 *
 * `suppressFor` never shortens a window, so this can only ever end one early
 * -- an utterance that finished sooner than its estimate keeps the window the
 * estimate bought, and one that ran over gets the extra it needed.
 *
 * No text: the words are already stored by the consumer, and re-sending them
 * would count as a fresh utterance one level up and re-arm the cue it just
 * gave.
 */
export function notifySpeechEnded(): void {
  const listener = speechActivityListener;
  if (listener) {
    try {
      listener(0, undefined, 'end');
    } catch {
      /* never throw out of a settle */
    }
  }
  // Taken before they run: a waiter that re-registers (because something else
  // is still talking) must wait for the NEXT ending, not be drained by this
  // one in an endless loop.
  const waiting = quietWaiters;
  quietWaiters = [];
  for (const fn of waiting) {
    try {
      fn();
    } catch {
      /* one cue failing must not swallow the others */
    }
  }
}

/**
 * Things waiting for the app to stop talking.
 *
 * ONE CASE, and it is the cue that says "the microphone is open, speak now".
 * From Jack's 2026-10-02 log:
 *
 *   16:22:58.527  speak clip-chain  files="you-have-ace-five.mp3, dealer-shows-ten.mp3"
 *   16:22:58.597  speak chime kind=ready volume=1
 *   16:23:01.556  speak clip-end   ms=3029
 *
 * The cue fired seventy milliseconds into a three-second prompt, as a 120ms
 * sine at half scale underneath a voice at full. He reported it as a chime
 * that never played. It was also premature: anything said during that prompt
 * would have been suppressed, so the moment worth marking is not when the
 * recogniser confirms but when the app next shuts up.
 *
 * Kept here because this is where both endings land -- live TTS settles in
 * speech.ts and clips settle in clips.ts, and neither file may import the
 * other.
 */
let quietWaiters: (() => void)[] = [];

/**
 * Run `fn` the next time something finishes speaking.
 *
 * The caller re-checks whether anything else is still talking and registers
 * again if so: this module deliberately does not know what "speaking" means,
 * which is what keeps it free of both speech.ts and clips.ts.
 */
export function whenSomethingFinishesSpeaking(fn: () => void): () => void {
  quietWaiters.push(fn);
  return () => {
    quietWaiters = quietWaiters.filter((w) => w !== fn);
  };
}

/** Test-only: drop any cue still waiting for silence. */
export function _resetQuietWaitersForTest(): void {
  quietWaiters = [];
}
