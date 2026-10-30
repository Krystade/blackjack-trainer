import type { SpeakOutcome } from '../audio/speech';
import { COUNT_RESUME_PROBE_MS } from './countPause';

/**
 * Review of A12: a count run held on an unheard card lifts by itself once
 * audio is confirmed playing again. A short "Resuming." is tried on a timer;
 * the first one actually heard calls `onHeard`.
 */
export interface ResumeProbeDeps {
  /** Says the probe line; resolves with how it went. */
  say: () => Promise<SpeakOutcome>;
  /** Stops whatever is sounding (cancelSpeech). */
  stopSpeech: () => void;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
  onHeard: () => void;
  log: (detail: { outcome: SpeakOutcome }) => void;
}

export interface ResumeProbe {
  /**
   * Ends the probe. Review: a resume (by tap or voice) while a probe line is
   * still in flight stops that line, so a late "Resuming." never plays over
   * the replayed card.
   */
  stop: () => void;
}

export function startResumeProbe(deps: ResumeProbeDeps): ResumeProbe {
  let stopped = false;
  let inFlight = false;
  let timer = 0;
  const attempt = async () => {
    if (stopped) return;
    inFlight = true;
    let outcome: SpeakOutcome;
    try {
      outcome = await deps.say();
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    deps.log({ outcome });
    if (outcome === 'spoken') deps.onHeard();
    else timer = deps.schedule(() => void attempt(), COUNT_RESUME_PROBE_MS);
  };
  timer = deps.schedule(() => void attempt(), COUNT_RESUME_PROBE_MS);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      deps.cancel(timer);
      if (inFlight) deps.stopSpeech();
    },
  };
}
