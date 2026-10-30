import { diag } from '../diag/diagnosticLog';

/**
 * D8: A VOICE ANSWER WHOSE HANDLER THROWS IS NOT DROPPED IN SILENCE.
 *
 * The "got it" tick plays when the word is accepted, BEFORE the screen's
 * handler runs. If that handler threw, voiceControl's empty catch swallowed
 * it: Jack had heard acceptance, nothing happened, and the exported log
 * ended on 'verdict accepted' -- indistinguishable from the drill ignoring a
 * correct answer. So the throw is logged with the action, the error and the
 * screen context, and the screen's own "say that again" path runs, the same
 * one a misheard word takes. The microphone stays up either way.
 */
export function runVoiceAction<A>(
  action: A,
  run: (action: A) => void,
  context: unknown,
  sayAgain: (() => void) | undefined,
): void {
  try {
    run(action);
  } catch (e) {
    diag('mic', 'action-threw', {
      action: typeof action === 'string' ? action : JSON.stringify(action),
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack?.slice(0, 1500) : undefined,
      context: typeof context === 'string' ? context : JSON.stringify(context),
    });
    try {
      sayAgain?.();
    } catch {
      // The recovery path must not take the microphone down either.
    }
  }
}
