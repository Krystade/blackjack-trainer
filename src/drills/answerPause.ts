import { estimateSpeechMs } from '../audio/speech';

/**
 * How long to hold a graded answer on screen before drawing the next one.
 *
 * `answerPauseMs` was written for a SILENT pause -- long enough to read a
 * correction, chosen when the only feedback was visual. Once the app started
 * reading corrections aloud, that same delay began firing while it was still
 * mid-sentence: the next card was drawn, its prompt spoken with
 * `interrupt: true`, and the explanation of the mistake was cut off by the
 * question after it. Reported from real use as "during the explanation of
 * what I got wrong, it started talking about the next one".
 *
 * So the pause is whichever is longer: the configured one, or however long
 * the app is actually going to be talking, plus a beat to separate the answer
 * from the next question. A correction that says nothing (a correct answer
 * after the first) keeps the configured pause exactly as before.
 */

/**
 * Silence between the end of a correction and the next prompt. Without it the
 * two run together into one utterance and the drill sounds like it is
 * gabbling, which is worse than a slightly long pause.
 */
export const POST_CORRECTION_BEAT_MS = 450;

export function autoAdvanceDelayMs(configuredPauseMs: number, spokenMs: number): number {
  const floor = Math.max(0, configuredPauseMs);
  if (spokenMs <= 0) return floor;
  return Math.max(floor, spokenMs + POST_CORRECTION_BEAT_MS);
}

/**
 * How long `text` will occupy the speaker, or 0 when nothing is said.
 *
 * Thin by design: the estimate itself belongs with `speak()`, which is the
 * one place that knows about clips and live TTS alike, and duplicating it
 * here would let the two drift.
 */
export function spokenPauseFor(text: string | null, rate: number | undefined): number {
  if (!text) return 0;
  return estimateSpeechMs(text, rate ?? 1);
}
