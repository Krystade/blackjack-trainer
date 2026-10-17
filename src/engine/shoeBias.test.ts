import { describe, it, expect } from 'vitest';
import { Shoe, RANKS, mulberry32, type Card } from './cards';
import { hiLoTag, trueCount } from './count';
import { hotShoeOrder, hotShoeActive } from './shoeBias';
import { Game, DEFAULT_SPREAD } from './game';

const SUITS = ['s', 'h', 'd', 'c'] as const;
const freshDeck = (decks: number): Card[] =>
  Array.from({ length: decks }).flatMap(() => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))));
const key = (c: Card) => `${c.rank}${c.suit}`;
const drawN = (s: { draw(): Card }, n: number) => Array.from({ length: n }, () => key(s.draw()));
type Order = (cards: Card[], rng: () => number) => Card[];

function tcShares(order: Order | undefined, decks: number, penetration: number, seeds = 200) {
  let n = 0, mid = 0, high = 0, low = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const shoe = new Shoe({ decks, penetration, seed, order });
    let rc = 0;
    while (!shoe.cutCardReached) {
      rc += hiLoTag(shoe.draw().rank);
      if (shoe.cardsDealt % 5 === 0) {
        const tc = trueCount(rc, shoe.decksRemaining);
        n++; if (tc >= 2 && tc <= 5) mid++; if (tc >= 6) high++; if (tc <= -2) low++;
      }
    }
  }
  return { mid: mid / n, high: high / n, low: low / n };
}

describe('hotShoeOrder keeps the shoe a legal set of cards (B8)', () => {
  it('is a permutation of exactly the cards it was given, for every seed, and leaves its input alone', () => {
    const deck = freshDeck(6);
    const before = deck.map(key);
    for (let seed = 1; seed <= 50; seed++) {
      const out = hotShoeOrder(deck, mulberry32(seed));
      expect(out).toHaveLength(312);
      expect(out.map(key).sort()).toEqual([...before].sort());
    }
    expect(deck.map(key)).toEqual(before);
  });
  it('a hot Shoe deals 24 of every rank per full 6-deck shoe, before and after shuffle()', () => {
    const shoe = new Shoe({ decks: 6, seed: 7, order: hotShoeOrder });
    for (let pass = 0; pass < 2; pass++) {
      const counts = new Map<string, number>();
      for (let i = 0; i < 312; i++) { const r = shoe.draw().rank; counts.set(r, (counts.get(r) ?? 0) + 1); }
      for (const r of RANKS) expect(counts.get(r)).toBe(24);
      shoe.shuffle();
    }
  });
});

describe('Hot shoe true-count distribution (fixed seeds 1..200)', () => {
  const normal6 = tcShares(undefined, 6, 0.75);
  const hot6 = tcShares(hotShoeOrder, 6, 0.75);
  it('a normal 6-deck shoe sits where a fair shoe does', () => {
    expect(normal6.mid).toBeGreaterThan(0.12);
    expect(normal6.mid).toBeLessThan(0.18);
    expect(normal6.high).toBeLessThan(0.03);
  });
  it('the hot shoe makes TC +2..+5 at least 1.5x as common, over 23% of points', () => {
    expect(hot6.mid).toBeGreaterThan(0.23);
    expect(hot6.mid).toBeGreaterThanOrEqual(1.5 * normal6.mid);
  });
  it('stays mild: TC +6 or more under 9%, negative counts still happen but less', () => {
    expect(hot6.high).toBeLessThan(0.09);
    expect(hot6.low).toBeGreaterThan(0.05);
    expect(hot6.low).toBeLessThan(normal6.low);
  });
  it('holds for 8 decks too', () => {
    expect(tcShares(hotShoeOrder, 8, 0.8).mid).toBeGreaterThanOrEqual(1.5 * tcShares(undefined, 8, 0.8).mid);
  });
});

describe('the normal shoe is unchanged (B8)', () => {
  const base = { penetration: 0.75, betSpreadOn: false, spread: DEFAULT_SPREAD, bankrollStart: 100, countCheckEvery: 0, seed: 42 };
  it('seed 42 deals the same first 12 cards as before Wave B', () => {
    expect(drawN(new Shoe({ decks: 6, seed: 42 }), 12)).toEqual(['5s', '4s', '9d', '10s', '5d', '2c', '6d', '9h', '3d', 'Ks', '3s', 'Js']);
  });
  it('a Game without hotShoe, or with it false, deals that same shoe', () => {
    const plain = drawN(new Shoe({ decks: 6, seed: 42 }), 40);
    expect(drawN(new Game(base).shoe, 40)).toEqual(plain);
    expect(drawN(new Game({ ...base, hotShoe: false }).shoe, 40)).toEqual(plain);
  });
  it('a Game with hotShoe deals the biased order for the same seed', () => {
    const hot = drawN(new Game({ ...base, hotShoe: true }).shoe, 40);
    expect(hot).toEqual(drawN(new Shoe({ decks: 6, seed: 42, order: hotShoeOrder }), 40));
    expect(hot).not.toEqual(drawN(new Shoe({ decks: 6, seed: 42 }), 40));
  });
  it('a rigged (Losing) shoe is never a hot shoe', () => {
    expect(hotShoeActive({ hotShoe: true }, false)).toBe(true);
    expect(hotShoeActive({ hotShoe: true }, true)).toBe(false);
    expect(hotShoeActive({}, false)).toBe(false);
  });
});
