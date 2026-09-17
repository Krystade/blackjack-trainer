import { estimateSpeechMs } from './speech';
import type { AudioSettings } from '../store/types';

/**
 * How long to wait between asking a question out loud and giving the answer.
 *
 * THE BUG THIS EXISTS TO FIX. Every eyes-free self-check did this:
 *
 *     speak(question);
 *     setTimeout(sayTheAnswer, settings.audio.answerPauseMs);
 *
 * and `speak` returns immediately -- it starts the utterance, it does not wait
 * for it. So the "answer pause" ran CONCURRENTLY with the question being
 * spoken, and what the operator actually got was the pause minus however long
 * the question took to say. The true-count drill's question is about forty-five
 * characters, roughly 2.8 seconds at normal rate, against a default pause of
 * three seconds: two tenths of a second to convert a count. That is not a
 * pause, and it is why the drill was reported (2026-09-16) as "pretty much the
 * whole thing, especially the pausing, just not usable".
 *
 * The fix is to start the clock when the speaking stops. An ESTIMATE rather
 * than a real completion callback, for the reasons `estimateSpeechMs` already
 * gives -- `speechSynthesis` reports nothing useful up front, and clips and
 * live TTS have different real durations -- and because the alternative,
 * awaiting `speakAsync`, resolves instantly under the e2e harness and would
 * make the pause untestable in the one place it is tested.
 *
 * Erring long here costs a moment of silence. Erring short costs the whole
 * exercise, because the answer arrives while the question is still being
 * heard.
 */
export function answerPauseDelayMs(spoken: string, audio: AudioSettings): number {
  return estimateSpeechMs(spoken, audio.rate) + Math.max(0, audio.answerPauseMs);
}

/**
 * The gap between one question being finished with and the next being asked.
 *
 * Only used where the drill keeps going on its own. Long enough not to tread
 * on the verdict that was just spoken, short enough that the silence does not
 * read as the drill having stopped -- which, in a car, is indistinguishable
 * from the microphone having died.
 */
export const NEXT_QUESTION_GAP_MS = 1200;

/** As above, measured from the start of the verdict rather than its end. */
export function nextQuestionDelayMs(spokenVerdict: string, audio: AudioSettings): number {
  return estimateSpeechMs(spokenVerdict, audio.rate) + NEXT_QUESTION_GAP_MS;
}
