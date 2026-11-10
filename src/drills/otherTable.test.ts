import { describe, expect, it } from 'vitest';
import { makeOtherTable, otherTableCards, otherTableCount, OTHER_TABLE_EXPERT_MS } from './otherTable';
import { hiLoTag } from '../engine/count';
import { rankValue, type Card } from '../engine/cards';

const SEEDS = Array.from({ length: 300 }, (_, i) => (i * 2654435761) >>> 0);

function total(cards: readonly Card[]): number {
  let t = cards.reduce((n, c) => n + rankValue(c.rank), 0);
  let aces = cards.filter((c) => c.rank === 'A').length;
  while (t > 21 && aces-- > 0) t -= 10;
  return t;
}

describe('the other table (owner 2026-11-10)', () => {
  it('Easy: 3 players, 2 cards each; Normal: 6 players, 2 cards each; neither hides', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const easy = makeOtherTable(seed, 'easy');
      expect(easy.seats.map((s) => s.length)).toEqual([2, 2, 2]);
      expect(easy.hideAfterMs).toBeUndefined();
      const normal = makeOtherTable(seed, 'normal');
      expect(normal.seats.map((s) => s.length)).toEqual([2, 2, 2, 2, 2, 2]);
      expect(normal.hideAfterMs).toBeUndefined();
    }
  });

  it('Hard: 6 players, hands of 2 to 4 cards, at least one hit on every table, played like a table', () => {
    const lengths = new Set<number>();
    for (const seed of SEEDS) {
      const t = makeOtherTable(seed, 'hard');
      expect(t.seats).toHaveLength(6);
      expect(t.hideAfterMs).toBeUndefined();
      for (const s of t.seats) {
        expect(s.length).toBeGreaterThanOrEqual(2);
        expect(s.length).toBeLessThanOrEqual(4);
        lengths.add(s.length);
        // Never hit a 17 or more: every card past the second was taken under 17.
        for (let k = 3; k <= s.length; k++) expect(total(s.slice(0, k - 1))).toBeLessThan(17);
      }
      expect(t.seats.some((s) => s.length > 2), `seed ${seed}`).toBe(true);
    }
    expect([...lengths].sort()).toEqual([2, 3, 4]);
  });

  it('Expert: the Hard table, turned over after 5 seconds', () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const ex = makeOtherTable(seed, 'expert');
      const hard = makeOtherTable(seed, 'hard');
      expect(ex.hideAfterMs).toBe(OTHER_TABLE_EXPERT_MS);
      expect(OTHER_TABLE_EXPERT_MS).toBe(5000);
      expect({ dealer: ex.dealer, seats: ex.seats }).toEqual({ dealer: hard.dealer, seats: hard.seats });
    }
  });

  it('the count is the Hi-Lo sum of every card shown (seats and the up-card), and it varies', () => {
    const counts = new Set<number>();
    for (const seed of SEEDS) {
      for (const d of ['easy', 'normal', 'hard'] as const) {
        const t = makeOtherTable(seed, d);
        const cards = otherTableCards(t);
        expect(cards).toHaveLength(t.seats.reduce((n, s) => n + s.length, 0) + 1);
        expect(cards.at(-1)).toBe(t.dealer);
        let rc = 0;
        for (const c of cards) rc += hiLoTag(c.rank);
        expect(otherTableCount(t)).toBe(rc);
        counts.add(rc);
      }
    }
    // A fixed or always-zero count would not be a count to keep.
    expect(counts.size).toBeGreaterThan(8);
    expect([...counts].some((c) => c < 0)).toBe(true);
    expect([...counts].some((c) => c > 0)).toBe(true);
  });

  it('seeded: one seed deals one table; different seeds deal different tables', () => {
    expect(makeOtherTable(42, 'hard')).toEqual(makeOtherTable(42, 'hard'));
    expect(makeOtherTable(42, 'normal')).not.toEqual(makeOtherTable(43, 'normal'));
  });

  it('a six-deck shoe: no card shows more than six times on one table', () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const seen = new Map<string, number>();
      for (const c of otherTableCards(makeOtherTable(seed, 'hard'))) {
        const k = c.rank + c.suit;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      expect(Math.max(...seen.values())).toBeLessThanOrEqual(6);
    }
  });
});
