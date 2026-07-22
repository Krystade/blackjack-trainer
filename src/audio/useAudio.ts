import { useEffect, useMemo } from 'react';
import type { AudioSettings } from '../store/types';
import { speak, chime } from './speech';
import { setClipsEnabled, setClipVoice } from './clips';

/**
 * Stable narration/chime handle bound to the current `AudioSettings`.
 * `say` speaks at both 'results' and 'full' verbosity (a no-op when audio is
 * disabled or verbosity is 'off'); `sayFull` speaks ONLY at 'full'; `ding`
 * plays a chime tone (a no-op when chimes are off or audio is disabled).
 * Every method is itself a no-op-safe wrapper over `speech.ts` -- callers
 * never need to check `enabled`/`verbosity` themselves.
 */
export interface AudioApi {
  say: (text: string, opts?: { interrupt?: boolean }) => void;
  sayFull: (text: string) => void;
  ding: (kind: 'good' | 'bad' | 'attention') => void;
  enabled: boolean;
}

/**
 * Binds `AudioSettings` to a stable `AudioApi`. The returned object is
 * `useMemo`-stable across renders that don't change any individual audio
 * field -- callers may safely put it in an effect's dependency array (e.g.
 * the cycle-2 bot-narration pacing timer in `useGame.ts`) without risking a
 * re-fire loop.
 */
export function useAudio(audio: AudioSettings): AudioApi {
  const { enabled, verbosity, rate, voiceURI, chimes, useClips, clipVoice } = audio;

  // Keep speech.ts's module-level clip flag (clips.ts) in sync with the
  // current setting. This is the "useAudio side" of the wiring described in
  // clips.ts/speech.ts -- the Settings screen additionally calls
  // setClipsEnabled directly on toggle, since it renders without calling
  // useAudio itself.
  useEffect(() => {
    setClipsEnabled(useClips);
  }, [useClips]);

  // Same pattern for the selected clip voice.
  useEffect(() => {
    setClipVoice(clipVoice);
  }, [clipVoice]);

  return useMemo<AudioApi>(() => {
    const say: AudioApi['say'] = (text, opts) => {
      if (!enabled || verbosity === 'off') return;
      speak(text, { interrupt: opts?.interrupt, rate, voiceURI });
    };

    const sayFull: AudioApi['sayFull'] = (text) => {
      if (!enabled || verbosity !== 'full') return;
      speak(text, { rate, voiceURI });
    };

    const ding: AudioApi['ding'] = (kind) => {
      if (!enabled || !chimes) return;
      chime(kind);
    };

    return { say, sayFull, ding, enabled };
  }, [enabled, verbosity, rate, voiceURI, chimes]);
}
