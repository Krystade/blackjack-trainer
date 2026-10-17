import { normaliseAlias } from '../audio/voiceAliases';

/**
 * B2 #37: "deal" between rounds. It is the word anyone says for the next hand,
 * and it came back as "not a command" -- whose help line then talked over the
 * "yes" said after it. Only a WHOLE reading counts ("deal", "deal me"), so a
 * sentence with the word in it is not taken as one, and the table only asks
 * between rounds, where dealing is what "yes" already does.
 */
export const DEAL_WORDS: readonly string[] = ['deal', 'deal me'];

export function isDealWord(readings: readonly string[]): boolean {
  return readings.some((r) => DEAL_WORDS.includes(normaliseAlias(r)));
}
