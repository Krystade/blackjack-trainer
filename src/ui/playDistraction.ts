import {
  isDistractionPointEvery,
  makeDistraction,
  type Distraction,
  type DistractionDifficulty,
  type DistractionMode,
} from '../drills/distraction';
import type { PlayDistractionFreq, Settings, Stats } from '../store/types';
import { withMinusSigns } from '../drills/signed';

/**
 * T1-1B: Distractions at the Play table -- the Count drill's quick sums,
 * posed between hands as table talk would be. About one per 7 rounds, at a
 * jittered round inside each window of 7 (drills/distraction.ts), never on
 * round 0. The kind alternates by window, so both the sums near the count
 * and the plain ones turn up.
 */

export const PLAY_DISTRACTION_WINDOW = 7;

/**
 * Owner 2026-11-09: the window per frequency choice -- one distraction in
 * each. 'normal' is the 7 above, so the default deals exactly the stops it
 * did before the choice existed.
 */
export const PLAY_DISTRACTION_INTERVAL: Record<PlayDistractionFreq, number> = {
  rare: 12,
  normal: PLAY_DISTRACTION_WINDOW,
  often: 4,
};

export const PLAY_DISTRACTION_FREQS: readonly PlayDistractionFreq[] = ['rare', 'normal', 'often'];
export const DISTRACTION_DIFFICULTIES: readonly DistractionDifficulty[] = ['easy', 'normal', 'hard'];

/** The stored choices, read safely: an unknown value (a later build's, a hand edit) is 'normal'. */
export function playDistractionPrefs(
  settings: Partial<Pick<Settings, 'playDistractionFreq' | 'playDistractionDifficulty'>>,
): { freq: PlayDistractionFreq; difficulty: DistractionDifficulty } {
  const f = settings.playDistractionFreq;
  const d = settings.playDistractionDifficulty;
  return {
    freq: f !== undefined && PLAY_DISTRACTION_FREQS.includes(f) ? f : 'normal',
    difficulty: d !== undefined && DISTRACTION_DIFFICULTIES.includes(d) ? d : 'normal',
  };
}

function windowOf(freq: PlayDistractionFreq): number {
  return PLAY_DISTRACTION_INTERVAL[freq] ?? PLAY_DISTRACTION_WINDOW;
}

/** Whether the round just settled (`roundNo`, 1-based count of rounds dealt) is followed by one. */
export function playDistractionDue(roundNo: number, seed: number, freq: PlayDistractionFreq = 'normal'): boolean {
  if (roundNo <= 0) return false;
  return isDistractionPointEvery(roundNo, windowOf(freq), seed);
}

export function playDistractionKind(roundNo: number, freq: PlayDistractionFreq = 'normal'): DistractionMode {
  return Math.floor(roundNo / windowOf(freq)) % 2 === 1 ? 'near-count' : 'generic';
}

export function makePlayDistraction(
  runningCount: number,
  roundNo: number,
  seed: number,
  freq: PlayDistractionFreq = 'normal',
  difficulty: DistractionDifficulty = 'normal',
): Distraction {
  return makeDistraction(
    runningCount,
    playDistractionKind(roundNo, freq),
    (seed ^ Math.imul(roundNo, 0x9e3779b1)) >>> 0,
    difficulty,
  );
}

export type DistractionRow = Stats['distraction']['history'][number];

/** The stats row, marked as Play's so the Count drill's summary can leave it out. */
export function distractionRow(
  d: Pick<Distraction, 'kind'>,
  answerCorrect: boolean,
  countKept: boolean,
  elapsedMs: number | undefined,
  date: string,
): DistractionRow {
  return {
    date,
    kind: d.kind,
    answerCorrect,
    countKept,
    ...(elapsedMs !== undefined && Number.isFinite(elapsedMs) ? { elapsedMs: Math.round(elapsedMs) } : {}),
    source: 'play',
  };
}

/** The verdict line: the sum and its answer, ticked or crossed. */
export function distractionVerdictText(v: { correct: boolean; prompt: string; answer: number }): string {
  return withMinusSigns(`Sum ${v.correct ? '✓' : '✗'} ${v.prompt} = ${v.answer}`);
}
