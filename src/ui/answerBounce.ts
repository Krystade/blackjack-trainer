import { ANSWER_BOUNCE_MS, isAnswerBounce } from '../drills/answerBounce';
import { isE2eAudioMode } from '../audio/speech';

declare global {
  interface Window {
    /**
     * The bounce guard's length under `?e2e=1`, where it defaults to 0: the
     * specs answer hand after hand faster than any person, and every one of
     * them would otherwise be dropped as a bounce. The guard's own spec sets
     * it to the real value.
     */
    __e2eAnswerBounceMs?: number;
  }
}

function guardMs(): number {
  if (isE2eAudioMode()) return window.__e2eAnswerBounceMs ?? 0;
  return ANSWER_BOUNCE_MS;
}

/** True when an answer arriving now is too soon after the hand appeared at
 *  `shownAt` (a performance.now() reading) to be anything but a bounce. */
export function answerTooSoon(shownAt: number): boolean {
  return isAnswerBounce(shownAt, performance.now(), guardMs());
}
