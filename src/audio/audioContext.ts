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

import { diag } from '../diag/diagnosticLog';

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

/** How long to wait for a resume() that iOS may never settle. */
const RESUME_WAIT_MS = 1000;

/**
 * Bring the context to 'running' if it is not, and say whether it is.
 *
 * Web Audio is where the loud speaker is once a mic has been opened, so a
 * context that is suspended or interrupted must not silently send a line back
 * to the earpiece element. `resume()` can reject (no gesture) or never settle
 * (iOS interrupted), hence the bounded wait. Every attempt is logged.
 */
export async function ensureContextRunning(ctx: AudioContext): Promise<boolean> {
  if (ctx.state === 'running') return true;
  const before = ctx.state;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise<void>((resolve) => setTimeout(resolve, RESUME_WAIT_MS)),
    ]);
  } catch {
    /* checked below */
  }
  const ok = (ctx.state as string) === 'running';
  diag('speak', 'audio-resume', { from: before, to: ctx.state, ok });
  return ok;
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
/**
 * Close the shared graph so the next thing that needs one builds it fresh.
 *
 * FOR THE FIELD TEST, and not for ordinary use. Every leg of the protocol
 * measures where audio comes out, and the four legs run in one page: without
 * this, legs two to four inherit a context that has already been through the
 * microphone opening and closing, so their "before the microphone" cells are
 * not before anything. Closing is safe because `getSharedAudioContext` builds
 * one on demand; a context that refuses to close is left alone rather than
 * thrown, since a leg that runs on a stale graph is much better than a leg that
 * does not run.
 */
export function closeSharedAudioContext(): void {
  const ctx = sharedAudioContext;
  sharedAudioContext = null;
  if (!ctx || ctx.state === 'closed') return;
  try {
    void ctx.close();
  } catch {
    /* a graph that will not close must not stop the run */
  }
}

export function _resetSharedAudioContextForTest(): void {
  sharedAudioContext = null;
}
