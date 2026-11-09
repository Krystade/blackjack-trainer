import { describe, it, expect } from 'vitest';
import { orderDueCells, planInputFor } from './guidedStart';
import type { SrCard } from '../../../drills/spacedRepetition';
import type { Ladder } from '../nextStep';
import { EMPTY_STATS } from '../../../store/types';
import { makeDefaultProfile } from '../../../store/profiles';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const card = (box: number, overdueDays: number, lapses = 0): SrCard => ({
  box,
  dueAt: NOW - overdueDays * DAY,
  lastSeenAt: NOW - (overdueDays + 1) * DAY,
  lapses,
  reviews: 3,
});

// C7 (audit 2026-10-29): due cells came in id order, so the warm-up always
// opened on 'hard-10-…' whatever was most overdue.
describe('orderDueCells (C7)', () => {
  it('puts the most-needed cell first, not the alphabetically first', () => {
    const sr = { 'hard-10-v-2': card(3, 0), 'soft-18-v-9': card(3, 6), 'pair-8-v-10': card(3, 2) };
    expect(orderDueCells(Object.keys(sr).sort(), sr, NOW)).toEqual(['soft-18-v-9', 'pair-8-v-10', 'hard-10-v-2']);
  });

  it('ties fall back to id order, so the plan is deterministic', () => {
    const sr = { b: card(2, 1), a: card(2, 1) };
    expect(orderDueCells(['b', 'a'], sr, NOW)).toEqual(['a', 'b']);
  });
});

// Track 1 (D1): what the plan reads as reached comes from the ladder rung by
// rung -- passed, skipped, or at or before the current rung.
describe('planInputFor: reached rungs (D1)', () => {
  const ORDER = ['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play'] as const;
  const ladderOf = (passed: readonly string[], skipped: readonly string[] = []): Ladder => {
    const rungs = ORDER.map((id) => ({
      id,
      label: id,
      passed: passed.includes(id),
      ...(skipped.includes(id) ? { skipped: true } : {}),
      progress: '',
      start: { kind: 'flash' as const },
    }));
    const first = rungs.findIndex((r) => !r.passed && !r.skipped);
    return { rungs, current: first === -1 ? null : first, step: { card: 'rung', kind: 'flash', title: '', why: '' } };
  };
  const reachedOf = (lad: Ladder) => planInputFor(structuredClone(EMPTY_STATS), makeDefaultProfile(), NOW, lad);

  it('a passed rung above the current one is reached (Jack after the count rung fell back)', () => {
    const inp = reachedOf(ladderOf(['basic', 'repair', 'tc', 'deviations', 'betramp']));
    expect(inp.currentRung).toBe('count');
    expect(inp.rungsReached).toEqual({ basic: true, repair: true, count: true, tc: true, deviations: true, betramp: true });
    expect(inp.rungsPassed.count).toBe(false);
  });

  it('a new user has reached basic only', () => {
    const inp = reachedOf(ladderOf([]));
    expect(inp.currentRung).toBe('basic');
    expect(inp.rungsReached).toEqual({ basic: true, repair: false, count: false, tc: false, deviations: false, betramp: false });
  });

  it('a skipped rung is reached and carried as skipped; every rung done reads null', () => {
    const inp = reachedOf(ladderOf([], ['basic', 'repair']));
    expect(inp.currentRung).toBe('count');
    expect(inp.rungsSkipped).toEqual({ basic: true, repair: true });
    expect(inp.rungsReached?.count).toBe(true);
    expect(inp.rungsReached?.tc).toBe(false);
    expect(reachedOf(ladderOf([...ORDER])).currentRung).toBeNull();
  });
});

// Track 3 (3B, D1): a rusty rung is reached, still passed, and planned as weak.
describe('planInputFor: rusty rungs (3B)', () => {
  it('carries a rusty rung as rusty, passed and reached', () => {
    const ORDER = ['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play'] as const;
    const lad: Ladder = {
      rungs: ORDER.map((id) => ({ id, label: id, passed: true, ...(id === 'count' ? { rust: 'rusty' as const } : {}), progress: '', start: { kind: 'flash' as const } })),
      current: null,
      step: { card: 'retest', kind: 'count', title: '', why: '' },
    };
    const inp = planInputFor(structuredClone(EMPTY_STATS), makeDefaultProfile(), NOW, lad);
    expect(inp.rungsRusty).toEqual({ count: true });
    expect(inp.rungsPassed.count).toBe(true);
    expect(inp.rungsReached?.count).toBe(true);
  });
});
