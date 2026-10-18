import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRACTICE_DAYS_KEPT,
  dayKeyOfIso,
  localDayKey,
  notePracticeDay,
  practiceDays,
  practiceDaysText,
  withPracticeDay,
} from './practiceDays';
import { EMPTY_STATS, type Stats } from './types';
import { _setStorage, loadStats } from './persist';
import { gradeIndexTestAnswer, gradeFlashcardAnswer } from '../drills/gradeAnswer';
import { generateAllCells } from '../drills/flashcards';
import type { Flashcard } from '../drills/flashcards';
import { correctPlay } from '../engine/strategy';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { IndexTestItem } from '../drills/indexTest';

/**
 * F10 (L-2). Every date here is built from LOCAL calendar fields
 * (new Date(y, m, d, h, min)), so the cases mean the same in any time zone:
 * "23:59 on the 10th" is the 10th wherever the suite runs.
 */
const local = (d: number, h = 12, min = 0, s = 0) => new Date(2026, 9, d, h, min, s);
const iso = (d: number, h = 12, min = 0, s = 0) => local(d, h, min, s).toISOString();

function countRuns(...dates: string[]): Stats {
  return {
    ...EMPTY_STATS,
    countDrill: { history: dates.map((date) => ({ date, cards: 52, intervalMs: 800, correct: true })) },
  };
}

describe('practice days', () => {
  const NOW = local(17, 9, 30); // Saturday 17 Oct 2026, 09:30 local

  it('hidden when nothing was ever practised', () => {
    expect(practiceDays(EMPTY_STATS, NOW)).toEqual({ practised: 0, ever: false });
    expect(practiceDaysText(EMPTY_STATS, NOW)).toBeNull();
  });

  it('today counts, and so does each of the six days before it', () => {
    const stats = countRuns(iso(17, 8), iso(11, 10));
    expect(practiceDays(stats, NOW).practised).toBe(2);
    expect(practiceDaysText(stats, NOW)).toBe('Practised 2 of the last 7 days');
  });

  it('the seventh day back is outside the window', () => {
    const stats = countRuns(iso(10, 20));
    expect(practiceDays(stats, NOW)).toEqual({ practised: 0, ever: true });
    expect(practiceDaysText(stats, NOW)).toBe('Practised 0 of the last 7 days');
  });

  it('local midnight is the boundary: 23:59:59 is the day before, 00:00:00 the day after', () => {
    // The 10th just before midnight is outside the window; the 11th just after it is in.
    expect(practiceDays(countRuns(iso(10, 23, 59, 59)), NOW).practised).toBe(0);
    expect(practiceDays(countRuns(iso(11, 0, 0, 0)), NOW).practised).toBe(1);
    // ...and at 00:00:30 on the 17th, a run at 23:59 on the 16th is yesterday, not today.
    const justAfterMidnight = local(17, 0, 0, 30);
    const lateRun = countRuns(iso(16, 23, 59));
    expect(dayKeyOfIso(iso(16, 23, 59))).toBe('2026-10-16');
    expect(practiceDays(lateRun, justAfterMidnight).practised).toBe(1);
    expect(practiceDays(countRuns(iso(10, 23, 59)), justAfterMidnight).practised).toBe(0);
  });

  it('several answers on one day are one day', () => {
    const stats = countRuns(iso(15, 8), iso(15, 13), iso(15, 22));
    expect(practiceDays(stats, NOW).practised).toBe(1);
  });

  it('reads every dated source: drill rows, latency, Play sessions, cell dates and the per-day set', () => {
    const stats: Stats = {
      ...EMPTY_STATS,
      latencyHistory: [{ category: 'hard', elapsedMs: 900, date: iso(17) }],
      sessions: [{ date: iso(16), rounds: 3, graded: 5, correct: 5, bankrollDelta: 0 }],
      cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: iso(15) } },
      betSizing: { history: [{ date: iso(14), rc: 0, decksRemaining: 3, tc: 0, taken: 1, correct: 1, ok: true }] },
      tableDecisions: { history: [{ elapsedMs: 2000, date: iso(13) }] },
      practiceDays: [localDayKey(local(12))],
    };
    expect(practiceDays(stats, NOW).practised).toBe(6);
  });

  it('ignores unreadable dates rather than counting them', () => {
    const stats: Stats = { ...EMPTY_STATS, latencyHistory: [{ category: 'hard', elapsedMs: 900, date: 'not a date' }] };
    expect(practiceDays(stats, NOW)).toEqual({ practised: 0, ever: false });
  });

  it('the per-day set stays unique, sorted, and capped', () => {
    let days: string[] = [];
    for (let i = 0; i < PRACTICE_DAYS_KEPT + 5; i++) days = withPracticeDay(days, localDayKey(new Date(2026, 0, 1 + i)));
    days = withPracticeDay(days, days[days.length - 1]!);
    expect(days).toHaveLength(PRACTICE_DAYS_KEPT);
    expect([...days].sort()).toEqual(days);
    expect(days[0]).toBe(localDayKey(new Date(2026, 0, 6)));
  });

  it('notePracticeDay leaves the blob alone when the day is already there', () => {
    const once = notePracticeDay(EMPTY_STATS, iso(17));
    expect(once.practiceDays).toEqual(['2026-10-17']);
    expect(notePracticeDay(once, iso(17, 20))).toBe(once);
  });
});

describe('answers with no dated row of their own are dated by the per-day set', () => {
  beforeEach(() => {
    const map = new Map<string, string>();
    _setStorage({ getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) });
  });

  it('an Index test answer (no answer time) records its day', () => {
    const now = local(14, 18).getTime();
    const item: IndexTestItem = {
      deviationId: '16v10',
      cards: [
        { rank: '10', suit: 's' },
        { rank: '6', suit: 's' },
      ],
      up: '10',
      index: 0,
      playAt: 'stand',
      playBelow: 'hit',
      label: '16 v 10: stand at 0',
    } as IndexTestItem;
    gradeIndexTestAnswer(item, 0, {}, now);
    expect(loadStats().practiceDays).toEqual(['2026-10-14']);
    expect(practiceDays(loadStats(), NOW_SAT()).practised).toBe(1);
  });

  it('a timed flashcard answer is dated by its latency row and writes no per-day entry', () => {
    const cell = generateAllCells().find((c) => c.id === 'hard-16-v-10')!;
    const correct = correctPlay(cell.cards, cell.up, 0, { canDouble: true, canSplit: true, canSurrender: true }, DEFAULT_RULES).action;
    const card: Flashcard = { cards: cell.cards, up: cell.up, correct, cellId: cell.id };
    gradeFlashcardAnswer(card, correct, DEFAULT_RULES, 1200, {}, local(16, 7).getTime());
    expect(loadStats().practiceDays).toBeUndefined();
    expect(practiceDays(loadStats(), NOW_SAT()).practised).toBe(1);
  });
});

function NOW_SAT(): Date {
  return local(17, 9, 30);
}
