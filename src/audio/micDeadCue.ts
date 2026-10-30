/**
 * A microphone that has given up must SAY so (audit A5).
 *
 * The controller comes to rest in 'denied' or 'unsupported' and stops for good,
 * and it can sit in 'error' / 'restarting' with nothing scheduled to rescue it.
 * The only sign was the status bar's label, which eyes-free means no sign at
 * all: Jack keeps answering, hears no "got it" and no "say again", and cannot
 * tell a dead microphone from a slow app without looking.
 *
 * So the move into a terminal state is announced at once, and a stuck
 * error/restart is announced once it has lasted MIC_STUCK_ANNOUNCE_MS -- long
 * enough that an ordinary restart (a few hundred ms, up to a few seconds of
 * backoff) never speaks. Once per microphone session: a flapping engine must
 * not nag.
 */
import type { ListenState } from './voiceControl';

/** Spoken once when the microphone has stopped for good. Recorded as a clip. */
export const MIC_STOPPED_LINE = 'The microphone has stopped listening.';

/**
 * Said after it when a tap can bring the microphone back (everything but
 * 'unsupported'). iOS only lets a recogniser start inside a gesture, so one
 * tap anywhere is the floor; useVoiceControl listens for exactly that.
 */
export const MIC_TAP_TO_RESTART_LINE = 'Tap the screen once to turn the microphone back on.';

/** Whether one tap can re-request the microphone in this state. */
export function canRestartByTap(state: ListenState): boolean {
  return state !== 'unsupported';
}

/** What is said when the microphone gives up in `state`. */
export function micDeadLine(state: ListenState): string {
  return canRestartByTap(state) ? `${MIC_STOPPED_LINE} ${MIC_TAP_TO_RESTART_LINE}` : MIC_STOPPED_LINE;
}

/** How long an error or restart must last before it is announced. */
export const MIC_STUCK_ANNOUNCE_MS = 10_000;

/** States in which the microphone is not taking answers and nothing is mid-start. */
export function isMicDead(state: ListenState): boolean {
  return state === 'denied' || state === 'unsupported' || state === 'error';
}

/**
 * Review of A5: the least time between two announcements. Each new death is
 * announced (a false "stuck" alarm no longer silences the real one after
 * it), but never more often than this; one that comes sooner is deferred
 * to the end of the window and dropped if the mic came back meanwhile.
 */
export const MIC_DEAD_REANNOUNCE_MS = 30_000;

export interface MicDeadWatch {
  onState: (state: ListenState) => void;
  /** A fresh attempt (the tap): the next give-up is announced again. */
  rearm: () => void;
  dispose: () => void;
}

export function createMicDeadWatch(deps: {
  schedule: (fn: () => void, ms: number) => number;
  cancel: (handle: number) => void;
  now: () => number;
  currentState: () => ListenState;
  announce: (state: ListenState, why: 'terminal' | 'stuck') => void;
  stuckMs?: number;
  reannounceMs?: number;
}): MicDeadWatch {
  /** This death has been announced; reset when the mic is live again. */
  let announced = false;
  let lastAnnouncedAt = Number.NEGATIVE_INFINITY;
  let stuckTimer: number | null = null;
  let deferTimer: number | null = null;
  const clearStuck = (): void => {
    if (stuckTimer !== null) deps.cancel(stuckTimer);
    stuckTimer = null;
  };
  const clearDefer = (): void => {
    if (deferTimer !== null) deps.cancel(deferTimer);
    deferTimer = null;
  };
  const stillDead = (s: ListenState): 'terminal' | 'stuck' | null =>
    s === 'denied' || s === 'unsupported' ? 'terminal' : s === 'error' || s === 'restarting' || s === 'starting' ? 'stuck' : null;
  const fire = (state: ListenState, why: 'terminal' | 'stuck'): void => {
    if (announced) return;
    const wait = lastAnnouncedAt + (deps.reannounceMs ?? MIC_DEAD_REANNOUNCE_MS) - deps.now();
    if (wait > 0) {
      if (deferTimer === null) {
        deferTimer = deps.schedule(() => {
          deferTimer = null;
          const now = deps.currentState();
          const how = stillDead(now);
          if (how) fire(now, how);
        }, wait);
      }
      return;
    }
    announced = true;
    lastAnnouncedAt = deps.now();
    clearStuck();
    clearDefer();
    deps.announce(state, why);
  };
  return {
    onState(state) {
      if (state === 'denied' || state === 'unsupported') {
        fire(state, 'terminal');
        return;
      }
      if (state === 'listening' || state === 'off') {
        // The episode is over: the next death is a new one (review of A5).
        clearStuck();
        clearDefer();
        announced = false;
        return;
      }
      // 'error', 'restarting' and the 'starting' of a retry: the clock runs
      // from the first of them and only a live session stops it.
      if ((state === 'error' || state === 'restarting') && stuckTimer === null && !announced) {
        stuckTimer = deps.schedule(() => {
          stuckTimer = null;
          const now = deps.currentState();
          if (now === 'listening' || now === 'off') return;
          fire(now, 'stuck');
        }, deps.stuckMs ?? MIC_STUCK_ANNOUNCE_MS);
      }
    },
    rearm() {
      clearStuck();
      clearDefer();
      announced = false;
    },
    dispose() {
      clearStuck();
      clearDefer();
    },
  };
}
