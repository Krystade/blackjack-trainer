import { describe, expect, it } from 'vitest';
import { discardTicks } from './discardTicks';

describe('discardTicks (#38)', () => {
  it('marks every whole deck of a six-deck shoe, labelled decks dealt', () => {
    expect(discardTicks(6)).toEqual([1, 2, 3, 4, 5].map((k) => ({ decksDealt: k, pct: (k / 6) * 100 })));
  });

  it('puts the two-deck mark at the halfway point', () => {
    expect(discardTicks(2)).toEqual([{ decksDealt: 1, pct: 50 }]);
  });

  it('has no marks for a single deck: the ends are the tray edges', () => {
    expect(discardTicks(1)).toEqual([]);
  });

  it('marks eight decks seven times, evenly spaced', () => {
    const t = discardTicks(8);
    expect(t.map((x) => x.decksDealt)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t[3].pct).toBe(50);
  });
});
