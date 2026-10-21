import { speak, estimateSpeechMs } from '../audio/speech';
import { speechOptsFrom } from '../audio/speechOpts';
import { effectiveVolume } from '../audio/volume';
import { numberWord } from '../audio/narrate';
import type { AudioSettings } from '../store/types';

/**
 * Wave N: the one spoken line when the daily goal is met eyes-free.
 *
 * Never spoken when it is queued: the goal is crossed by an answer, at the
 * moment the drill is about to speak that answer's verdict. It waits for the
 * drill's next NATURAL PAUSE -- the point where a drill has spoken a verdict
 * and is scheduling its next prompt -- where `sayMomentAtPause` queues it
 * behind the verdict (never interrupting) and returns how long it adds, so the
 * drill holds the next prompt until it has finished.
 */

/** Streak lengths with a recorded "N days in a row." clip. */
export const STREAK_CLIP_MAX = 100;

export const MOMENT_GOAL_LINE = 'Daily goal done.';
export const MOMENT_FIRST_DAY_LINE = 'A new streak starts today.';
export const MOMENT_OVER_MAX_LINE = 'Over one hundred days in a row.';

/** "twelve" .. "one hundred": numberWord covers 0-20; the rest is spelled here. */
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function streakNumberWord(n: number): string {
  if (n <= 20) return numberWord(n);
  if (n === 100) return 'one hundred';
  const t = Math.floor(n / 10);
  const u = n % 10;
  return u === 0 ? TENS[t] : `${TENS[t]}-${numberWord(u)}`;
}

/** The streak sentence, every value of which has a clip. */
export function streakSentence(streak: number): string {
  if (streak <= 1) return MOMENT_FIRST_DAY_LINE;
  if (streak > STREAK_CLIP_MAX) return MOMENT_OVER_MAX_LINE;
  const w = streakNumberWord(streak);
  return `${w[0].toUpperCase()}${w.slice(1)} days in a row.`;
}

export function momentLine(streak: number): string {
  return `${MOMENT_GOAL_LINE} ${streakSentence(streak)}`;
}

/** Every sentence the moment can say, for the clip generator and coverage test. */
export function allMomentSentences(): string[] {
  const out = [MOMENT_GOAL_LINE, MOMENT_FIRST_DAY_LINE, MOMENT_OVER_MAX_LINE];
  for (let n = 2; n <= STREAK_CLIP_MAX; n++) out.push(streakSentence(n));
  return out;
}

let pending: string | null = null;

export function queueMoment(line: string): void {
  pending = line;
}

export function pendingMoment(): string | null {
  return pending;
}

/**
 * At a drill's natural pause: speak the pending line (queued, not
 * interrupting) and return the ms it adds to the pause; 0 when nothing is
 * pending. Muted, audio off or volume 0: the line is dropped unsaid.
 */
export function sayMomentAtPause(audio: AudioSettings): number {
  const line = pending;
  if (line === null) return 0;
  pending = null;
  if (!audio.enabled || audio.verbosity === 'off' || effectiveVolume(audio) <= 0) return 0;
  speak(line, speechOptsFrom(audio));
  return estimateSpeechMs(line, audio.rate) + 300;
}

/** Test seam. */
export function _resetMomentForTest(): void {
  pending = null;
}
