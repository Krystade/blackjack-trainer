/**
 * The single builder for a `speak()` option bag from `AudioSettings` (A4).
 *
 * The drill screens call `speak()` directly rather than through `useAudio`
 * (they need the raw promise/pacing behaviour), and every one of those 23 call
 * sites hand-wrote `{ rate: settings.audio.rate, voiceURI: settings.audio.voiceURI }`.
 * When `volume` was added it therefore reached NONE of them: the volume control
 * worked on the table and in Settings' test button, and did nothing at all in
 * the eyes-free drills -- the exact place a volume control is for.
 *
 * The repetition WAS the bug, so the fix is to remove the repetition rather
 * than to patch 23 literals and hope the next field lands everywhere. Any
 * future audio field is added here once and reaches every caller.
 *
 * Lives in its own module rather than in useAudio.ts so the drill views can
 * import it without pulling in a React hook.
 */

import type { AudioSettings } from '../store/types';
import type { SpeechOpts } from './speech';

export function speechOptsFrom(
  audio: AudioSettings,
  extra?: { interrupt?: boolean },
): SpeechOpts {
  const opts: SpeechOpts = {
    rate: audio.rate,
    voiceURI: audio.voiceURI,
    volume: audio.volume,
  };
  // Spread-with-undefined would put an explicit `interrupt: undefined` on the
  // object, which `toEqual` and any future exact-shape check would see.
  if (extra?.interrupt !== undefined) opts.interrupt = extra.interrupt;
  return opts;
}
