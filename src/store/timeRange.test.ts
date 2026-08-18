import { describe, it, expect } from 'vitest';
import { rangeStart, filterByRange } from './timeRange';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (daysAgo: number) => ({ date: new Date(NOW - daysAgo * DAY).toISOString() });

describe('rangeStart', () => {
  it('is unbounded for all time', () => {
    expect(rangeStart({ id: 'all' }, NOW)).toBeNull();
  });

  it('counts back the right number of days', () => {
    expect(rangeStart({ id: '7d' }, NOW)).toBe(NOW - 7 * DAY);
    expect(rangeStart({ id: '30d' }, NOW)).toBe(NOW - 30 * DAY);
  });

  it('parses an explicit since date', () => {
    expect(rangeStart({ id: 'since', since: '2026-08-01' }, NOW)).toBe(Date.parse('2026-08-01'));
  });

  it('is unbounded for a half-typed since date, showing everything not nothing', () => {
    expect(rangeStart({ id: 'since', since: '2026-08-' }, NOW)).toBeNull();
    expect(rangeStart({ id: 'since' }, NOW)).toBeNull();
  });
});

describe('filterByRange', () => {
  const entries = [at(1), at(10), at(60), at(200)];

  it('returns everything for all time', () => {
    expect(filterByRange(entries, { id: 'all' }, NOW)).toHaveLength(4);
  });

  it('keeps only entries inside the window', () => {
    expect(filterByRange(entries, { id: '7d' }, NOW)).toHaveLength(1);
    expect(filterByRange(entries, { id: '30d' }, NOW)).toHaveLength(2);
    expect(filterByRange(entries, { id: '90d' }, NOW)).toHaveLength(3);
  });

  it('includes an entry exactly on the boundary', () => {
    expect(filterByRange([at(7)], { id: '7d' }, NOW)).toHaveLength(1);
  });

  it('keeps undated entries on all time but not in a bounded range', () => {
    // They predate the date field; dropping them from lifetime totals would
    // silently shrink numbers the user has already seen.
    const mixed = [{ date: undefined }, at(1)];
    expect(filterByRange(mixed, { id: 'all' }, NOW)).toHaveLength(2);
    expect(filterByRange(mixed, { id: '7d' }, NOW)).toHaveLength(1);
  });

  it('drops an unparseable date from a bounded range without throwing', () => {
    expect(() => filterByRange([{ date: 'not-a-date' }], { id: '7d' }, NOW)).not.toThrow();
    expect(filterByRange([{ date: 'not-a-date' }], { id: '7d' }, NOW)).toHaveLength(0);
  });

  it('does not mutate the input', () => {
    const src = [at(1), at(100)];
    filterByRange(src, { id: '7d' }, NOW);
    expect(src).toHaveLength(2);
  });
});
