import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { capHistories, HISTORY_CAP } from './retention';
import { latencyRowsStart, rangedAccuracy } from './latencyRange';
import { EMPTY_STATS, type Stats } from './types';

/**
 * B6: a 30-day accuracy read 10-16 days of rows under a 30-day label once the
 * history cap started dropping rows. Dropped graded rows are folded into a
 * per-day count, and the range reads both.
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let saved: string | undefined;
beforeAll(() => {
  saved = env.TZ;
  env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (saved === undefined) delete env.TZ;
  else env.TZ = saved;
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-10-29T20:00:00Z');

/** 200 graded hard-total answers a day for `days` days, 3 in 4 right, oldest first. */
function practised(days: number): Stats {
  const s = structuredClone(EMPTY_STATS);
  for (let d = days - 1; d >= 0; d--) {
    for (let i = 0; i < 200; i++) {
      s.latencyHistory.push({ category: 'hard', elapsedMs: 900, date: new Date(NOW - d * DAY - (i + 1) * 60_000).toISOString(), correct: i % 4 !== 0 });
    }
  }
  return s;
}

describe('capHistories folds the latency rows it drops (B6)', () => {
  it('keeps the newest rows, and every dropped graded answer is still counted', () => {
    const capped = capHistories(practised(30));
    expect(capped.latencyHistory).toHaveLength(HISTORY_CAP);
    const daily = Object.values(capped.latencyDaily!).reduce((n, c) => n + (c.hard?.n ?? 0), 0);
    expect(daily + HISTORY_CAP).toBe(30 * 200);
  });

  it('Last 30 days counts all 30 days, not the newest 2000 rows', () => {
    const capped = capHistories(practised(30));
    const r = rangedAccuracy(capped, { id: '30d' }, NOW, 'hard');
    expect(r.total).toBe(6000);
    expect(r.right).toBe(4500);
    // Without the fold this read 2000.
    expect(rangedAccuracy({ ...capped, latencyDaily: undefined }, { id: '30d' }, NOW, 'hard').total).toBe(HISTORY_CAP);
  });

  it('a fold across several saves accumulates, and nothing is counted twice', () => {
    const once = capHistories(practised(20));
    const more = structuredClone(once);
    for (let i = 0; i < 500; i++) more.latencyHistory.push({ category: 'soft', elapsedMs: 800, date: new Date(NOW + 1000 + i).toISOString(), correct: true });
    const twice = capHistories(more);
    const r = rangedAccuracy(twice, { id: 'since', since: '2026-01-01' }, NOW + DAY);
    expect(r.total).toBe(20 * 200 + 500);
  });

  it('says where the kept rows start once the cap has dropped any', () => {
    expect(latencyRowsStart(practised(5))).toBeNull();
    const capped = capHistories(practised(30));
    expect(latencyRowsStart(capped)).toBe(capped.latencyHistory[0]!.date);
  });

  it('a range that starts inside the kept rows reads only rows, exactly', () => {
    const capped = capHistories(practised(30));
    expect(rangedAccuracy(capped, { id: '7d' }, NOW, 'hard').total).toBe(7 * 200);
  });
});

describe('index-only rows are not hand answers (C13, after B6)', () => {
  it('a category range skips them in the kept rows, and the cap does not fold them in', () => {
    const s = structuredClone(EMPTY_STATS);
    const at = (i: number) => new Date(NOW - (i + 1) * 60_000).toISOString();
    for (let i = 0; i < 10; i++) s.latencyHistory.push({ category: 'hard', elapsedMs: 900, date: at(i), correct: false });
    for (let i = 10; i < 30; i++) s.latencyHistory.push({ category: 'hard', elapsedMs: 900, date: at(i), correct: true, indexOnly: true });
    const range = { id: '30d' } as const;
    expect(rangedAccuracy(s, range, NOW, 'hard')).toEqual({ right: 0, total: 10 });
    // Overall accuracy keeps every graded answer, as before.
    expect(rangedAccuracy(s, range, NOW).total).toBe(30);
    // Pushed past the cap, oldest first: the dropped index rows are not folded into 'hard'.
    const big = structuredClone(EMPTY_STATS);
    for (let i = 0; i < HISTORY_CAP + 50; i++) {
      big.latencyHistory.push({ category: 'hard', elapsedMs: 900, date: new Date(NOW - (HISTORY_CAP + 50 - i) * 1000).toISOString(), correct: true, ...(i < 50 ? { indexOnly: true as const } : {}) });
    }
    const capped = capHistories(big);
    expect(Object.values(capped.latencyDaily ?? {}).reduce((n, d) => n + (d?.hard?.n ?? 0), 0)).toBe(0);
  });
});
