import { describe, expect, it } from 'vitest';
import { RANKS, mulberry32 } from '../cards';
import type { Card } from '../cards';
import { SUITS, fullComp, typeOf } from './comp';
import type { Comp } from './comp';
import { outcomeProbs, overUnderOdds } from './odds';
import { dealerBustDist } from './buster';
import { outcomeOf } from './settle';
import { OUTCOMES } from './payTables';
import type { Outcome, SideBetId } from './payTables';

/** The physical cards of a composition. */
function cardsOf(c: Comp): Card[] {
  const out: Card[] = [];
  for (let r = 0; r < 13; r++) for (let s = 0; s < 4; s++) for (let k = 0; k < c[r * 4 + s]!; k++) out.push({ rank: RANKS[r]!, suit: SUITS[s]! });
  return out;
}

/** A shoe with some cards gone at random: a composition no symmetry argument covers. */
function depleted(decks: number, remove: number, seed: number): Comp {
  const c = fullComp(decks);
  const rng = mulberry32(seed);
  let left = remove;
  while (left > 0) {
    const t = Math.floor(rng() * 52);
    if (c[t]! > 0) {
      c[t]! -= 1;
      left -= 1;
    }
  }
  return c;
}

/**
 * Brute force: every ordered deal of the first `k` cards from the physical
 * cards, settled by settle.ts, tallied. Ordered draws without replacement are
 * exactly what a shuffled shoe deals, so the tallies over all of them are
 * the probabilities, with nothing assumed.
 */
function enumerate(bet: SideBetId, c: Comp, k: 2 | 3 | 4): Map<Outcome | null, number> {
  const cards = cardsOf(c);
  const n = cards.length;
  const tally = new Map<Outcome | null, number>();
  const add = (o: Outcome | null) => tally.set(o, (tally.get(o) ?? 0) + 1);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const player: [Card, Card] = [cards[i]!, cards[j]!];
      if (k === 2) {
        add(outcomeOf(bet, { player, up: player[0], dealer: [] }));
        continue;
      }
      for (let u = 0; u < n; u++) {
        if (u === i || u === j) continue;
        if (k === 3) {
          add(outcomeOf(bet, { player, up: cards[u]!, dealer: [cards[u]!] }));
          continue;
        }
        for (let h = 0; h < n; h++) {
          if (h === i || h === j || h === u) continue;
          add(outcomeOf(bet, { player, up: cards[u]!, dealer: [cards[u]!, cards[h]!] }));
        }
      }
    }
  return tally;
}

function expectMatches(bet: SideBetId, c: Comp, k: 2 | 3 | 4) {
  const tally = enumerate(bet, c, k);
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const probs = outcomeProbs(bet, c);
  for (const o of OUTCOMES[bet] as readonly Outcome[]) {
    expect(probs[o] ?? 0, `${bet} ${o}`).toBeCloseTo((tally.get(o) ?? 0) / total, 12);
  }
}

describe('closed forms equal brute-force enumeration', () => {
  it('Lucky Ladies, a depleted double deck (dealer blackjack lines need four cards)', () => {
    // Small enough to deal every four-card sequence, and with queens of hearts in pairs.
    const c = new Int16Array(52);
    for (const t of [typeOf({ rank: 'Q', suit: 'h' }), typeOf({ rank: 'Q', suit: 's' })]) c[t] = 2;
    for (const t of [typeOf({ rank: 'Q', suit: 'd' }), typeOf({ rank: 'K', suit: 'h' }), typeOf({ rank: 'A', suit: 'c' }), typeOf({ rank: 'A', suit: 'h' })]) c[t] = 2;
    for (const t of [typeOf({ rank: '9', suit: 'c' }), typeOf({ rank: '5', suit: 'd' }), typeOf({ rank: 'J', suit: 'c' }), typeOf({ rank: '10', suit: 's' })]) c[t] = 2;
    expectMatches('luckyLadies', c, 4);
  });

  it('Lucky Ladies, one full deck', () => expectMatches('luckyLadies', fullComp(1), 4));
  it('21+3, one deck', () => expectMatches('twentyOnePlus3', fullComp(1), 3));
  it('21+3, a depleted double deck', () => expectMatches('twentyOnePlus3', depleted(2, 40, 7), 3));
  it('Perfect Pairs, a depleted double deck', () => expectMatches('perfectPairs', depleted(2, 30, 3), 2));
  it('Royal Match, a depleted double deck', () => expectMatches('royalMatch', depleted(2, 30, 5), 2));
  it('Over / Under 13, a depleted deck', () => {
    const c = depleted(1, 12, 9);
    expectMatches('over13', c, 2);
    expectMatches('under13', c, 2);
  });
});

