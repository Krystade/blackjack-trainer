import type { SpeakOutcome } from '../audio/speech';
import { COUNT_RESUME_PROBE_MS } from './countPause';

/**
 * Review of A12: a count run held on an unheard card lifts by itself once
 * audio is confirmed playing again. A short "Resuming." is tried on a timer;
 * the first one actually heard calls `onHeard`.
 */
/**
 * Review R3: the wait before each attempt backs off -- 4 s, 8 s, 16 s, then
 * every 30 s -- so an outage that lasts (the iOS no-gesture lock after
 * backgrounding) does not retry, and log, every few seconds for an hour.
 */
export const RESUME_PROBE_BACKOFF_MS: readonly number[] = [COUNT_RESUME_PROBE_MS, 8000, 16000, 30000];

export function resumeProbeDelayMs(attempt: number): number {
  return RESUME_PROBE_BACKOFF_MS[Math.min(attempt, RESUME_PROBE_BACKOFF_MS.length - 1)]!;
}

/**
 * Attempts are logged one line per group, the groups doubling (1, 2, 3-4,
 * 5-8, ...): the first line of each group is written, so an hour-long
 * outage costs about eight rows instead of filling the 3000-row log.
 */
function opensGroup(attempt: number): boolean {
  const n = attempt - 1;
  return n === 0 || (n & (n - 1)) === 0;
}

export interface ResumeProbeDeps {
  /** Says the probe line; resolves with how it went. */
  say: () => Promise<SpeakOutcome>;
  /** Stops whatever is sounding (cancelSpeech). */
  stopSpeech: () => void;
  schedule: (fn: () => void, ms: number) => number;
  cancel: (id: number) => void;
  onHeard: () => void;
  log: (detail: { outcome: SpeakOutcome; attempt: number }) => void;
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
  let attempts = 0;
  const attempt = async () => {
    if (stopped) return;
    attempts += 1;
    inFlight = true;
    let outcome: SpeakOutcome;
    try {
      outcome = await deps.say();
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (opensGroup(attempts)) deps.log({ outcome, attempt: attempts });
    if (outcome === 'spoken') deps.onHeard();
    else timer = deps.schedule(() => void attempt(), resumeProbeDelayMs(attempts));
  };
  timer = deps.schedule(() => void attempt(), resumeProbeDelayMs(0));
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      deps.cancel(timer);
      if (inFlight) deps.stopSpeech();
    },
  };
}
