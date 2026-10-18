/**
 * F5 (W2-17): how long a Play decision took.
 *
 * Measured from the moment the decision became available -- the action
 * buttons enabled for that hand -- to the tap, with HELD time left out:
 *
 *   - eyes-free, while the app is speaking. A driver cannot act on a hand
 *     before hearing it, so the seconds the narration takes are the app's,
 *     not the decision's.
 *   - while a modal is over the hand (the correction after a wrong play on
 *     the first half of a split, the chart opened from it).
 *
 * A hold has reasons, so the speech and the modal can overlap without one
 * releasing the other. The clock is injected (production: performance.now,
 * a monotonic clock, since this is a duration) so the tests can drive it.
 */

export type HoldReason = 'speech' | 'modal';

export interface DecisionTimer {
  /** A new decision is available now; any previous one is dropped. */
  start(): void;
  /** Hold (on) or release (off) the clock for one reason. Idempotent. */
  hold(reason: HoldReason, on: boolean): void;
  /** Counted ms of the running decision, or null when none is running. */
  elapsed(): number | null;
  /** End the running decision and return its counted ms (null if none). */
  take(): number | null;
  /** Drop the running decision without a result. */
  clear(): void;
}

export function createDecisionTimer(now: () => number = () => performance.now()): DecisionTimer {
  let startedAt: number | null = null;
  let heldMs = 0;
  let heldSince: number | null = null;
  const reasons = new Set<HoldReason>();

  const counted = (): number | null => {
    if (startedAt === null) return null;
    const t = now();
    const holding = heldSince === null ? 0 : t - heldSince;
    return Math.max(0, t - startedAt - heldMs - holding);
  };

  return {
    start() {
      startedAt = now();
      heldMs = 0;
      // A hold already in force (the prompt is still being spoken as the
      // hand is dealt) holds the new decision from its first millisecond.
      heldSince = reasons.size > 0 ? startedAt : null;
    },
    hold(reason, on) {
      const was = reasons.size > 0;
      if (on) reasons.add(reason);
      else reasons.delete(reason);
      const is = reasons.size > 0;
      if (startedAt === null || was === is) return;
      const t = now();
      if (is) {
        heldSince = t;
      } else if (heldSince !== null) {
        heldMs += t - heldSince;
        heldSince = null;
      }
    },
    elapsed: counted,
    take() {
      const ms = counted();
      startedAt = null;
      heldMs = 0;
      heldSince = null;
      return ms;
    },
    clear() {
      startedAt = null;
      heldMs = 0;
      heldSince = null;
    },
  };
}

/**
 * How often the speech hold is re-sampled. The app's speech module reports
 * "speaking" as a state, not as events this screen can subscribe to (its one
 * listener slot belongs to the microphone), so it is polled. An edge is
 * therefore known to within this much; a narrated prompt runs for seconds.
 */
export const SPEECH_POLL_MS = 50;

/**
 * Hold `timer` for as long as `isSpeaking()` says the app is talking,
 * sampled now and every `pollMs`. Returns the stop function.
 */
export function holdWhileSpeaking(
  timer: Pick<DecisionTimer, 'hold'>,
  isSpeaking: () => boolean,
  pollMs: number = SPEECH_POLL_MS,
): () => void {
  const sample = () => timer.hold('speech', isSpeaking());
  sample();
  const id = setInterval(sample, pollMs);
  return () => {
    clearInterval(id);
    timer.hold('speech', false);
  };
}
