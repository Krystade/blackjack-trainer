import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, type Stats } from '../../store/types';
import { hasPracticeData } from './practiceData';

const fresh = (): Stats => structuredClone(EMPTY_STATS);
const historySections = Object.entries(EMPTY_STATS as unknown as Record<string, unknown>)
  .filter(([, v]) => v !== null && typeof v === 'object' && Array.isArray((v as { history?: unknown }).history))
  .map(([k]) => k);

describe('hasPracticeData (1C)', () => {
  it('empty stats have no practice', () => {
    expect(hasPracticeData(fresh())).toBe(false);
  });

  it('EMPTY_STATS has history sections to scan', () => {
    expect(historySections.length).toBeGreaterThanOrEqual(4);
  });

  it.each(historySections)('one row in %s.history counts', (key) => {
    const s = fresh() as unknown as Record<string, { history: unknown[] }>;
    s[key]!.history.push({});
    expect(hasPracticeData(s as unknown as Stats)).toBe(true);
  });

  it('a section added later (not in EMPTY_STATS) with a history row counts', () => {
    const s = { ...fresh(), someNewDrill: { history: [{ correct: true }] } } as unknown as Stats;
    expect(hasPracticeData(s)).toBe(true);
    expect(hasPracticeData({ ...fresh(), someNewDrill: { history: [] } } as unknown as Stats)).toBe(false);
  });

  it('a graded category answer, a cell, an index or a session counts', () => {
    const cat = fresh();
    const first = Object.keys(cat.categories)[0] as keyof Stats['categories'];
    cat.categories[first] = { right: 0, wrong: 1 };
    expect(hasPracticeData(cat)).toBe(true);
    expect(hasPracticeData({ ...fresh(), cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: '' } } })).toBe(true);
    expect(hasPracticeData({ ...fresh(), perIndex: { x: { right: 0, wrong: 1 } } } as unknown as Stats)).toBe(true);
    expect(hasPracticeData({ ...fresh(), sessions: [{ date: '', rounds: 1, graded: 1, correct: 1, bankrollDelta: 0 }] } as Stats)).toBe(true);
  });

  it('the habit record counts: lifetime answers, or a day with answers, time or a met goal', () => {
    const none = { days: {}, answersTotal: 0 };
    expect(hasPracticeData(fresh(), none)).toBe(false);
    expect(hasPracticeData(fresh(), { days: { '2026-11-01': { answers: 0, activeMs: 0 } }, answersTotal: 0 })).toBe(false);
    expect(hasPracticeData(fresh(), { ...none, answersTotal: 1 })).toBe(true);
    expect(hasPracticeData(fresh(), { days: { '2026-11-01': { answers: 3, activeMs: 0 } }, answersTotal: 0 })).toBe(true);
    expect(hasPracticeData(fresh(), { days: { '2026-11-01': { answers: 0, activeMs: 9000 } }, answersTotal: 0 })).toBe(true);
    expect(hasPracticeData(fresh(), { days: { '2026-11-01': { answers: 0, activeMs: 0, met: true } }, answersTotal: 0 })).toBe(true);
  });

  it('an empty cellStats object does not count', () => {
    expect(hasPracticeData({ ...fresh(), cellStats: {} })).toBe(false);
  });
});
