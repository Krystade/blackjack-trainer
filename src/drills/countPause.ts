/** C-R2 (W11): what a count run says when the wheel pauses it. A full
 *  sentence so the clip library can carry it (scripts/spokenPhrases.ts). */
export const COUNT_PAUSED_LINE = 'Paused.';

/**
 * Review of A12: a run held on an unheard card tries this short line every
 * COUNT_RESUME_PROBE_MS. Once it is actually heard the audio is back, so the
 * hold lifts and the card is said again.
 */
export const COUNT_RESUMING_LINE = 'Resuming.';
export const COUNT_RESUME_PROBE_MS = 4000;

/**
 * Said in front of a replayed card ("Again: seven, king"), so a card Jack may
 * already have heard is never counted twice. Its own clip (clips.ts splits a
 * "Label:" prefix off a sentence that is not recorded whole).
 */
export const COUNT_AGAIN_PREFIX = 'Again:';

/**
 * Words that resume a paused count run by voice. In Drive the wheel belongs to
 * hands-free mode while the microphone is open, so voice is the way back.
 */
export const COUNT_RESUME_WORDS: readonly string[] = ['resume', 'go on'];

export function isCountResumeWord(readings: readonly string[]): boolean {
  const top = (readings[0] ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return COUNT_RESUME_WORDS.includes(top);
}
