/**
 * The two microphone experiments, where the recogniser can reach them.
 *
 * WHY MODULE-LEVEL AND NOT A PROP. `useVoiceControl` is called from nine
 * screens. Threading two settings through all nine would mean the one screen
 * added later silently drills with the control arm, and a drive that mixes
 * arms produces a number that cannot be read. The same reasoning put
 * `setUserVoiceAliases` here rather than in a prop; see `useAudio.ts`, which
 * is the single place settings are applied to the audio layer.
 *
 * HELD AS GETTERS BY THE CONTROLLER. The controller is rebuilt only when
 * voice is toggled, so a value captured at construction would need a reload
 * to take effect. Reading per session instead means flipping either of these
 * applies to the next utterance, which is what makes them testable in one
 * drive rather than two.
 */

import { loadSettings } from '../store/persist';

export type MicCueOn = 'start' | 'audiostart';

export interface MicTuning {
  /** Whether to cue on the engine's `onstart` or on real audio. */
  cueOn: MicCueOn;
  /** How many readings of one utterance to ask the engine for. */
  alternatives: number;
}

/**
 * READ FROM STORAGE ON FIRST USE, not left on a fallback until an effect runs.
 *
 * `useAudio` is mounted per SCREEN, not once at the app root, so the effect
 * that applies these settings is not guaranteed to run before the voice
 * controller opens its first session -- the two live in different components
 * and their order depends on tree position. A first session on the wrong arm
 * would quietly contaminate the experiment this whole change exists to run,
 * and it would do so invisibly: the log would name the arm the settings
 * screen shows, not the arm the session used.
 *
 * So the first read resolves from the stored settings, which is the same
 * source `useAudio` would hand over a tick later. The effect still runs and
 * still wins; this only closes the gap before it.
 */
let current: MicTuning | null = null;

function resolved(): MicTuning {
  if (current) return current;
  try {
    const audio = loadSettings().audio;
    current = {
      cueOn: audio.micCueOn === 'start' ? 'start' : 'audiostart',
      alternatives: clampAlternatives(audio.voiceAlternatives, 3),
    };
  } catch {
    // Storage can throw in a private window. The conservative arm is the one
    // that already shipped, so a failure here costs the experiment, not the
    // drive.
    current = { cueOn: 'start', alternatives: 3 };
  }
  return current;
}

/**
 * A stored blob from an older build, or one edited by hand, can carry
 * anything -- and this value is assigned straight onto the recogniser, where
 * Chrome throws a SyntaxError on an out-of-range `maxAlternatives`. A throw
 * there kills the session, which in a car is silence for the rest of the
 * drive.
 */
function clampAlternatives(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(1, Math.min(20, Math.round(v)))
    : fallback;
}

export function setMicTuning(next: Partial<MicTuning>): void {
  const now = resolved();
  current = {
    cueOn: next.cueOn ?? now.cueOn,
    alternatives: clampAlternatives(next.alternatives, now.alternatives),
  };
}

export function micCueOn(): MicCueOn {
  return resolved().cueOn;
}

export function micAlternatives(): number {
  return resolved().alternatives;
}

/** Test-only: forget what was resolved, so the next read goes to storage. */
export function _resetMicTuningForTest(): void {
  current = null;
}
