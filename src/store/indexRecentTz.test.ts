import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isRecent } from './indexRecent';

/** B32: the 180-day mastery window ages a timed answer in local days. */
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

describe('isRecent in local days (B32)', () => {
  it('an answer at 18:00 PDT on 2 May is 180 local days old at 08:00 on 29 Oct, so out', () => {
    const answered = new Date(2026, 4, 2, 18).toISOString(); // 2026-05-03T01:00Z
    const now = new Date(2026, 9, 29, 8).getTime();
    expect(isRecent(answered, now, 180)).toBe(false);
    // The day before it is still in.
    expect(isRecent(new Date(2026, 4, 3, 18).toISOString(), now, 180)).toBe(true);
  });

  it('a bare day keeps its UTC reading', () => {
    const now = Date.parse('2026-10-21T12:00:00.000Z');
    expect(isRecent('2026-04-25', now, 180)).toBe(true);
    expect(isRecent('2026-04-24', now, 180)).toBe(false);
  });
});
