import { describe, it, expect } from 'vitest';
import { CasinoSim, TC_CLAMP, type SimSpec } from './casinoSim';
import { Game, DEFAULT_SPREAD, type SpreadRow } from './game';
import { Shoe, RANKS, mulberry32 } from './cards';
import { handValue, isPair } from './hand';
import { play } from './strategy';
import { getChart } from './charts';
import { correctPlay, basicPlay, insuranceCorrect } from './strategy';
import { indexSetFor } from './deviations';
import { spreadHandsFor } from './wong';
import type { StrategyRules } from './ruleset';
import type { Action } from './deviations';

const H17_6D: StrategyRules = { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false };

function spec(over: Partial<SimSpec> = {}): SimSpec {
  return {
    rules: H17_6D,
    cutDecks: 1,
    csm: false,
    unit: 1,
    maxBet: null,
    spread: DEFAULT_SPREAD,
    tcRounding: 'floor',
    indices: true,
    methods: [{ id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null }],
    ...over,
  };
}

/**
 * Play the same seed through Play's own `Game`, every round, one unit a hand,
 * the hand count from the ramp's x2 rows, insurance and plays from the
 * engine's advice -- and return each round's bankroll change.
 */
function gameNets(rules: StrategyRules, seed: number, rounds: number, counting: boolean, spread: SpreadRow[], cutDecks: number): number[] {
  const game = new Game({
    penetration: 0.75,
    cutDecks,
    betSpreadOn: true,
    spread,
    bankrollStart: 0,
    countCheckEvery: 0,
    seed,
    rules,
    seats: { playerHands: 1, bots: 0, botMistakePct: 0, playerPosition: 0 },
    tcRounding: 'floor',
    gradeDeviations: counting,
  });
  const nets: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const before = game.bankroll;
    const tc = game.shuffleDue ? 0 : game.trueCountNow;
    const hands = counting ? spreadHandsFor(tc, spread) : 1;
    game.startRound(hands === 2 ? [1, 1] : 1);
    if (game.phase === 'insurance') game.insuranceDecision(counting && insuranceCorrect(game.trueCountNow, rules));
    while (game.phase === 'player') {
      const hand = game.hands[game.active]!;
      const legal = game.legalActions();
      const ctx = { canDouble: legal.includes('double'), canSplit: legal.includes('split'), canSurrender: legal.includes('surrender') };
      const up = game.dealerCards[0]!.rank;
      const advice = counting ? correctPlay(hand.cards, up, game.trueCountNow, ctx, rules) : basicPlay(hand.cards, up, ctx, rules);
      game.act(advice.action as Action);
    }
    game.events = [];
    nets.push(game.bankroll - before);
  }
  return nets;
}

function simNets(s: SimSpec, mode: 'basic' | 'count', seed: number, rounds: number): number[] {
  const sim = new CasinoSim(s, mode, seed);
  const nets: number[] = [];
  sim.onRound = (r) => nets.push(r.total);
  sim.run(rounds);
  return nets;
}

/** Round by round; 6:5 pays 1.2, which the bankroll's running sum carries with float error. */
function expectSame(sim: number[], game: number[]): void {
  expect(sim).toHaveLength(game.length);
  const off = sim.findIndex((v, i) => Math.abs(v - game[i]!) > 1e-9);
  expect(off, `first different round: ${off} (sim ${sim[off]}, Play ${game[off]})`).toBe(-1);
}

describe('the simulator plays exactly as Play does', () => {
  // Same seed, same shoe, same cut, same advice: every round's result must
  // match Game's bankroll change, to the cent, across the rule variations
  // that change how a round plays.
  const variants: [string, StrategyRules][] = [
    ['6D H17 DAS LS 3:2', H17_6D],
    ['8D H17 no DAS no LS', { ...H17_6D, decks: 8, das: false, ls: false }],
    ['6D S17 DAS 6:5', { ...H17_6D, s17: true, ls: false, bj65: true }],
    ['2D H17 RSA', { ...H17_6D, decks: 2, rsa: true }],
    ['1D S17 surrender indices + extras', { ...H17_6D, decks: 1, s17: false, surrenderIndices: true, bjaExtras: true }],
  ];
  for (const [name, rules] of variants) {
    it(`counting, ${name}`, () => {
      const cut = rules.decks <= 2 ? 0.5 : 1.25;
      const ramp: SpreadRow[] = [...DEFAULT_SPREAD.slice(0, 5), { minTc: 5, units: 12, hands: 2 }];
      // Play's reserve: 4 x (3 watched bots + 2 hands) + 20 (Game.shuffleDue).
      const s = spec({ rules, cutDecks: cut, spread: ramp, reserveCards: 40 });
      expectSame(simNets(s, 'count', 4242, 3000), gameNets(rules, 4242, 3000, true, ramp, cut));
    });
  }
  it('basic strategy, flat', () => {
    const s = spec({ cutDecks: 1.5 });
    expectSame(simNets(s, 'basic', 77, 3000), gameNets(H17_6D, 77, 3000, false, DEFAULT_SPREAD, 1.5));
  });
});

