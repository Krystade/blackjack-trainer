import { describe, it, expect } from 'vitest';
import { msUntilNextLocalMidnight } from './useDayTick';

describe('H8: msUntilNextLocalMidnight', () => {
  it('is the time to 00:00 of the next local day', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 9, 18, 23, 55, 0, 0))).toBe(5 * 60 * 1000);
  });
  it('lands on a local midnight', () => {
    for (const d of [new Date(2026, 2, 8, 1, 30), new Date(2026, 10, 1, 1, 30), new Date(2026, 11, 31, 12, 0)]) {
      const at = new Date(d.getTime() + msUntilNextLocalMidnight(d));
      expect([at.getHours(), at.getMinutes(), at.getSeconds()]).toEqual([0, 0, 0]);
      expect(at.getDate()).not.toBe(d.getDate());
    }
  });
});
