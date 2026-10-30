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

export interface MicDeadWatch {
  onState: (state: ListenState) => void;
  /** A fresh attempt (the tap): the next give-up is announced again. */
  rearm: () => void;
  dispose: () => void;
}

export function createMicDeadWatch(deps: {
  schedule: (fn: () => void, ms: number) => number;
  cancel: (handle: number) => void;
  currentState: () => ListenState;
  announce: (state: ListenState, why: 'terminal' | 'stuck') => void;
  stuckMs?: number;
}): MicDeadWatch {
  let announced = false;
  let timer: number | null = null;
  const clear = (): void => {
    if (timer !== null) deps.cancel(timer);
    timer = null;
  };
  const fire = (state: ListenState, why: 'terminal' | 'stuck'): void => {
    if (announced) return;
    announced = true;
    clear();
    deps.announce(state, why);
  };
  return {
    onState(state) {
      if (state === 'denied' || state === 'unsupported') {
        fire(state, 'terminal');
        return;
      }
      if (state === 'listening' || state === 'off') {
        clear();
        return;
      }
      // 'error', 'restarting' and the 'starting' of a retry: the clock runs
      // from the first of them and only a live session stops it.
      if ((state === 'error' || state === 'restarting') && timer === null && !announced) {
        timer = deps.schedule(() => {
          timer = null;
          const now = deps.currentState();
          if (now === 'listening' || now === 'off') return;
          fire(now, 'stuck');
        }, deps.stuckMs ?? MIC_STUCK_ANNOUNCE_MS);
      }
    },
    rearm() {
      clear();
      announced = false;
    },
    dispose: clear,
  };
}
