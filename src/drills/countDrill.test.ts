import { describe, it, expect } from 'vitest';
import type { Card, Rank } from '../engine/cards';
import { hiLoTag } from '../engine/count';
import { runningCountThrough, makeCountDrill } from './countDrill';

/** Builds a minimal Card for a given rank -- suit is irrelevant to hiLoTag. */
function card(rank: Rank): Card {
  return { rank, suit: 's' };
}

describe('runningCountThrough', () => {
  it('sums hiLoTag over every card in groups[0..uptoIndex] inclusive', () => {
    // group 0: 2,3 (+1,+1) -- group 1: K (-1) -- group 2: 7 (0)
    const groups: Card[][] = [[card('2'), card('3')], [card('K')], [card('7')]];
    expect(runningCountThrough(groups, 0)).toBe(2); // just group 0
    expect(runningCountThrough(groups, 1)).toBe(1); // groups 0+1
    expect(runningCountThrough(groups, 2)).toBe(1); // groups 0+1+2 (+0 from the 7)
  });

  it('matches a plain reduce over the same cards (anti-drift against hiLoTag)', () => {
    const groups: Card[][] = [
      [card('A'), card('5')],
      [card('9')],
      [card('10'), card('4'), card('Q')],
    ];
    for (let upto = 0; upto < groups.length; upto++) {
      const expected = groups
        .slice(0, upto + 1)
        .flat()
        .reduce((sum, c) => sum + hiLoTag(c.rank), 0);
      expect(runningCountThrough(groups, upto)).toBe(expected);
    }
  });

  it('is 0 for an index before any cards (uptoIndex -1, an empty sum)', () => {
    const groups: Card[][] = [[card('K')]];
    expect(runningCountThrough(groups, -1)).toBe(0);
  });

  it('clamps safely when uptoIndex is beyond the groups array (never throws, sums what exists)', () => {
    const groups: Card[][] = [[card('2')], [card('3')]];
    expect(runningCountThrough(groups, 10)).toBe(2);
  });

  it('is 0 for an empty groups array regardless of uptoIndex', () => {
    expect(runningCountThrough([], 5)).toBe(0);
  });
});

