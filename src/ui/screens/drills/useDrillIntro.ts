import { useCallback, useState } from 'react';
import { introAllowed, loadIntroSeen, saveIntroSeen } from '../../../drills/chartIntro';
import { isE2eAudioMode } from '../../../audio/speech';

/** T2-2B: the worked-example keys, one per drill (crossTab/persistHardening list them). */
export const TRUECOUNT_INTRO_KEY = 'bjtrainer.intro.truecount.v1';
export const DECKEST_INTRO_KEY = 'bjtrainer.intro.deckest.v1';
export const PRODUCETC_INTRO_KEY = 'bjtrainer.intro.producetc.v1';

/**
 * T2-2B: whether a drill's worked example opens as a card on this visit.
 * Decided once, at mount: unseen, the drill's history empty, and the shared
 * intro gate (no car session, no autoStart, `?intro` under e2e -- D6).
 *
 * `dismiss` marks it seen -- the card's "Got it", and the drill's Start. It
 * only ever writes when the card was actually shown, so a guided or Drive
 * run (where it never shows) never marks it seen (D6).
 */
export function useDrillIntro(
  key: string,
  /** Read once, at mount. */
  gate: () => { historyEmpty: boolean; eyesFree: boolean; voiceOn: boolean; autoStart: boolean },
): { open: boolean; dismiss: () => void } {
  const [open, setOpen] = useState(() => {
    const g = gate();
    return (
      g.historyEmpty &&
      !loadIntroSeen(key) &&
      introAllowed({
        eyesFree: g.eyesFree,
        voiceOn: g.voiceOn,
        autoStart: g.autoStart,
        search: window.location.search,
        e2e: isE2eAudioMode(),
      })
    );
  });
  const dismiss = useCallback(() => {
    setOpen((was) => {
      if (was) saveIntroSeen(key);
      return false;
    });
  }, [key]);
  return { open, dismiss };
}
