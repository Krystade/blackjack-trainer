import type { ListenState, HeardVerdict } from '../audio/voiceControl';
import { VOICE_ACTIONS } from '../audio/voiceRecognition';

/**
 * The words the voice status strip is written in.
 *
 * Shared rather than copied because three screens now listen, and a strip
 * that says "Reconnecting…" on one screen and "error" on another teaches the
 * operator two vocabularies for one microphone.
 */

/**
 * What the microphone is doing, in words the operator can act on. A bare
 * "error" tells a driver nothing; each of these says what to do about it.
 */
export const VOICE_STATE_LABEL: Record<ListenState, string> = {
  off: 'Voice off',
  starting: 'Starting…',
  listening: 'Listening',
  // Named honestly rather than hidden. The recogniser dies about every ninety
  // seconds and this gap is genuinely deaf, so a word said here is lost --
  // better to show it than to let the answer vanish silently.
  restarting: 'Reconnecting…',
  denied: 'Microphone blocked — allow it in your browser',
  unsupported: 'This browser cannot listen',
  error: 'No response from the microphone — switch it off and on',
};

/** The whole vocabulary, so there is nothing to guess at while driving. */
export const VOICE_WORDS = Object.keys(VOICE_ACTIONS).join(' · ');

export function describeVerdict(verdict: HeardVerdict | null): string {
  if (verdict === null) return '';
  if (verdict === 'rejected') return 'not a command';
  // Distinguishing this from "not a command" matters: it means the microphone
  // heard the APP, not the operator, and the right response is to wait rather
  // than to repeat themselves louder.
  if (verdict === 'suppressed') return 'ignored (the app was speaking)';
  return verdict;
}
