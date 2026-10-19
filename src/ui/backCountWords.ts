import { normaliseAlias } from '../audio/voiceAliases';
import { DEAL_WORDS } from './dealWord';
import { matchVoiceAction } from '../audio/voiceRecognition';

/**
 * Wave J: the back-counter's words at the table, between rounds.
 *
 * None of these is in the command vocabulary (`VOICE_ACTIONS`): each means
 * something only at a back-count table, and only between rounds, so the table
 * claims them itself the way it claims "deal" (ui/dealWord.ts). As there, only
 * a WHOLE reading counts -- "sit in" is a sit-in, "I'll sit in a minute" is
 * not -- and every form is at most two words, the ceiling `selfEcho.ts` needs
 * to keep telling the app's own voice from an answer.
 *
 * Watching, "deal" and "next" are a WATCH: they ask for the next round, and a
 * watcher who asks for the next round is dealt nothing. "Yes" does the same
 * (handleVoiceCommand), so the one word that deals a seated round never sits a
 * watcher down by accident.
 *
 * None of them occurs in what the app says at a back-count table: "Sitting
 * out." and "Your ramp sits out." are not "sit out", and "Your ramp plays."
 * is not "play" -- a whole reading has to MATCH.
 */
export const WATCH_WORDS: readonly string[] = ['watch', 'next', 'keep watching', ...DEAL_WORDS];
export const SIT_IN_WORDS: readonly string[] = ['sit', 'sit in', 'sit down', 'in', 'play'];
/** Seated: leave the table (the back-counter's sit-out). */
export const LEAVE_WORDS: readonly string[] = ['leave', 'leave table', 'sit out'];

/** Every word above. */
export const BACK_COUNT_WORDS: readonly string[] = [...new Set([...WATCH_WORDS, ...SIT_IN_WORDS, ...LEAVE_WORDS])];

/**
 * The recogniser's bias list: the two-word forms only. Biasing it toward
 * bare "in", "play", "sit" or "next" makes them likelier as RUNNERS-UP to
 * whatever was really said (review S1) -- they stay accepted, just not courted.
 */
export const BACK_COUNT_BIAS: readonly string[] = BACK_COUNT_WORDS.filter((w) => w.includes(' ') && !DEAL_WORDS.includes(w));

export type BackCountWord = 'watch' | 'sit-in' | 'leave';

/**
 * The back-count decision in a set of readings, best reading first, or null.
 * Watching, a reading is a watch or a sit-in; seated, only a leave.
 *
 * Review S1: a runner-up never outranks a command above it. ["yes", "in"]
 * is a "yes" (a watch), not a sit-in: the scan stops at the first reading
 * that is a command (`isCommand`, the shipped and user vocabulary by default).
 */
export function backCountWordIn(
  readings: readonly string[],
  seat: 'watching' | 'seated',
  isCommand: (reading: string) => boolean = (r) => matchVoiceAction(r) !== null,
): BackCountWord | null {
  for (const reading of readings) {
    const said = normaliseAlias(reading);
    if (seat === 'watching') {
      if (WATCH_WORDS.includes(said)) return 'watch';
      if (SIT_IN_WORDS.includes(said)) return 'sit-in';
    } else if (LEAVE_WORDS.includes(said)) {
      return 'leave';
    }
    if (isCommand(reading)) return null;
  }
  return null;
}
