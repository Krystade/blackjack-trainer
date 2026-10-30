import { normaliseAlias } from '../audio/voiceAliases';

/**
 * Wave X (item 2): "rewind", said while a wrong count's verdict offers it,
 * replays the cards since the count was last right. A whole reading only, as
 * "deal" is (dealWord.ts), so a sentence with the word in it is not taken.
 */
export const REWIND_WORDS: readonly string[] = ['rewind'];

export function isRewindWord(readings: readonly string[]): boolean {
  return readings.some((r) => REWIND_WORDS.includes(normaliseAlias(r)));
}
