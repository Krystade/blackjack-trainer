import { describe, expect, it } from 'vitest';
import { CasinoSim } from '../casinoSim';
import type { SimSpec } from '../casinoSim';
import { DEFAULT_RULES } from '../ruleset';
import { compTotal, fullComp, rankCounts, suitCounts } from './comp';
import { effectsOfRemoval } from './eor';
import { sideBetEv } from './odds';
import { payTableOf } from './payTables';
import { countedResult, findTrigger, linearEv, sideRunningCount, SideSim } from './sideSim';
import type { TcBin } from './sideSim';
import { PUBLISHED_COUNTS } from './counts';

const bins = (xs: [number, number, number][]): TcBin[] => xs.map(([tc, n, mean]) => ({ tc, n, ev: n * mean }));

describe('the trigger search', () => {
  it('is the lowest count from which every populated bin is positive', () => {
    const b = bins([
      [0, 5000, -0.1],
      [1, 5000, -0.02],
      [2, 5000, 0.01],
      [3, 5000, 0.03],
      [4, 100, -0.5], // too thin to count
      [5, 2000, 0.06],
    ]);
    expect(findTrigger(b)).toBe(2);
  });

  it('a negative bin above a positive one moves the trigger up', () => {
    const b = bins([
      [1, 5000, 0.01],
      [2, 5000, -0.01],
      [3, 5000, 0.02],
    ]);
    expect(findTrigger(b)).toBe(3);
  });

  it('looks down for a count that bets low, and is null when nothing gets there', () => {
    const b = bins([
      [-6, 1000, 0.05],
      [-5, 1000, 0.01],
      [-4, 1000, -0.01],
    ]);
    expect(findTrigger(b, true)).toBe(-5);
    expect(findTrigger(bins([[0, 9000, -0.1]]))).toBeNull();
  });

  it('what betting from the trigger earns: frequency, edge when bet, units per 100 dealt', () => {
    const b = bins([
      [0, 8000, -0.1],
      [2, 1500, 0.02],
      [3, 500, 0.06],
    ]);
    const r = countedResult(b, 10_000, 2);
    expect(r.freq).toBeCloseTo(0.2, 12);
    expect(r.edge).toBeCloseTo((1500 * 0.02 + 500 * 0.06) / 2000, 12);
    expect(r.per100).toBeCloseTo(((1500 * 0.02 + 500 * 0.06) / 10_000) * 100, 12);
  });
});

describe('the side counts over a composition', () => {
  it('the suit spread is the most-seen suit less the least-seen', () => {
    const c = fullComp(1);
    // Remove three spades and one heart: spread 3 - 0 = 3.
    c[0]! -= 1;
    c[4]! -= 1;
    c[8]! -= 1;
    c[1]! -= 1;
    const def = PUBLISHED_COUNTS.twentyOnePlus3![0]!;
    expect(sideRunningCount(def, rankCounts(c), suitCounts(c), 1)).toBe(3);
  });
});

describe('Buster, priced by the linear estimate', () => {
  /**
   * The simulator prices Buster rounds by the effects of removal (sideSim.ts),
   * as the exact recursion costs ~10 ms. Measured here against the exact value
   * on real compositions from the simulator's own shoes, deep in 6-deck shoes.
   */
  it('tracks the exact EV on deep-shoe compositions', () => {
    const pays = payTableOf('buster', 'bu-evo')!.pays;
    const rules = { ...DEFAULT_RULES, decks: 6 as const, s17: true };
    const spec: SimSpec = {
      rules,
      cutDecks: 1,
      csm: false,
      unit: 1,
      maxBet: null,
      spread: [{ minTc: -99, units: 1 }],
      tcRounding: 'floor',
      indices: false,
      methods: [],
    };
    const sim = new CasinoSim(spec, 'basic', 11);
    sim.trackComposition();
    const comps: Int16Array[] = [];
    let k = 0;
    sim.onPreDeal = () => {
      k += 1;
      if (k % 37 === 0 && compTotal(sim.left!) < 2 * 52 && comps.length < 40) comps.push(sim.left!.slice());
    };
    sim.run(20_000);
    expect(comps.length).toBe(40);
    const eor = effectsOfRemoval('buster', pays, 6, { s17: true });
    const ev0 = sideBetEv('buster', pays, fullComp(6), { s17: true });
    const exact = comps.map((c) => sideBetEv('buster', pays, c, { s17: true }));
    const lin = comps.map((c) => linearEv(ev0, eor, 6, c));
    const err = exact.map((e, i) => Math.abs(e - lin[i]!));
    const spread = Math.max(...exact) - Math.min(...exact);
    // The estimate's error is small beside how far the EV moves, and it
    // gets the sign right wherever the exact value is clearly off zero.
    expect(Math.max(...err)).toBeLessThan(0.25 * spread);
    for (const [i, e] of exact.entries()) if (Math.abs(e) > 0.03) expect(Math.sign(lin[i]!)).toBe(Math.sign(e));
  }, 120_000);

  it('the simulator reads the composition before every round and scores each round', () => {
    const pays = payTableOf('over13', 'ou-even')!.pays;
    const sim = new SideSim({ bet: 'over13', pays, rules: { ...DEFAULT_RULES, decks: 1 }, cutDecks: 0.5, counts: [{ def: PUBLISHED_COUNTS.over13![0]! }] }, 3);
    sim.run(2000);
    expect(sim.rounds).toBe(2000);
    const n = sim.binsOf(0).reduce((a, b) => a + b.n, 0);
    expect(n).toBe(2000);
    // Over the rounds the mean EV is near the off-the-top EV (it is the same bet).
    const mean = sim.binsOf(0).reduce((a, b) => a + b.ev, 0) / n;
    expect(Math.abs(mean - sim.evTop)).toBeLessThan(0.02);
  });
});

describe('Wave L merge: a 4-deck shoe (Wave M)', () => {
  it('prices its rounds from the 4-deck shoe it deals, playing the 6-deck chart', () => {
    const pays = payTableOf('luckyLadies', 'll-b')!.pays;
    const sim = new SideSim({ bet: 'luckyLadies', pays, rules: { ...DEFAULT_RULES, decks: 6 }, shoeDecks: 4, cutDecks: 1, counts: [{ def: PUBLISHED_COUNTS.luckyLadies![0]! }] }, 5);
    expect(sim.evTop).toBeCloseTo(sideBetEv('luckyLadies', pays, fullComp(4), { s17: DEFAULT_RULES.s17 }), 12);
    expect(sim.evTop).not.toBeCloseTo(sideBetEv('luckyLadies', pays, fullComp(6), { s17: DEFAULT_RULES.s17 }), 6);
    sim.run(2000);
    // The composition it reads is the 4-deck shoe's: never more than 4 of a card, 208 in all.
    expect(Math.max(...sim.sim.left!)).toBeLessThanOrEqual(4);
    expect(compTotal(sim.sim.left!)).toBeLessThanOrEqual(208);
    expect(sim.rounds).toBeGreaterThan(0);
  });
});
