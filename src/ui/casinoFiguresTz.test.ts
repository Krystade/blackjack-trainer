import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { addMonths, burnSuggestion, daysBetween, lastVisitText, localDateKey, sessionHours, standing } from './casinoFigures';
import type { CasinoSession } from '../store/casinoLog';

/**
 * Review N8: the Casino tab's date maths pinned to a timezone with DST
 * (Las Vegas), across both changes, rather than whatever zone the machine
 * running the suite is in. Node re-reads TZ when it is assigned; the original
 * is put back so later files in this worker are unaffected.
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

const session = (start: Date, end: Date | null): CasinoSession => ({
  id: 's',
  casinoId: 'c',
  start: start.toISOString(),
  end: end ? end.toISOString() : null,
  buyIns: [],
  cashOut: null,
  heat: 'none',
  notes: '',
  createdAt: start.toISOString(),
  updatedAt: start.toISOString(),
});

describe('in Las Vegas time', () => {
  it('really is running in Pacific time (so the rest is not vacuous)', () => {
    // PDT is UTC-7 (420 min) in July, PST UTC-8 (480) in December.
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(420);
    expect(new Date(2026, 11, 1).getTimezoneOffset()).toBe(480);
  });

  it('a late-night session over the November fall-back is its true length', () => {
    // 1 Nov 2026: 2am PDT falls back to 1am PST. 11pm to 3am local is five hours.
    const h = sessionHours(session(new Date(2026, 9, 31, 23, 0), new Date(2026, 10, 1, 3, 0)), 0);
    expect(h).toBe(5);
  });

  it('a back-off at 11pm on 31 Aug cools off until the end of February, local', () => {
    const at = new Date(2026, 7, 31, 23, 30);
    expect(localDateKey(at)).toBe('2026-08-31');
    expect(burnSuggestion('back-off', localDateKey(at))).toEqual({ until: '2027-02-28' });
    expect(addMonths('2026-09-30', 6)).toBe('2027-03-30'); // across the March spring-forward
  });

  it('a burn ends on its local date, not at UTC midnight', () => {
    // 4pm PDT on 17 Oct is already 18 Oct in UTC.
    const c = { status: 'burned' as const, burnedUntil: '2026-10-18' };
    expect(standing(c, new Date(2026, 9, 17, 16, 0).getTime()).group).toBe('burned');
    expect(standing(c, new Date(2026, 9, 18, 0, 5).getTime())).toEqual({ group: 'playable', coolOffOver: true });
  });

  it('last visit counts calendar days across a DST change', () => {
    const visited = session(new Date(2026, 9, 31, 22, 0), null);
    expect(lastVisitText([visited], new Date(2026, 10, 1, 9, 0).getTime())).toBe('yesterday');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });
});
