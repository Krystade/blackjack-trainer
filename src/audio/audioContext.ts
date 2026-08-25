/**
 * The one AudioContext this app owns.
 *
 * Extracted so both the chime path (speech.ts) and the clip amplifier
 * (clips.ts) can share it. Two contexts would be wasteful and, on iOS, each
 * carries its own user-gesture unlock state -- so a second one is a second
 * thing that can be silently suspended while the first works fine.
 *
 * clips.ts cannot simply import this from speech.ts: speech.ts already
 * imports clips.ts, and the cycle would be real rather than type-only.
 */

type AudioContextCtor = new () => AudioContext;

let sharedAudioContext: AudioContext | null = null;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function getSharedAudioContext(): AudioContext | null {
  if (sharedAudioContext) return sharedAudioContext;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    sharedAudioContext = new Ctor();
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/**
 * iOS suspends the context aggressively -- on interruption, on backgrounding,
 * and it starts suspended until a gesture unlocks it. Anything routed through
 * the graph goes SILENT while suspended rather than merely quiet, so every
 * amplified playback nudges it awake first.
 *
 * Fire-and-forget on purpose: `resume()` rejects when there has been no user
 * gesture yet, and that rejection must not become an unhandled rejection or
 * block the audio that is about to play.
 */
export function resumeSharedAudioContext(): void {
  const ctx = sharedAudioContext;
  if (!ctx || ctx.state !== 'suspended') return;
  try {
    void ctx.resume().catch(() => {});
  } catch {
    /* never throw into a playback path */
  }
}

/**
 * Test-only drop of the cached context.
 *
 * The context is memoized for the page's lifetime (constructing one per
 * chime is wasteful and, on iOS, subject to the user-gesture unlock rules).
 * That cache outlives a single test: a spec that swaps in a fresh fake
 * `window.AudioContext` would otherwise keep playing into the PREVIOUS
 * test's fake and silently assert nothing.
 */
export function _resetSharedAudioContextForTest(): void {
  sharedAudioContext = null;
}
