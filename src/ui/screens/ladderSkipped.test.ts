import { describe, expect, it } from 'vitest';
import { generateAllCells } from '../../drills/flashcards';
import type { SrCard, SrDeck } from '../../drills/spacedRepetition';
import { ladder } from './nextStep';
import { DAY, NOW, ctxFor, stateAt } from './ladderFixtures';

const CELLS = generateAllCells().map((c) => c.id);
const card = (box: number, dueAt: number): SrCard => ({ box, dueAt, lastSeenAt: dueAt - DAY, lapses: 0, reviews: 3 });
const deckOf = (ids: readonly string[], c: SrCard): SrDeck => Object.fromEntries(ids.map((id) => [id, c]));

describe('ladder with welcome skips (1C)', () => {
  it('skipping basic and repair on a fresh install makes counting current, passing neither', () => {
    // A fresh install has no sweep on record, so repair is not met either.
    const l = ladder(stateAt(1), { sweepDone: false, now: NOW, skipped: ['basic', 'repair'] });
    expect(l.current).toBe(2);
    expect(l.step).toMatchObject({ card: 'rung', title: 'Practise counting' });
    expect(l.rungs.slice(0, 2).map((r) => [r.id, r.passed, r.skipped])).toEqual([
      ['basic', false, true],
      ['repair', false, true],
    ]);
    expect(l.rungs[2]!.skipped).toBeUndefined();
  });

  it('a skipped rung that is met reads passed, not skipped', () => {
    // Empty stats with a sweep on record: repair is met, basic is not.
    const met = ladder(stateAt(1), { ...ctxFor(1), skipped: ['basic', 'repair'] });
    expect(met.rungs.slice(0, 2).map((r) => [r.id, r.passed, r.skipped])).toEqual([
      ['basic', false, true],
      ['repair', true, undefined],
    ]);
    const l = ladder(stateAt(3), { ...ctxFor(3), skipped: ['basic', 'repair'] });
    expect(l.rungs[0]).toMatchObject({ passed: true });
    expect(l.rungs[0]!.skipped).toBeUndefined();
    expect(l.current).toBe(2);
  });

  it('no skips (absent or empty) is exactly today\'s ladder', () => {
    for (const r of [1, 2, 4]) {
      const today = ladder(stateAt(r), ctxFor(r));
      expect(ladder(stateAt(r), { ...ctxFor(r), skipped: [] })).toEqual(today);
      expect(today.rungs.some((x) => 'skipped' in x)).toBe(false);
    }
  });

  it('Review N due keys off the current rung after the skip', () => {
    const sr = deckOf(CELLS.slice(0, 20), card(2, NOW - DAY));
    const ctx = { ...ctxFor(1), flashSr: sr, quizSr: {} };
    expect(ladder(stateAt(1), ctx).step.card).toBe('rung');
    const l = ladder(stateAt(1), { ...ctx, skipped: ['basic', 'repair'] });
    expect(l.step).toMatchObject({ card: 'review', title: 'Review 20 due' });
    expect(l.current).toBe(2);
  });
});