describe('determinism and the decision cache', () => {
  it('the same seed gives the same sums, however the rounds are chunked', () => {
    const a = new CasinoSim(spec(), 'count', 9);
    a.run(4000);
    const b = new CasinoSim(spec(), 'count', 9);
    b.run(1000);
    b.run(3000);
    expect(b.methodAccums()).toEqual(a.methodAccums());
    const c = new CasinoSim(spec(), 'count', 10);
    c.run(4000);
    expect(c.methodAccums()[0]!.acc.net).not.toBe(a.methodAccums()[0]!.acc.net);
  });

  it('every index threshold sits inside the clamped count range', () => {
    for (const decks of [1, 2, 6, 8] as const) {
      for (const s17 of [true, false]) {
        for (const surrenderIndices of [true, false]) {
          for (const bjaExtras of [true, false]) {
            for (const d of indexSetFor({ decks, s17, surrenderIndices, bjaExtras })) {
              expect(Math.abs(d.threshold)).toBeLessThan(TC_CLAMP);
            }
          }
        }
      }
    }
  });
});

describe('the shoe is Shoe, card for card', () => {
  it('deals the same cards as Shoe for the same seed and cut, across reshuffles', () => {
    for (const decks of [1, 2, 6, 8] as const) {
      const cutDecks = decks === 1 ? 0.5 : 1;
      const sim = new CasinoSim(spec({ rules: { ...H17_6D, decks }, cutDecks }), 'basic', 31337);
      const shoe = new Shoe({ decks, seed: 31337, cutCards: () => Math.round(cutDecks * 52) });
      // The first shoe, then two more after shuffles.
      for (let s = 0; s < 3; s++) {
        expect(sim.peekCards(decks * 52)).toEqual(Array.from({ length: decks * 52 }, () => shoe.draw()));
        shoe.shuffle();
        (sim as unknown as { shuffleShoe(): void }).shuffleShoe();
      }
    }
  });
});

describe('the decision cache answers exactly as play() does', () => {
  it('for random hands, counts (inside and beyond the clamp) and options', () => {
    const rng = mulberry32(2024);
    const ranks = RANKS;
    const pick = () => ranks[Math.floor(rng() * ranks.length)]!;
    for (const rules of [H17_6D, { ...H17_6D, decks: 1 as const, s17: true, surrenderIndices: true }, { ...H17_6D, das: false, ls: false, bjaExtras: true }]) {
      const sim = new CasinoSim(spec({ rules }), 'count', 1);
      const devs = indexSetFor(rules);
      const chart = getChart(rules);
      for (let i = 0; i < 20000; i++) {
        const n = 2 + Math.floor(rng() * 3);
        const cards = Array.from({ length: n }, () => ({ rank: pick(), suit: 's' as const }));
        if (handValue(cards).total > 21) continue;
        const up = pick();
        const tc = Math.floor(rng() * 41) - 20;
        const two = n === 2;
        const ctx = { canDouble: two && rng() < 0.7, canSplit: two && isPair(cards) && rng() < 0.7, canSurrender: two && rng() < 0.5 };
        // Twice: the second answer comes from the cache.
        for (let k = 0; k < 2; k++) {
          expect(sim.decideCards(cards, up, tc, ctx.canDouble, ctx.canSplit, ctx.canSurrender)).toBe(play(cards, up, tc, ctx, devs, chart).action);
        }
      }
    }
  });
});

// C4 (audit 2026-10-29): the simulator reused Play's half-deck cut bound, so
// every single-deck game was dealt to exactly half a deck whatever was logged.
describe('the simulator deals a single-deck game at its logged cut (C4)', () => {
  const shuffles = (cutDecks: number): number => {
    const sim = new CasinoSim(spec({ rules: { ...H17_6D, decks: 1 }, cutDecks }), 'basic', 4242);
    let n = 0;
    sim.onRound = (r) => {
      if (r.shuffled) n += 1;
    };
    sim.run(20_000);
    return n;
  };

  it('a shallow cut (0.75 left) shuffles more often than a deep one (0.25 left)', () => {
    const shallow = shuffles(0.75);
    const half = shuffles(0.5);
    const deep = shuffles(0.25);
    expect(shallow).toBeGreaterThan(half * 1.3);
    expect(half).toBeGreaterThan(deep * 1.3);
  });
});
