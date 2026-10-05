/**
 * Words the operator adds himself, for the commands the engine will not hear.
 *
 * WHY. Jack, 2026-10-04, once the audio was audible enough to judge: "The
 * voice detection is pretty rough. I think we need to come up with some new
 * code words or something ... maybe set a setting where I can put in a bunch
 * of different aliases for the different words just to help so I can say
 * something that's easier for it to pick out."
 *
 * The shipped table in voiceRecognition.ts guesses which mishearings are
 * likely. His logs show it guessing wrong -- `heard=Strength`, `heard=Touch`,
 * `heard=Definitely`, `heard="That's for sure"`, every one rejected. And the
 * mapping cannot be recovered after the fact: the log stores what the ENGINE
 * returned, never what was actually said. Only the person who spoke knows,
 * which is why this is a setting and not a cleverer matcher.
 */
import { VOICE_ACTIONS, type VoiceAction } from './voiceRecognition';

/**
 * THE ONE LIMIT THAT CANNOT BE RELAXED.
 *
 * audio/selfEcho.ts dismisses a late transcript as the app's own voice once it
 * is longer than anything the operator could have said, and it measures
 * "longer than" against the alias list itself -- deliberately, so that adding
 * a long alias fails a test instead of a drive. Admit a three-word alias and
 * the app loses the ability to tell its own prompt from a command, and starts
 * grading its own voice as an answer.
 *
 * Two words is what the built-ins already use ("double down", "say again"), so
 * nothing is given up by holding the line here.
 */
export const MAX_ALIAS_WORDS = 2;

/**
 * Reduce an alias to the form a transcript is compared in.
 *
 * Must match `normalise` in voiceRecognition.ts: an alias stored in any other
 * shape is an alias that never fires, and a setting that silently does nothing
 * is worse than no setting.
 */
export function normaliseAlias(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * What is wrong with this alias, or null when nothing is.
 *
 * Returns prose rather than a code because it is shown to the operator at the
 * moment he types it, and a roadside is no place to look up an error number.
 */
export function aliasProblem(text: string): string | null {
  const cleaned = normaliseAlias(text);
  if (!cleaned) {
    return 'Type a word for the app to listen for.';
  }
  if (/[0-9]/.test(text)) {
    return 'Letters only — an engine writes numbers as digits or words unpredictably.';
  }
  const words = cleaned.split(' ');
  if (words.length > MAX_ALIAS_WORDS) {
    return 'At most two words, or the app can no longer tell your voice from its own.';
  }
  if (cleaned in VOICE_ACTIONS) {
    return `“${cleaned}” is already a command, so this changes nothing.`;
  }
  return null;
}

/** The actions an alias may point at. */
export function aliasTargets(): VoiceAction[] {
  return Object.keys(VOICE_ACTIONS) as VoiceAction[];
}
