import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { filterByRange, rangeStart } from './timeRange';

/**
 * B11/B18: "Since <date>" starts at LOCAL midnight. Pinned to Los Angeles,
 * where Date.parse('YYYY-MM-DD') (UTC midnight) is 17:00 the evening before.
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

const NOW = Date.parse('2026-10-29T15:00:00Z');

describe('since, in a US time zone', () => {
  it('starts at local midnight', () => {
    expect(rangeStart({ id: 'since', since: '2026-10-28' }, NOW)).toBe(Date.parse('2026-10-28T07:00:00Z'));
  });

  it("leaves out the previous evening's drive", () => {
    const rows = [
      { date: '2026-10-28T02:30:00.000Z', tag: 'Oct 27, 19:30 PDT' },
      { date: '2026-10-28T07:30:00.000Z', tag: 'Oct 28, 00:30 PDT' },
      { date: '2026-10-29T01:00:00.000Z', tag: 'Oct 28, 18:00 PDT' },
    ];
    expect(filterByRange(rows, { id: 'since', since: '2026-10-28' }, NOW).map((r) => r.tag)).toEqual([
      'Oct 28, 00:30 PDT',
      'Oct 28, 18:00 PDT',
    ]);
  });

  it('keeps a date-only row on the day itself', () => {
    const rows = [{ date: '2026-10-27' }, { date: '2026-10-28' }];
    expect(filterByRange(rows, { id: 'since', since: '2026-10-28' }, NOW)).toEqual([{ date: '2026-10-28' }]);
  });

  it('is DST-safe across the November change', () => {
    expect(new Date(rangeStart({ id: 'since', since: '2026-11-02' }, NOW)!).getHours()).toBe(0);
  });

  it('refuses an impossible day rather than rolling it over', () => {
    expect(rangeStart({ id: 'since', since: '2026-02-31' }, NOW)).toBeNull();
  });
});
