import { estimateSpeechMs } from '../audio/speech';
import { GUIDED_CLIP_MS } from './clipDurations';

/**
 * Review of A9: the Drive transition's safety cap, from measured clip
 * durations rather than a fixed 16 s.
 *
 * The cap only matters when a line never reports its end; then the segment
 * starts anyway. Fixed, it either cut the listen beat (the first transition
 * queues behind the tap's intro AND the command hint, about 9 s of recorded
 * speech) or held a dead transition far too long. So: the recorded length of
 * every line queued ahead of the listen beat, at the chosen rate, plus the
 * beat, plus DRIVE_CAP_MARGIN_MS for a slow Bluetooth wake or a clip start.
 */
export const DRIVE_CAP_MARGIN_MS = 3000;

/**
 * Drive: after the transition line, the beat the transition's microphone
 * listens before the segment starts -- the only moment the bare "skip",
 * "pause" and "end" are commands (over a running drill they could be answers).
 *
 * 3000ms (audit A9), not the 1500ms it shipped with. A word said after the
 * line has to be endpointed and delivered before the segment starts, because
 * starting it unmounts this microphone and its stop() throws away a result
 * still in flight -- and the car has delivered results 2258ms after the
 * speech ended (2026-10-02). At 1500ms the window existed on paper only.
 */
export const DRIVE_INTRO_LISTEN_MS = 3000;

/** How long `text` takes, from the measured clip of each sentence (an estimate for any without one). */
export function spokenMs(text: string, rate = 1): number {
  const safeRate = rate > 0 ? rate : 1;
  let total = 0;
  for (const sentence of text.split(/(?<=[.?!]) /)) {
    total += GUIDED_CLIP_MS[sentence] ?? estimateSpeechMs(sentence);
  }
  return total / safeRate;
}

/** `lines` are said back to back, then the transition listens for `listenMs`. */
export function driveTransitionCapMs(lines: readonly string[], listenMs: number, rate = 1): number {
  return lines.reduce((sum, line) => sum + spokenMs(line, rate), 0) + listenMs + DRIVE_CAP_MARGIN_MS;
}
