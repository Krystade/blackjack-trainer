import { describe, it, expect } from 'vitest';
import { orderDueCells } from './guidedStart';
import type { SrCard } from '../../../drills/spacedRepetition';

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
