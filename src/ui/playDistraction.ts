import { isDistractionPoint, makeDistraction, type Distraction, type DistractionMode } from '../drills/distraction';
import type { Stats } from '../store/types';
import { withMinusSigns } from '../drills/signed';

/**
 * T1-1B: Distractions at the Play table -- the Count drill's quick sums,
 * posed between hands as table talk would be. About one per 7 rounds, at a
 * jittered round inside each window of 7 (drills/distraction.ts), never on
 * round 0. The kind alternates by window, so both the sums near the count
 * and the plain ones turn up.
 */

export const PLAY_DISTRACTION_WINDOW = 7;

/** Whether the round just settled (`roundNo`, 1-based count of rounds dealt) is followed by one. */
export function playDistractionDue(roundNo: number, seed: number): boolean {
  if (roundNo <= 0) return false;
  return isDistractionPoint(roundNo, 'occasional', seed);
}

export function playDistractionKind(roundNo: number): DistractionMode {
  return Math.floor(roundNo / PLAY_DISTRACTION_WINDOW) % 2 === 1 ? 'near-count' : 'generic';
}

export function makePlayDistraction(runningCount: number, roundNo: number, seed: number): Distraction {
  return makeDistraction(runningCount, playDistractionKind(roundNo), (seed ^ Math.imul(roundNo, 0x9e3779b1)) >>> 0);
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