describe('sanity', () => {
  it('probabilities sum to at most one, every outcome non-negative', () => {
    for (const bet of ['luckyLadies', 'twentyOnePlus3', 'perfectPairs', 'royalMatch', 'buster', 'over13'] as const) {
      for (const c of [fullComp(1), fullComp(6), depleted(6, 200, 11)]) {
        const p = outcomeProbs(bet, c);
        const sum = Object.values(p).reduce((a, b) => a + b, 0);
        expect(sum).toBeLessThanOrEqual(1 + 1e-12);
        for (const v of Object.values(p)) expect(v).toBeGreaterThanOrEqual(-1e-15);
      }
    }
  });

  it('over + under + exactly 13 is one', () => {
    for (const c of [fullComp(2), depleted(8, 300, 2)]) {
      const o = overUnderOdds(c);
      expect(o.over + o.under + o.thirteen).toBeCloseTo(1, 12);
    }
  });

  it('suits are symmetric: swapping two suits changes no suit-blind outcome', () => {
    const c = depleted(2, 37, 21);
    const swapped = new Int16Array(52);
    for (let r = 0; r < 13; r++) {
      swapped[r * 4] = c[r * 4 + 2]!;
      swapped[r * 4 + 2] = c[r * 4]!;
      swapped[r * 4 + 1] = c[r * 4 + 1]!;
      swapped[r * 4 + 3] = c[r * 4 + 3]!;
    }
    for (const bet of ['twentyOnePlus3', 'royalMatch', 'over13', 'buster'] as const) {
      const a = outcomeProbs(bet, c);
      const b = outcomeProbs(bet, swapped);
      for (const k of Object.keys(a) as Outcome[]) expect(b[k]).toBeCloseTo(a[k]!, 14);
    }
  });

  it("the dealer's bust distribution plus standing sums to one", () => {
    const vc = [0, 24, 24, 24, 24, 24, 24, 24, 24, 24, 96];
    for (const s17 of [true, false]) {
      const d = dealerBustDist(vc, s17);
      expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      // Two cards cannot bust.
      expect(d[1]).toBe(0);
      expect(d[2]).toBe(0);
    }
  });

  it("Buster against real dealer hands: a brute-force deal of a short shoe's dealer draws", () => {
    // A 20-card shoe, every ordered dealer sequence played to its end.
    const c = depleted(1, 32, 4);
    const cards = cardsOf(c);
    const s17 = false;
    const tally = new Map<number, number>();
    let total = 0;
    const play = (hand: number[], used: boolean[], w: number) => {
      let hard = 0;
      let aces = 0;
      for (const i of hand) {
        const v = cards[i]!.rank === 'A' ? 1 : Math.min(10, RANKS.indexOf(cards[i]!.rank) + 1);
        hard += v;
        if (v === 1) aces += 1;
      }
      const soft = aces > 0 && hard + 10 <= 21;
      const t = soft ? hard + 10 : hard;
      if (hand.length >= 2 && (hard > 21 || t > 17 || (t === 17 && (s17 || !soft)))) {
        const k = hard > 21 ? hand.length : 0;
        tally.set(k, (tally.get(k) ?? 0) + w);
        total += w;
        return;
      }
      const free = used.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
      for (const i of free) {
        used[i] = true;
        play([...hand, i], used, w / free.length);
        used[i] = false;
      }
    };
    play([], cards.map(() => false), 1);
    const vc = new Array<number>(11).fill(0);
    for (const card of cards) vc[card.rank === 'A' ? 1 : Math.min(10, RANKS.indexOf(card.rank) + 1)]! += 1;
    const d = dealerBustDist(vc, s17);
    for (let k = 0; k < d.length; k++) expect(d[k]).toBeCloseTo((tally.get(k) ?? 0) / total, 10);
  });
});
