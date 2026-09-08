import { describe, it, expect } from 'vitest';
import { summarizeSrDeck, boxBarPercents, DUE_SOON_MS, MOST_LAPSED_LIMIT, MIN_NONZERO_BAR_PCT } from './srStatus';
import type { SrCard, SrDeck } from './spacedRepetition';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_000_000_000_000; // an arbitrary fixed "now" base, matching spacedRepetition.test.ts's idiom

function card(overrides: Partial<SrCard>): SrCard {
  return { box: 0, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1, ...overrides };
}

describe('summarizeSrDeck: empty deck (D3 empty-state invariants)', () => {
  it('an empty deck reports everything unseen and nothing due/lapsed', () => {
    const s = summarizeSrDeck({}, 330, T0);
    expect(s.universeSize).toBe(330);
    expect(s.unseen).toBe(330);
    expect(s.byBox).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.dueNow).toBe(0);
    expect(s.dueSoon).toBe(0);
    expect(s.maxOverdueDays).toBeNull();
    expect(s.mostLapsed).toEqual([]);
    expect(s.moreLapsedCount).toBe(0);
  });
});

describe('summarizeSrDeck: byBox bucketing distinguishes "unseen" from "box 0"', () => {
  it('places one entry in each box 0..5 into the exact matching index, not just the right total', () => {
    // A bug that sums to the right TOTAL but misplaces one box (off-by-one
    // indexing) would pass a test that only checks the sum -- each index
    // must be asserted individually.
    const deck: SrDeck = {
      b0: card({ box: 0 }),
      b1: card({ box: 1 }),
      b2: card({ box: 2 }),
      b3: card({ box: 3 }),
      b4: card({ box: 4 }),
      b5: card({ box: 5 }),
    };
    const s = summarizeSrDeck(deck, 10, T0);
    expect(s.byBox).toEqual([1, 1, 1, 1, 1, 1]);
    // 10 possible keys, 6 reviewed -> 4 unseen. Box 0 (reviewed, reset-to-
    // zero-cost) must NOT be folded into "unseen" (never-reviewed) -- both
    // are "zero box" states but mean very different things to the operator.
    expect(s.unseen).toBe(4);
  });

  it('a reviewed item sitting in box 0 is counted in byBox[0], never in unseen', () => {
    const deck: SrDeck = { onlyOne: card({ box: 0 }) };
    const s = summarizeSrDeck(deck, 330, T0);
    expect(s.byBox[0]).toBe(1);
    expect(s.unseen).toBe(329);
  });
});

describe('summarizeSrDeck: dueNow / dueSoon boundaries', () => {
  it('a card exactly at its dueAt is dueNow (matches isDue\'s own now >= dueAt flip point)', () => {
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.dueNow).toBe(1);
    expect(s.dueSoon).toBe(0);
  });

  it('a card one ms before its dueAt is not yet due', () => {
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 + 1 }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.dueNow).toBe(0);
  });

  it('a card due within DUE_SOON_MS - 1 (not yet due) counts as dueSoon', () => {
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 + DUE_SOON_MS - 1 }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.dueNow).toBe(0);
    expect(s.dueSoon).toBe(1);
  });

  it('a card due at exactly DUE_SOON_MS out counts as dueSoon (inclusive boundary, deliberately pinned)', () => {
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 + DUE_SOON_MS }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.dueSoon).toBe(1);
  });

  it('a card due one ms beyond DUE_SOON_MS does not count as dueSoon', () => {
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 + DUE_SOON_MS + 1 }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.dueSoon).toBe(0);
    expect(s.dueNow).toBe(0);
  });
});

