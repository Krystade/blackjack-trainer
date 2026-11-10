import {
  DISTRACTION_DIFFICULTIES,
  distractionDifficultyOf,
  formatAnswer,
  isDistractionPointEvery,
  makeDistraction,
  type Distraction,
  type DistractionDifficulty,
  type DistractionMode,
} from '../drills/distraction';
import type { PlayDistractionFreq, PlayDistractionType, Settings, Stats } from '../store/types';
import { signed, withMinusSigns } from '../drills/signed';
import { mulberry32 } from '../engine/cards';
import { makeOtherTable, otherTableCount, type OtherTable } from '../drills/otherTable';

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
/** Owner 2026-11-10: the Kind choice, in the order the gear shows it. 'sums' is the default. */
export const PLAY_DISTRACTION_TYPES: readonly PlayDistractionType[] = ['sums', 'table', 'mix'];
export { DISTRACTION_DIFFICULTIES };

/**
 * The stored choices, read safely: an unknown value (a later build's, a hand
 * edit) is 'normal', and an unknown kind is 'sums'.
 */
export function playDistractionPrefs(
  settings: Partial<Pick<Settings, 'playDistractionFreq' | 'playDistractionDifficulty' | 'playDistractionType'>>,
): { freq: PlayDistractionFreq; difficulty: DistractionDifficulty; type: PlayDistractionType } {
  const f = settings.playDistractionFreq;
  const d = settings.playDistractionDifficulty;
  const t = settings.playDistractionType;
  return {
    freq: f !== undefined && PLAY_DISTRACTION_FREQS.includes(f) ? f : 'normal',
    difficulty: distractionDifficultyOf(d),
    type: t !== undefined && PLAY_DISTRACTION_TYPES.includes(t) ? t : 'sums',
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

/**
 * Owner 2026-11-10: a distraction at the Play table -- a sum (the Count
 * drill's Distraction) or another table to count. The table's cards come off
 * its own shoe (drills/otherTable.ts) and never reach the main one.
 */
export type OtherTableDistraction = {
  kind: 'other-table';
  prompt: string;
  /** The Hi-Lo running count of that table's cards, and only those. */
  answer: number;
  table: OtherTable;
  halves?: undefined;
};
export type PlayDistraction = (Distraction & { table?: undefined }) | OtherTableDistraction;
export type PlayDistractionKind = PlayDistraction['kind'];

export const OTHER_TABLE_PROMPT = "What's the count at this table?";

/** Whether this stop deals another table: always, never, or (Mix) a seeded coin per stop. */
export function playDistractionIsTable(type: PlayDistractionType, roundNo: number, seed: number): boolean {
  if (type === 'sums') return false;
  if (type === 'table') return true;
  return mulberry32((seed ^ Math.imul(roundNo, 0x85ebca6b) ^ 0x27d4eb2f) >>> 0)() < 0.5;
}

export function makeOtherTableDistraction(roundNo: number, seed: number, difficulty: DistractionDifficulty): OtherTableDistraction {
  const table = makeOtherTable((seed ^ Math.imul(roundNo, 0xc2b2ae35) ^ 0x165667b1) >>> 0, difficulty);
  return { kind: 'other-table', prompt: OTHER_TABLE_PROMPT, answer: otherTableCount(table), table };
}

/** The stop's distraction, of the kind chosen. 'sums' deals exactly what makePlayDistraction always did. */
export function makePlayStop(
  runningCount: number,
  roundNo: number,
  seed: number,
  prefs: { freq: PlayDistractionFreq; difficulty: DistractionDifficulty; type: PlayDistractionType },
): PlayDistraction {
  if (playDistractionIsTable(prefs.type, roundNo, seed)) return makeOtherTableDistraction(roundNo, seed, prefs.difficulty);
  return makePlayDistraction(runningCount, roundNo, seed, prefs.freq, prefs.difficulty);
}

export type DistractionRow = Stats['distraction']['history'][number];

/** The stats row, marked as Play's so the Count drill's summary can leave it out. */
export function distractionRow(
  d: { kind: PlayDistractionKind },
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

/** The verdict line: the sum and its answer (or the other table's count), ticked or crossed. */
export function distractionVerdictText(v: { correct: boolean; prompt: string; answer: number; kind?: PlayDistractionKind }): string {
  const mark = v.correct ? '✓' : '✗';
  if (v.kind === 'other-table') return `Other table ${mark} count = ${signed(v.answer)}`;
  return withMinusSigns(`Sum ${mark} ${v.prompt} = ${formatAnswer(v.answer)}`);
}
