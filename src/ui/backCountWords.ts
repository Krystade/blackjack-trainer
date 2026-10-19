import { normaliseAlias } from '../audio/voiceAliases';

/**
 * Wave J toggle rework: the In/Out toggle's words at the table, between
 * rounds. "In" or "sit in" sets the toggle In, "out" or "sit out" sets it
 * Out; neither deals -- "deal" or "yes" then deals the next round in the
 * state the toggle shows.
 *
 * None of these is in the command vocabulary (`VOICE_ACTIONS`): the table
 * claims them itself the way it claims "deal" (ui/dealWord.ts). As there, only
 * a WHOLE reading counts -- "sit in" is In, "I'll sit in a minute" is not --
 * and every form is at most two words, the ceiling `selfEcho.ts` needs to keep
 * telling the app's own voice from an answer. The app's own "In." and "Out."
 * would match, and set the toggle to the state it already shows.
 */
export const IN_WORDS: readonly string[] = ['in', 'sit in', 'get in'];
export const OUT_WORDS: readonly string[] = ['out', 'sit out', 'get out'];

/** Every word above. */
export const TOGGLE_WORDS: readonly string[] = [...IN_WORDS, ...OUT_WORDS];

/**
 * The recogniser's bias list: the two-word forms only. Biasing it toward a
 * bare "in" or "out" makes them likelier as RUNNERS-UP to whatever was really
 * said (review S1) -- they stay accepted, just not courted.
 */
export const TOGGLE_BIAS: readonly string[] = TOGGLE_WORDS.filter((w) => w.includes(' '));

/**
 * The toggle state asked for, or null. Review S1, kept: only the TOP reading
 * counts -- a runner-up "in" under "yes" is the recogniser's guess, not what
 * was said, and must never flip the toggle.
 */
export function toggleWordIn(readings: readonly string[]): 'in' | 'out' | null {
  const top = readings[0];
  if (top === undefined) return null;
  const said = normaliseAlias(top);
  if (IN_WORDS.includes(said)) return 'in';
  if (OUT_WORDS.includes(said)) return 'out';
  return null;
}
