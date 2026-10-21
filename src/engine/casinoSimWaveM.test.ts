import { describe, it, expect } from 'vitest';
import { CasinoSim, type SimSpec } from './casinoSim';
import { DEFAULT_SPREAD } from './game';
import type { StrategyRules } from './ruleset';
import type { Card } from './cards';

/**
 * Wave M: the rules the owner's real games carry -- RSA, doubling split aces,
 * the split cap, double-on and card-room commission -- as the simulator plays
 * them. Each is checked by what the dealt hands show, on rounds that are the
 * same cards with and without the rule wherever that is possible.
 */

const H17_6D: StrategyRules = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };

function spec(over: Partial<SimSpec> = {}): SimSpec {
  return {
    rules: H17_6D,
    cutDecks: 1,
    csm: false,
    unit: 10,
    maxBet: null,
    spread: DEFAULT_SPREAD,
    tcRounding: 'floor',
    indices: false,
    methods: [],
    ...over,
  };
}

type Hands = readonly { cards: readonly Card[]; doubled: boolean; splitAces: boolean; origin: number }[];

function rounds(s: SimSpec, n: number, seed = 7): Hands[] {
  const sim = new CasinoSim(s, 'basic', seed);
  const out: Hands[] = [];
  sim.onHands = (h) => out.push(h.map((x) => ({ ...x, cards: [...x.cards] })));
  sim.run(n);
  return out;
}

const value = (c: Card) => (c.rank === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(c.rank) ? 10 : Number(c.rank));

describe('casino simulator, Wave M rules', () => {
  it('commission: the same cards, every hand charged fee% of its bet', () => {
    const plain = new CasinoSim(spec(), 'basic', 11);
    const fee = new CasinoSim(spec({ commissionPct: 1 }), 'basic', 11);
    plain.run(20_000);
    fee.run(20_000);
    // Commission never changes a play, so the cards and results are identical;
    // the only difference is $0.10 (1% of the $10 unit) on each of 20,000 hands.
    expect(plain.basic.net - fee.basic.net).toBeCloseTo(20_000 * 0.1, 6);
  });

  it('the split cap: never more hands from one original than allowed', () => {
    const most = (s: SimSpec) => Math.max(...rounds(s, 60_000).map((h) => h.length));
    expect(most(spec())).toBeGreaterThanOrEqual(3);
    expect(most(spec({ maxSplitHands: 2 }))).toBe(2);
    expect(most(spec({ maxSplitHands: 3 }))).toBe(3);
  });

  it('double on 10-11: every doubled hand started at 10 or 11; any two doubles soft hands', () => {
    const firstTwo = (h: Hands[number]) => value(h.cards[0]!) + value(h.cards[1]!);
    const doubled = (s: SimSpec) => rounds(s, 40_000).flat().filter((h) => h.doubled);
    const restricted = doubled(spec({ doubleOn: '10-11' }));
    expect(restricted.length).toBeGreaterThan(100);
    for (const h of restricted) expect([10, 11]).toContain(firstTwo(h) === 22 ? 12 : firstTwo(h));
    const nine = doubled(spec({ doubleOn: '9-11' }));
    expect(nine.some((h) => firstTwo(h) === 9)).toBe(true);
    expect(doubled(spec()).some((h) => h.cards.some((c) => c.rank === 'A') && !h.splitAces)).toBe(true);
  });

  it('RSA: aces are resplit only when the rules allow it', () => {
    const resplit = (s: SimSpec) => rounds(s, 200_000).some((h) => h.filter((x) => x.splitAces).length > 2);
    expect(resplit(spec())).toBe(false);
    expect(resplit(spec({ rules: { ...H17_6D, rsa: true } }))).toBe(true);
  });

  it('doubling split aces: only with the rule, and a split ace never takes a third card otherwise', () => {
    const aceHands = (s: SimSpec) => rounds(s, 200_000).flat().filter((h) => h.splitAces);
    const off = aceHands(spec());
    expect(off.length).toBeGreaterThan(50);
    expect(off.every((h) => !h.doubled && h.cards.length === 2)).toBe(true);
    const on = aceHands(spec({ doubleSplitAces: true }));
    expect(on.some((h) => h.doubled && h.cards.length === 3)).toBe(true);
    // Never hit: a third card only ever comes with a double.
    expect(on.every((h) => h.cards.length === 2 || (h.doubled && h.cards.length === 3))).toBe(true);
  });

  it('a 4- and a 5-deck shoe deal that many decks', () => {
    for (const decks of [4, 5]) {
      const seen = new Map<string, number>();
      const sim = new CasinoSim(spec({ shoeDecks: decks, cutDecks: 0.5 }), 'basic', 3);
      const cards = sim.peekCards(decks * 52 + 10);
      expect(cards.length).toBe(decks * 52);
      for (const c of cards) seen.set(c.rank + c.suit, (seen.get(c.rank + c.suit) ?? 0) + 1);
      expect([...seen.values()].every((v) => v === decks)).toBe(true);
    }
  });

  it('house edge moves the way the rules say (same seed, 2M rounds)', () => {
    const edge = (s: SimSpec) => {
      const sim = new CasinoSim(s, 'basic', 5);
      sim.run(2_000_000);
      return -sim.basic.net / sim.basic.wagered;
    };
    const base = edge(spec());
    // Commission is exact: +1.00% of every bet.
    expect(edge(spec({ commissionPct: 1 })) - base).toBeCloseTo(0.01, 6);
    // Restricting doubles and splits costs the player; far beyond the noise at 2M rounds.
    expect(edge(spec({ doubleOn: '10-11' }))).toBeGreaterThan(base);
  }, 60_000);
});