describe('makeCountDrill bias (R8/CM#1; Wave X item 6: a lean, not a sort)', () => {
  type Bias = 'none' | 'negative' | 'positive';
  const tagsOf = (round: { groups: Card[][] }) => round.groups.flat().map((c) => hiLoTag(c.rank));
  const tags = (n: number, seed: number, bias: Bias) => tagsOf(makeCountDrill(n, 1, seed, bias));
  /** Longest stretch of consecutive cards with the same Hi-Lo tag. */
  const maxRun = (t: number[]) => {
    let best = 0;
    let run = 0;
    t.forEach((x, i) => {
      run = i > 0 && t[i - 1] === x ? run + 1 : 1;
      best = Math.max(best, run);
    });
    return best;
  };
  const RUNS = 1500;
  const seeds = Array.from({ length: RUNS }, (_, i) => i + 1);

  it("bias 'none' is unchanged: deterministic for a seed, and omitting it is 'none'", () => {
    const a = makeCountDrill(52, 1, 7);
    const b = makeCountDrill(52, 1, 7, 'none');
    expect(tagsOf(b)).toEqual(tagsOf(a));
  });

  it('a biased run is deterministic for a seed', () => {
    for (const bias of ['negative', 'positive'] as const) {
      expect(tags(52, 11, bias)).toEqual(tags(52, 11, bias));
    }
  });

  for (const n of [20, 52, 104]) {
    it(`the end count is up, down or level about a third of the time each (${n} cards)`, () => {
      for (const bias of ['negative', 'positive'] as const) {
        const signs = { '-1': 0, '0': 0, '1': 0 };
        for (const seed of seeds) {
          const r = makeCountDrill(n, 1, seed, bias);
          expect(r.finalRc).toBe(tagsOf(r).reduce<number>((x, y) => x + y, 0));
          signs[String(Math.sign(r.finalRc)) as keyof typeof signs] += 1;
        }
        // Three standard errors of a 1/3 share over 1500 runs is 0.037.
        for (const share of Object.values(signs)) expect(Math.abs(share / RUNS - 1 / 3), JSON.stringify(signs)).toBeLessThan(0.04);
      }
    });
  }

  for (const n of [52, 104]) {
    it(`a biased end count is as big as an unbiased one of the same sign, not pulled to 0 or ±1 (${n} cards)`, () => {
      // Reference: unbiased runs, split by the sign they end on.
      const plain = seeds.map((seed) => makeCountDrill(n, 1, seed).finalRc);
      const up = plain.filter((x) => x > 0);
      const down = plain.filter((x) => x < 0);
      const share = (xs: number[], v: number) => xs.filter((x) => x === v).length / xs.length;
      const meanAbs = (xs: number[]) => xs.reduce((s, x) => s + Math.abs(x), 0) / xs.length;
      // A biased run ends up, down or level a third of the time each; level
      // is |0| <= 1 always, up is +1 as often as an unbiased up-run is.
      const expectedNear = (share(down, -1) + 1 + share(up, 1)) / 3;
      for (const bias of ['negative', 'positive'] as const) {
        const finals = seeds.map((seed) => makeCountDrill(n, 1, seed, bias).finalRc);
        const near = finals.filter((x) => Math.abs(x) <= 1).length / RUNS;
        expect(Math.abs(near - expectedNear), `${bias}: P(|end| <= 1) ${near.toFixed(3)} vs ${expectedNear.toFixed(3)}`).toBeLessThan(0.06);
        const bUp = finals.filter((x) => x > 0);
        const bDown = finals.filter((x) => x < 0);
        expect(Math.abs(meanAbs(bUp) - meanAbs(up)), `${bias} up: ${meanAbs(bUp).toFixed(2)} vs ${meanAbs(up).toFixed(2)}`).toBeLessThan(0.6);
        expect(Math.abs(meanAbs(bDown) - meanAbs(down)), `${bias} down: ${meanAbs(bDown).toFixed(2)} vs ${meanAbs(down).toFixed(2)}`).toBeLessThan(0.6);
      }
    });
  }

  it("an unbiased slice ends level far less than a third of the time, so the sign draw is the bias's doing", () => {
    const level = seeds.filter((seed) => makeCountDrill(52, 1, seed).finalRc === 0).length;
    expect(level / RUNS).toBeLessThan(0.2);
  });

  it('never a sorted block: same-tag runs stay close to an unbiased shuffle', () => {
    for (const n of [52, 104]) {
      const mean = (bias: Bias) => seeds.reduce((s, seed) => s + maxRun(tags(n, seed, bias)), 0) / RUNS;
      const worst = (bias: Bias) => Math.max(...seeds.map((seed) => maxRun(tags(n, seed, bias))));
      const plain = mean('none');
      for (const bias of ['negative', 'positive'] as const) {
        expect(mean(bias), `${bias} ${n}`).toBeLessThan(plain + 1);
        expect(worst(bias), `${bias} ${n}`).toBeLessThanOrEqual(worst('none') + 4);
      }
    }
  });

  it('the biased tag leans to the front half on average, and the count with it', () => {
    for (const [bias, tag] of [['negative', -1], ['positive', 1]] as const) {
      let lean = 0;
      let midRc = 0;
      for (const seed of seeds) {
        const t = tags(52, seed, bias);
        lean += t.slice(0, 26).filter((x) => x === tag).length - t.slice(26).filter((x) => x === tag).length;
        midRc += t.slice(0, 26).reduce<number>((x, y) => x + y, 0);
      }
      // A moderate lean: several cards on average, not the whole sign up front.
      expect(lean / RUNS, bias).toBeGreaterThan(3);
      expect(lean / RUNS, bias).toBeLessThan(9);
      expect((midRc / RUNS) * tag, bias).toBeGreaterThan(2);
    }
    // And with no bias, no lean.
    const none = seeds.reduce((s, seed) => {
      const t = tags(52, seed, 'none');
      return s + t.slice(0, 26).filter((x) => x === -1).length - t.slice(26).filter((x) => x === -1).length;
    }, 0);
    expect(Math.abs(none / RUNS)).toBeLessThan(0.5);
  });

  it('every biased run is cards one shoe holds: no rank more often than its decks allow', () => {
    for (const bias of ['negative', 'positive'] as const) {
      for (const seed of seeds.slice(0, 300)) {
        const cards = makeCountDrill(52, 1, seed, bias).groups.flat();
        expect(cards).toHaveLength(52);
        const count = new Map<string, number>();
        for (const c of cards) count.set(`${c.rank}${c.suit}`, (count.get(`${c.rank}${c.suit}`) ?? 0) + 1);
        // 52 cards come from a two-deck shoe: no exact card more than twice.
        for (const v of count.values()) expect(v).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('makeCountDrill shoe size (#44: a whole-deck run must not always end at 0)', () => {
  const rankCounts = (round: { groups: Card[][] }) => {
    const m = new Map<string, number>();
    for (const c of round.groups.flat()) {
      const k = `${c.rank}${c.suit}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };

  it('a 52-card run does not always count to zero', () => {
    // Drawn from exactly one deck, every 52-card run summed to 0 by
    // construction. From a two-deck shoe the end count is a random slice's.
    const finals = Array.from({ length: 40 }, (_, seed) => makeCountDrill(52, 1, seed).finalRc);
    expect(finals.some((rc) => rc !== 0)).toBe(true);
    // ...and not by accident: well over half the runs end off zero.
    expect(finals.filter((rc) => rc !== 0).length).toBeGreaterThan(20);
  });

  it('a 104-card run does not always count to zero either', () => {
    const finals = Array.from({ length: 40 }, (_, seed) => makeCountDrill(104, 2, seed).finalRc);
    expect(finals.filter((rc) => rc !== 0).length).toBeGreaterThan(20);
  });

  it('draws exactly the run length, from a shoe one deck larger than the run', () => {
    for (const cards of [13, 52, 65, 104, 312]) {
      const round = makeCountDrill(cards, 1, 99);
      expect(round.groups.flat()).toHaveLength(cards);
      // No card appears more often than the shoe holds copies of it:
      // ceil(cards/52) + 1 decks.
      const decks = Math.ceil(cards / 52) + 1;
      const most = Math.max(...rankCounts(round).values());
      expect(most).toBeLessThanOrEqual(decks);
    }
    // A 52-card run really does reach a second deck: some card shows twice.
    const repeats = Array.from({ length: 20 }, (_, s) => makeCountDrill(52, 1, s)).some(
      (r) => Math.max(...rankCounts(r).values()) > 1,
    );
    expect(repeats).toBe(true);
  });
});
