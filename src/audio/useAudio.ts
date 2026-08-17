import { useEffect, useMemo } from 'react';
import type { AudioSettings } from '../store/types';
import { speak, chime, repeatLast } from './speech';
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
  /** Re-speak the last utterance at the CURRENT rate/voice/volume. Backs the
   * Repeat control; a no-op when audio is off or nothing has been said. */
  replay: () => void;
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
  const { enabled, verbosity, rate, voiceURI, chimes, useClips, clipVoice, volume } = audio;

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
      speak(text, { interrupt: opts?.interrupt, rate, voiceURI, volume });
    };

    const sayFull: AudioApi['sayFull'] = (text) => {
      if (!enabled || verbosity !== 'full') return;
      speak(text, { rate, voiceURI, volume });
    };

    const ding: AudioApi['ding'] = (kind) => {
      if (!enabled || !chimes) return;
      chime(kind, { volume });
    };

    // There is deliberately no `hasSpoken()` companion (A2). It would have to
    // read speech.ts's module state during render, which React does not
    // subscribe to, so a Repeat button disabled by it would not re-enable when
    // the first line was spoken. `repeatLast()` already no-ops safely with
    // nothing to say, so the button simply stays live and the trap is gone.
    //
    // Replay deliberately ignores `verbosity`. The utterance already cleared
    // that gate when it was first spoken -- re-gating here would mean a
    // Repeat button that does nothing at 'results' verbosity for a line the
    // user demonstrably just heard.
    const replay: AudioApi['replay'] = () => {
      if (!enabled) return;
      repeatLast({ rate, voiceURI, volume });
    };

    return { say, sayFull, ding, replay, enabled };
    // `volume` belongs here with rate/voiceURI: omitting it would freeze every
    // bound closure above at the volume in force when the memo last ran, so
    // dragging the slider would appear to do nothing until some other audio
    // setting happened to change.
  }, [enabled, verbosity, rate, voiceURI, chimes, volume]);
}
