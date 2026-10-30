import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { computeStreak, effectiveToday, type DayRecord } from './progress';
import { streakNow } from './progressStore';

/** B34: after a flight west, the goal met "tomorrow" (by local day) still counts as today. */
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

const met: DayRecord = { answers: 60, activeMs: 600_000, met: true };
// Met the goal on the 28th and 29th in LA, then at 00:30 on the 30th in New York.
const days: Record<string, DayRecord> = { '2026-10-28': met, '2026-10-29': met, '2026-10-30': met };
// Home again: 22:00 PDT on the 29th.
const home = new Date(2026, 9, 29, 22).getTime();

describe('effectiveToday (B34)', () => {
  it('is the latest recorded day when that is one day ahead of the local day', () => {
    expect(effectiveToday(days, home)).toBe('2026-10-30');
  });

  it('the streak is 3, met today, not 0', () => {
    const s = streakNow({ days } as unknown as Parameters<typeof streakNow>[0], home);
    expect(s.current).toBe(3);
    expect(s.todayMet).toBe(true);
    // What the local day alone gave.
    expect(computeStreak(days, '2026-10-29').todayMet).toBe(true);
    expect(computeStreak(days, '2026-10-29').current).toBe(2);
    // A first goal ever, met in New York: was a streak of 0, not met.
    const first = streakNow({ days: { '2026-10-30': met } } as unknown as Parameters<typeof streakNow>[0], home);
    expect([first.current, first.todayMet]).toEqual([1, true]);
  });

  it('a key years ahead (a phone clock set wrong once) does not become today', () => {
    expect(effectiveToday({ ...days, '2031-01-01': met }, home)).toBe('2026-10-30');
    expect(effectiveToday({ '2026-10-31': met }, home)).toBe('2026-10-29');
  });

  it('is the local day when nothing is ahead', () => {
    expect(effectiveToday({ '2026-10-28': met }, home)).toBe('2026-10-29');
    expect(effectiveToday({}, home)).toBe('2026-10-29');
  });
});
