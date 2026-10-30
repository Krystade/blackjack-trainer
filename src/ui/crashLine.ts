import { speak, type SpeechOpts } from '../audio/speech';
import { speechOptsFrom } from '../audio/speechOpts';
import { loadSettings } from '../store/persist';
import { diag } from '../diag/diagnosticLog';
import { isEyesFreeOn } from './eyesFreeSession';
import { CRASH_LINE } from './crashLineText';

/**
 * D1b: A CRASHED SCREEN SAYS SO, WHEN NOBODY IS LOOKING AT IT.
 *
 * A screen that throws is replaced by the ErrorBoundary's fallback, and its
 * cleanups stop speech and the microphone on the way out. On a screen that is
 * being watched that is fine: the fallback says what happened. Eyes-free --
 * and Drive, which is eyes-free switched on from Home -- nothing is watching,
 * so the drill simply went quiet, which in a car reads exactly like the app
 * having died.
 *
 * So the boundary speaks one recorded line (a clip in every voice, live TTS
 * where there is none). Nothing here may lean on React: the tree that held
 * the settings is the one that just crashed. Eyes-free is module state
 * (eyesFreeSession.ts); the voice, rate and volume are read back off disk,
 * and if even that fails the line goes out with the defaults.
 *
 * `protect`: the crashed drill's unmount cleanups cancel speech AFTER the
 * boundary has caught the throw (passive effects run last), and would cut the
 * line off in its first syllable.
 */
export { CRASH_LINE };

/** Whether a crash now would be spoken: eyes-free (or Drive) is on. */
export function crashLineWanted(): boolean {
  try {
    return isEyesFreeOn();
  } catch {
    return false;
  }
}

/** Speak the crash line once. Never throws: this runs inside the crash path. */
export function sayCrashLine(): void {
  try {
    let opts: SpeechOpts = { interrupt: true };
    try {
      opts = speechOptsFrom(loadSettings().audio, { interrupt: true });
    } catch {
      /* settings unreadable: the defaults will do */
    }
    speak(CRASH_LINE, { ...opts, protect: true });
    diag('err', 'crash-line-spoken');
  } catch {
    /* the fallback screen is still there */
  }
}
