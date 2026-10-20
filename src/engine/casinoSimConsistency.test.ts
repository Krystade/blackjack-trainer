import { describe, it, expect } from 'vitest';
import { CasinoSim, type SimSpec } from './casinoSim';
import { runGame } from './casinoRun';
import { houseEdge, summarize } from './casinoStats';
import { DEFAULT_SPREAD } from './game';
import { actionEvs } from './handEv';
import { basicPlay } from './strategy';
import type { Card, Rank } from './cards';
import type { StrategyRules } from './ruleset';
import type { EvAction } from './handEv';

/**
 * Wave K: the simulator against ITSELF and against the app's own exact
 * infinite-deck arithmetic -- never against a remembered published house
 * edge. Round counts are small and seeds fixed, so each check is
 * deterministic; the slowest (the 8-deck comparison) runs ~2 million rounds.
 */

const BASE: StrategyRules = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };
const RAMP = { id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null };

function spec(over: Partial<SimSpec> = {}): SimSpec {
  return {
    rules: BASE,
    cutDecks: 1,
    csm: false,
    unit: 1,
    maxBet: null,
    spread: DEFAULT_SPREAD,
    tcRounding: 'floor',
    indices: true,
    methods: [RAMP],
    ...over,
  };
}

function flatEdge(rules: StrategyRules, rounds: number, seed = 5, cutDecks = 1): { edge: number; ci: number } {
  const sim = new CasinoSim(spec({ rules, cutDecks }), 'basic', seed);
  sim.run(rounds);
  return houseEdge(sim.basicAccum(), 1);
}

describe('internal consistency', () => {
  it('S17 is better for the player than H17, everything else equal', () => {
    const h17 = flatEdge(BASE, 600_000);
    const s17 = flatEdge({ ...BASE, s17: true }, 600_000);
    expect(s17.edge).toBeLessThan(h17.edge);
  });

  it('6:5 costs exactly 0.3 units on every natural the player is paid, and naturals come about 4.7% of rounds', () => {
    // Same seed, same chart (the payout does not change basic strategy): the
    // two runs see the same cards and make the same plays, so the whole
    // difference is the payout on the naturals the player is paid.
    const run = (bj65: boolean) => {
      const sim = new CasinoSim(spec({ rules: { ...BASE, bj65 } }), 'basic', 11);
      let paidNaturals = 0;
      sim.onRound = (r) => {
        if (r.total === (bj65 ? 1.2 : 1.5)) paidNaturals += 1;
      };
      sim.run(300_000);
      return { edge: houseEdge(sim.basicAccum(), 1).edge, freq: paidNaturals / sim.rounds };
    };
    const a = run(false);
    const b = run(true);
    expect(b.freq).toBeCloseTo(a.freq, 12);
    expect(b.edge - a.edge).toBeCloseTo(0.3 * a.freq, 9);
    // A natural without the dealer also holding one: about 2 x (4/13)(1/13) x (1 - ~1/13 x ...), near 4.5-4.8%.
    expect(a.freq).toBeGreaterThan(0.042);
    expect(a.freq).toBeLessThan(0.05);
  });

  it('a deeper cut earns a counter more', () => {
    const ev = (cutDecks: number) => {
      const sim = new CasinoSim(spec({ cutDecks }), 'count', 3);
      sim.run(400_000);
      return summarize(sim.methodAccums()[0]!.acc).evTime;
    };
    const deep = ev(0.75);
    const shallow = ev(2.5);
    expect(deep).toBeGreaterThan(shallow);
  });

  it('a continuous shuffler has no counting result, only the flat house edge', () => {
    const run = runGame(spec({ csm: true }), { seed: 1, timeCapMs: 60_000, maxRounds: 5000, now: () => 0 });
    let last = run.next();
    while (!last.done) last = run.next();
    expect(last.value.methods).toBeNull();
    expect(last.value.countRounds).toBe(0);
    expect(last.value.basicRounds).toBe(5000);
    expect(last.value.status).toBe('budget');
  });

  it('the same seed gives the same result, run to run', () => {
    const go = () => {
      const run = runGame(spec({ methods: [RAMP, { id: 'w', entryTc: null, exitTc: -1, rampStartTc: null }] }), {
        seed: 99,
        timeCapMs: 60_000,
        maxRounds: 20_000,
        now: () => 0,
      });
      let last = run.next();
      while (!last.done) last = run.next();
      return last.value;
    };
    expect(go()).toEqual(go());
  });
});