describe('summarizeSrDeck: maxOverdueDays', () => {
  it('computes a fractional overdue amount, not a truncated integer', () => {
    // 2.5 days overdue -- a Math.floor/round bug would silently produce 2,
    // which every whole-day-offset test would fail to catch.
    const deck: SrDeck = { k: card({ box: 3, dueAt: T0 }) };
    const s = summarizeSrDeck(deck, 1, T0 + 2.5 * DAY);
    expect(s.maxOverdueDays).toBeCloseTo(2.5, 10);
  });

  it('reports the largest overdue amount across multiple overdue cards', () => {
    const deck: SrDeck = {
      a: card({ box: 3, dueAt: T0 }),
      b: card({ box: 3, dueAt: T0 + 1 * DAY }),
    };
    const s = summarizeSrDeck(deck, 2, T0 + 3 * DAY);
    expect(s.maxOverdueDays).toBeCloseTo(3, 10); // card "a": (T0+3d - T0)/DAY = 3
  });

  it('is null when nothing in the deck is currently due', () => {
    const deck: SrDeck = { k: card({ box: 1, dueAt: T0 + DAY }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.maxOverdueDays).toBeNull();
  });
});

describe('summarizeSrDeck: mostLapsed ranking', () => {
  it('orders by lapses descending, breaking ties by key ascending', () => {
    const deck: SrDeck = {
      'z-key': card({ lapses: 3 }),
      'a-key': card({ lapses: 3 }), // ties with z-key on lapses -- key breaks the tie
      'm-key': card({ lapses: 5 }),
      'no-lapses': card({ lapses: 0 }),
    };
    const s = summarizeSrDeck(deck, 4, T0);
    expect(s.mostLapsed.map((e) => e.key)).toEqual(['m-key', 'a-key', 'z-key']);
  });

  it('excludes items with zero lapses entirely', () => {
    const deck: SrDeck = { a: card({ lapses: 0 }), b: card({ lapses: 1 }) };
    const s = summarizeSrDeck(deck, 2, T0);
    expect(s.mostLapsed.map((e) => e.key)).toEqual(['b']);
  });

  it('truncates to MOST_LAPSED_LIMIT and reports the correct moreLapsedCount', () => {
    // Exactly MOST_LAPSED_LIMIT entries could never distinguish "truncates
    // correctly" from "doesn't truncate at all" -- must exceed the limit.
    const deck: SrDeck = {};
    for (let i = 0; i < MOST_LAPSED_LIMIT + 2; i++) {
      deck[`k${i}`] = card({ lapses: i + 1 });
    }
    const s = summarizeSrDeck(deck, 20, T0);
    expect(s.mostLapsed.length).toBe(MOST_LAPSED_LIMIT);
    expect(s.moreLapsedCount).toBe(2);
    // Highest-lapse items must be the ones kept, not an arbitrary subset.
    expect(s.mostLapsed[0].lapses).toBe(MOST_LAPSED_LIMIT + 2);
  });

  it('carries box and reviews through on each lapsed entry', () => {
    const deck: SrDeck = { k: card({ lapses: 2, box: 1, reviews: 7 }) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.mostLapsed[0]).toEqual({ key: 'k', box: 1, lapses: 2, reviews: 7 });
  });
});

describe('summarizeSrDeck: defensive unseen floor', () => {
  it('never produces a negative unseen when the deck is larger than its declared universe', () => {
    // Simulates a stale/corrupt blob from a shrunk universe.
    const deck: SrDeck = { a: card({}), b: card({}), c: card({}) };
    const s = summarizeSrDeck(deck, 1, T0);
    expect(s.unseen).toBe(0);
  });
});

function deckFromByBox(byBox: number[]): SrDeck {
  const deck: SrDeck = {};
  byBox.forEach((count, box) => {
    for (let i = 0; i < count; i++) deck[`b${box}-${i}`] = card({ box });
  });
  return deck;
}

describe('boxBarPercents: bars scale against the box maximum, never against Unseen', () => {
  // Regression coverage for a real reported bug: scaling all seven bars
  // (six boxes + Unseen) against one shared maximum made the six-box
  // Leitner distribution -- the entire reason this panel exists -- render
  // as near-invisible slivers, because Unseen routinely dwarfs every box
  // count in a real deck. Asserting the counts are PRINTED (the e2e specs'
  // job) cannot catch this -- only a RATIO assertion on the actual
  // computed percentages can, which is why these live here as pure-module
  // tests rather than only as rendered-pixel checks in e2e.

  it('is completely unaffected by Unseen / universe size, given the same byBox', () => {
    const byBox = [2, 3, 0, 0, 0, 0];
    // Same box distribution, wildly different universe sizes -- mirrors
    // the reported case exactly (15 reviewed out of a 330-cell universe,
    // Unseen = 315). If Unseen ever leaked back into the scale, these two
    // would diverge.
    const small = summarizeSrDeck(deckFromByBox(byBox), 5, T0);
    const huge = summarizeSrDeck(deckFromByBox(byBox), 10_000, T0);
    expect(boxBarPercents(small.byBox)).toEqual(boxBarPercents(huge.byBox));
  });

  it('a box with several times another box\'s count renders several times taller', () => {
    // 1 item vs 5 items, no Unseen involved at all (boxBarPercents doesn't
    // even receive it) -- the exact shape of ratio the coordinator asked
    // to see pinned.
    const pct = boxBarPercents([1, 0, 0, 0, 0, 5]);
    expect(pct[5]).toBeCloseTo(100, 5);
    expect(pct[0]).toBeGreaterThanOrEqual(MIN_NONZERO_BAR_PCT);
    expect(pct[5] / pct[0]).toBeGreaterThan(3);
  });

  it('a lone single-item box stays visibly non-zero even next to a huge sibling box', () => {
    // The degenerate version of the same bug: a count of 1 rounding down
    // to (effectively) 0% next to a box of 300.
    const pct = boxBarPercents([1, 0, 0, 0, 0, 300]);
    expect(pct[0]).toBeGreaterThanOrEqual(MIN_NONZERO_BAR_PCT);
    expect(pct[0]).toBeGreaterThan(0);
    expect(pct[5]).toBeCloseTo(100, 5);
  });

  it('a genuinely empty box renders as exactly 0%, never floored up to look nonzero', () => {
    const pct = boxBarPercents([0, 4, 0, 0, 0, 0]);
    expect(pct[0]).toBe(0);
    expect(pct[2]).toBe(0);
    expect(pct[3]).toBe(0);
    expect(pct[4]).toBe(0);
  });

  it('the row\'s tallest box always reads as exactly 100%', () => {
    const pct = boxBarPercents([3, 7, 1, 0, 2, 7]);
    expect(Math.max(...pct)).toBe(100);
  });

  it('an all-zero row (defensive: should not occur once reviewed > 0) never divides by zero', () => {
    const pct = boxBarPercents([0, 0, 0, 0, 0, 0]);
    expect(pct).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('summarizeSrDeck: actually uses its now parameter', () => {
  it('dueNow changes when the same deck is summarized at two different now values crossing dueAt', () => {
    // The single most dangerous non-discriminating-test shape here: an
    // implementation that quietly reads Date.now() instead of its `now`
    // argument would still pass every fixed-T0 test above, because within
    // one fast test run Date.now() barely moves. Only comparing two
    // deliberately far-apart `now` values against the SAME deck can catch
    // that -- this must run the OUTPUT through a real change, not just call
    // the function once.
    const deck: SrDeck = { k: card({ box: 2, dueAt: T0 + 10 * DAY }) };
    const before = summarizeSrDeck(deck, 1, T0);
    const after = summarizeSrDeck(deck, 1, T0 + 20 * DAY);
    expect(before.dueNow).toBe(0);
    expect(after.dueNow).toBe(1);
    expect(before.dueNow).not.toBe(after.dueNow);
  });
});
