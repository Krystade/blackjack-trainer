import { describe, expect, it } from 'vitest';
import { INDEX_RECENT_KEEP, answerDay, indexRecentAfter, indexRecentUndone, isRecent, recentWindow } from './indexRecent';
import { applyEvents } from './stats';
import { undoGradedEvent } from './undoEvent';
import { EMPTY_STATS } from './types';
import type { GradedEvent } from '../engine/grade';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');
const DAY = 86_400_000;

const quiz = (correct: boolean, at?: string): GradedEvent => ({
  kind: 'action',
  source: 'quiz',
  category: 'hard',
  correct,
  classification: correct ? 'correct' : 'missed-deviation',
  taken: correct ? 'stand' : 'hit',
  expected: 'stand',
  reason: '16 v 10: stand at TC 0+',
  deviationId: '16v10',
  tc: 1,
  hand: '16 v 10',
  ...(at === undefined ? {} : { at }),
});

describe('indexRecent: the store', () => {
  it('appends each answer with its UTC day, oldest first, and keeps the last INDEX_RECENT_KEEP', () => {
    let e = indexRecentAfter(undefined, true, '2026-10-21T23:30:00.000-05:00');
    expect(e).toEqual({ recent: '1', days: ['2026-10-22'] });
    e = indexRecentAfter(e, false, undefined);
    expect(e).toEqual({ recent: '10', days: ['2026-10-22', ''] });
    for (let i = 0; i < 60; i += 1) e = indexRecentAfter(e, i % 2 === 0, `2026-10-${String(1 + (i % 20)).padStart(2, '0')}T10:00:00.000Z`);
    expect(e.recent).toHaveLength(INDEX_RECENT_KEEP);
    expect(e.days).toHaveLength(INDEX_RECENT_KEEP);
    expect(e.recent.endsWith('10')).toBe(true);
    expect(e.days.at(-1)).toBe('2026-10-20');
  });

  it('answerDay: an unreadable or missing time is undated', () => {
    expect(answerDay('2026-10-21T00:00:00.000Z')).toBe('2026-10-21');
    expect(answerDay(undefined)).toBe('');
    expect(answerDay('soon')).toBe('');
  });

  it('Wrong tap restores the judged window exactly, even once the store is full', () => {
    let full = indexRecentAfter(undefined, true, '2026-10-01T00:00:00.000Z');
    for (let i = 0; i < 80; i += 1) full = indexRecentAfter(full, i % 3 !== 0, '2026-10-02T00:00:00.000Z');
    const after = indexRecentAfter(full, false, '2026-10-21T00:00:00.000Z');
    const undone = indexRecentUndone(after)!;
    const judged = (x: typeof full) => recentWindow(x, INDEX_RECENT_KEEP - 1, NOW, 180);
    expect(judged(undone)).toBe(judged(full));
    expect(undone.days.slice(-(INDEX_RECENT_KEEP - 1))).toEqual(full.days.slice(-(INDEX_RECENT_KEEP - 1)));
    expect(indexRecentUndone({ recent: '1', days: ['2026-10-21'] })).toBeUndefined();
    expect(indexRecentUndone(undefined)).toBeUndefined();
  });

  it('isRecent: today is day 0, so 179 days old is in and 180 is out; undated is out', () => {
    expect(isRecent('2026-10-21', NOW, 180)).toBe(true);
    expect(isRecent('2026-04-25', NOW, 180)).toBe(true); // 179 days
    expect(isRecent('2026-04-24', NOW, 180)).toBe(false); // 180 days
    expect(isRecent('2026-04-24T23:59:59.000Z', NOW, 180)).toBe(false);
    expect(isRecent(new Date(NOW - 179 * DAY).toISOString(), NOW, 180)).toBe(true);
    for (const x of ['', undefined, null, 5, 'later']) expect(isRecent(x, NOW, 180)).toBe(false);
  });

  it('recentWindow: the last `size` recent answers, or null with fewer', () => {
    const e = { recent: '0' + '1'.repeat(19) + '0', days: ['2026-01-01', ...Array(20).fill('2026-10-20')] };
    expect(recentWindow(e, 20, NOW, 180)).toBe('1'.repeat(19) + '0');
    expect(recentWindow(e, 21, NOW, 180)).toBeNull();
    expect(recentWindow(undefined, 1, NOW, 180)).toBeNull();
  });
});

describe('indexRecent: written by applyEvents, withdrawn by Wrong tap', () => {
  it('every event naming an index adds to its window, dated by the event, else the caller', () => {
    const s1 = applyEvents(structuredClone(EMPTY_STATS), [quiz(true, '2026-10-20T10:00:00.000Z')]);
    expect(s1.indexRecent).toEqual({ '16v10': { recent: '1', days: ['2026-10-20'] } });
    const s2 = applyEvents(s1, [quiz(false)], '2026-10-21T08:00:00.000Z');
    expect(s2.indexRecent!['16v10']).toEqual({ recent: '10', days: ['2026-10-20', '2026-10-21'] });
    const s3 = applyEvents(s2, [quiz(true)]);
    expect(s3.indexRecent!['16v10']!.days.at(-1)).toBe('');
    // The input is never mutated.
    expect(s1.indexRecent).toEqual({ '16v10': { recent: '1', days: ['2026-10-20'] } });
  });

  it('an event naming no index leaves the store alone, by reference', () => {
    const s1 = applyEvents(structuredClone(EMPTY_STATS), [quiz(true, '2026-10-20T10:00:00.000Z')]);
    const plain: GradedEvent = { kind: 'action', category: 'hard', correct: true, classification: 'correct', taken: 'hit', expected: 'hit', reason: '', tc: 0 };
    expect(applyEvents(s1, [plain]).indexRecent).toBe(s1.indexRecent);
    expect(applyEvents(structuredClone(EMPTY_STATS), [plain]).indexRecent).toBeUndefined();
  });

  it('undo drops the answer, then the emptied entry and map', () => {
    const base = structuredClone(EMPTY_STATS);
    const one = applyEvents(base, [quiz(true, '2026-10-20T10:00:00.000Z')]);
    const two = applyEvents(one, [quiz(false, '2026-10-21T10:00:00.000Z')]);
    expect(undoGradedEvent(two, quiz(false, '2026-10-21T10:00:00.000Z')).indexRecent).toEqual(one.indexRecent);
    const back = undoGradedEvent(one, quiz(true, '2026-10-20T10:00:00.000Z'));
    expect('indexRecent' in back).toBe(false);
    expect(back).toEqual(base);
  });
});