// ---------------------------------------------------------------- vs exact

const RANK_P: [Rank, number][] = [
  ['A', 1 / 13],
  ['2', 1 / 13],
  ['3', 1 / 13],
  ['4', 1 / 13],
  ['5', 1 / 13],
  ['6', 1 / 13],
  ['7', 1 / 13],
  ['8', 1 / 13],
  ['9', 1 / 13],
  ['10', 4 / 13],
];
const card = (rank: Rank): Card => ({ rank, suit: 's' });
const isTen = (r: Rank) => r === '10';

/**
 * The infinite-deck EV of one round played by the chart: for every up card
 * and first two cards, the dealer's natural (peeked on A and ten) and the
 * player's natural settle first; otherwise the chart's first play is priced
 * with handEv's exact `actionEvs` (which plays on optimally after a hit and
 * splits without resplitting).
 */
function infiniteDeckEv(rules: StrategyRules): number {
  let ev = 0;
  for (const [up, pu] of RANK_P) {
    const pDealerBj = up === 'A' ? 4 / 13 : isTen(up) ? 1 / 13 : 0;
    for (const [c1, p1] of RANK_P) {
      for (const [c2, p2] of RANK_P) {
        const p = pu * p1 * p2;
        const natural = (c1 === 'A' && isTen(c2)) || (isTen(c1) && c2 === 'A');
        const cards = [card(c1), card(c2)];
        // Dealer natural: a player natural pushes, anything else loses.
        ev += p * pDealerBj * (natural ? 0 : -1);
        let rest: number;
        if (natural) rest = rules.bj65 ? 1.2 : 1.5;
        else {
          const ctx = { canDouble: true, canSplit: c1 === c2, canSurrender: rules.ls };
          const evs = actionEvs(cards, up, ctx, rules);
          const a = basicPlay(cards, up, ctx, rules).action as EvAction;
          rest = a === 'stand' ? evs.stand : a === 'hit' ? evs.hit : evs[a]!;
        }
        ev += p * (1 - pDealerBj) * rest;
      }
    }
  }
  return ev;
}

describe('the flat simulation agrees with the exact infinite-deck arithmetic', () => {
  /**
   * At 8 decks the shoe is close to infinite, and what separates the two is
   * known in direction and small in size: an 8-deck shoe is slightly worse
   * for the player than an infinite one (removal of each card dealt), handEv
   * splits without resplitting (understating splits, so the exact figure is
   * a little LOW), the 8-deck chart is not exactly the infinite-deck optimum,
   * and the cut card costs a sliver. Each of those is a few hundredths of a
   * percent; 0.15% covers them all with room. On top of that the sim has its
   * own 95% interval. So: |sim - exact| < 0.15% + the interval.
   *
   * A COARSE CHECK (review N2): the band is about 0.3% wide all told, near
   * half the house edge, so a sim-only rule slip worth less than that -- DAS
   * is worth ~0.14% -- would pass it. Tightening it to ~0.05% needs ~20
   * million rounds (12 s here), too slow for the unit suite. What guards the
   * rule handling is the round-by-round parity with `Game`
   * (casinoSim.test.ts); this only catches a gross error in the whole.
   */
  it('6D-style rules dealt from 8 decks, H17 DAS LS 3:2', () => {
    const rules = { ...BASE, decks: 8 as const };
    const exact = infiniteDeckEv(rules);
    const sim = flatEdge(rules, 2_000_000, 21, 1.5);
    expect(Math.abs(-sim.edge - exact)).toBeLessThan(0.0015 + sim.ci);
    // And the interval really is that tight at this round count (not a free pass).
    expect(sim.ci).toBeLessThan(0.0017);
  });

  it('the exact figure itself orders the rules the same way the sim does', () => {
    expect(infiniteDeckEv({ ...BASE, decks: 8, s17: true })).toBeGreaterThan(infiniteDeckEv({ ...BASE, decks: 8 }));
    expect(infiniteDeckEv({ ...BASE, decks: 8, bj65: true })).toBeLessThan(infiniteDeckEv({ ...BASE, decks: 8 }));
  });
});
