import { describe, it, expect } from 'vitest';
import { CasinoSim, TC_CLAMP, emptyAccum, type Accum, type SimSpec } from './casinoSim';
import { methodBet, methodSpread, type BetMethod } from './betMethods';
import type { SpreadRow } from './game';

/**
 * Review S1: how each betting method is scored from the simulated rounds --
 * seated or watching, entering, leaving, the table max, one hand or two.
 *
 * Two kinds of check. First, facts about a method stated straight from the
 * round stream (`onRound`), with no bookkeeping: a wong-out leaves exactly
 * the shoes in which some round after the first has a pre-deal count at or
 * below its exit; a back-counter plays exactly the rounds from the first one
 * at or above its entry; a flat bettor's net is the first hand's results.
 * Second, every sum of every method against a small reference scorer written
 * here from the rules in betMethods.ts.
 */

type Round = { tc: number; hands: 1 | 2; first: number; total: number; shuffled: boolean; midShuffle: boolean };

const SPREAD: SpreadRow[] = [
  { minTc: -99, units: 1 },
  { minTc: 1, units: 2 },
  { minTc: 2, units: 4 },
  { minTc: 3, units: 8, hands: 2 },
];

const M = (id: string, over: Partial<BetMethod>): BetMethod => ({ id, entryTc: null, exitTc: null, rampStartTc: null, ...over });

const METHODS: BetMethod[] = [
  M('flat', { flat: true }),
  M('ramp', {}),
  M('wong-1', { exitTc: -1 }),
  M('wong0', { exitTc: 0 }),
  M('bc+2', { entryTc: 2 }),
  M('bc+1-1', { entryTc: 1, exitTc: -1 }),
  M('start+3', { rampStartTc: 3, exitTc: -2 }),
];

function spec(over: Partial<SimSpec> = {}): SimSpec {
  return {
    rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    cutDecks: 1.5,
    csm: false,
    unit: 25,
    // Caps the 8-unit x2 row: 8 x 25 = 200 > 150.
    maxBet: 150,
    spread: SPREAD,
    tcRounding: 'floor',
    indices: true,
    methods: METHODS,
    ...over,
  };
}

function run(s: SimSpec, n: number, seed = 4242): { rounds: Round[]; accs: Map<string, Accum> } {
  const sim = new CasinoSim(s, 'count', seed);
  const rounds: Round[] = [];
  sim.onRound = (r) => rounds.push({ ...r });
  sim.run(n);
  return { rounds, accs: new Map(sim.methodAccums().map((m) => [m.method.id, m.acc])) };
}

/** Rounds grouped by shoe (a shoe starts at a `shuffled` round, or after a `midShuffle` one). */
function shoes(rounds: Round[]): Round[][] {
  const out: Round[][] = [];
  let cur: Round[] = [];
  for (const r of rounds) {
    if (r.shuffled && cur.length > 0) {
      out.push(cur);
      cur = [];
    }
    cur.push(r);
    if (r.midShuffle) {
      out.push(cur);
      cur = [];
    }
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

const N = 60_000;
const base = run(spec(), N);

describe('straight from the round stream', () => {
  it('a wong-out leaves exactly the shoes where a round after the first is at or below its exit', () => {
    for (const [id, exit] of [
      ['wong-1', -1],
      ['wong0', 0],
    ] as const) {
      // Re-review R3: an exit counts (costs time) only when the shoe deals
      // at least one more round after it.
      const leaveAt = (shoe: Round[]) => shoe.findIndex((r, j) => j > 0 && r.tc <= exit);
      const expected = shoes(base.rounds).filter((shoe) => leaveAt(shoe) !== -1 && leaveAt(shoe) < shoe.length - 1).length;
      expect(base.accs.get(id)!.exits, id).toBe(expected);
      expect(expected, `${id}: the check needs exits to count`).toBeGreaterThan(100);
      if (id === 'wong-1') {
        const onLastRound = shoes(base.rounds).filter((shoe) => leaveAt(shoe) === shoe.length - 1).length;
        expect(onLastRound, 'some shoes are left on their last round, and those exits are free').toBeGreaterThan(5);
      }
    }
    // At or below, not below: some shoes are left at EXACTLY the exit count.
    const atExactly = shoes(base.rounds).filter((shoe) => {
      const first = shoe.slice(1).find((r) => r.tc <= -1);
      return first !== undefined && first.tc === -1;
    }).length;
    expect(atExactly).toBeGreaterThan(50);
  });

  it('never leaves on the first round of a shoe, even when its count is at the exit', () => {
    // Every shoe opens at TC 0, which is at the exit for "wong0".
    expect(shoes(base.rounds).every((shoe) => shoe[0]!.tc === 0)).toBe(true);
    // So every shoe plays at least its first round.
    expect(base.accs.get('wong0')!.played).toBeGreaterThanOrEqual(shoes(base.rounds).length);
    // Played rounds of "wong0" = per shoe, the rounds before the first round
    // after the first whose count is at or below 0.
    let played = 0;
    for (const shoe of shoes(base.rounds)) {
      const leave = shoe.findIndex((r, j) => j > 0 && r.tc <= 0);
      played += leave === -1 ? shoe.length : leave;
    }
    expect(base.accs.get('wong0')!.played).toBe(played);
  });

  it('a back-counter watches until a pre-deal count at or above its entry, then plays the rest of the shoe', () => {
    let played = 0;
    let atExactly = 0;
    for (const shoe of shoes(base.rounds)) {
      const enter = shoe.findIndex((r) => r.tc >= 2);
      if (enter !== -1) {
        played += shoe.length - enter;
        if (shoe[enter]!.tc === 2) atExactly += 1;
      }
    }
    const a = base.accs.get('bc+2')!;
    expect(a.played).toBe(played);
    expect(atExactly, 'some shoes are entered at exactly the entry count').toBeGreaterThan(50);
    // Watched rounds are time: with no exit, every round dealt is observed.
    expect(a.observed).toBe(N);
    expect(a.dealt).toBe(N);
    expect(a.played).toBeLessThan(a.observed);
    expect(a.exits).toBe(0);
  });

  it('one hand on a round the seat played with two takes the first-dealt hand', () => {
    expect(base.rounds.some((r) => r.hands === 2)).toBe(true);
    const flatNet = base.rounds.reduce((sum, r) => sum + 25 * r.first, 0);
    expect(base.accs.get('flat')!.net).toBeCloseTo(flatNet, 6);
    expect(base.accs.get('flat')!.twoHands).toBe(0);
  });

  it('the table max caps every hand', () => {
    const a = base.accs.get('ramp')!;
    const twoHandRounds = base.rounds.filter((r) => r.tc >= 3).length;
    expect(a.twoHands).toBe(twoHandRounds);
    // 8 units = $200 per hand, capped to $150, on two hands.
    const wagered = base.rounds.reduce((sum, r) => sum + (r.tc >= 3 ? 2 * 150 : r.tc >= 2 ? 100 : r.tc >= 1 ? 50 : 25), 0);
    expect(a.wagered).toBe(wagered);
    // Uncapped, it would be more.
    const loose = run(spec({ maxBet: null }), N).accs.get('ramp')!;
    expect(loose.wagered).toBeGreaterThan(a.wagered);
  });
});

/** The rules of betMethods.ts and casinoSim.ts's `score`, written out again from scratch. */
function reference(rounds: Round[], s: SimSpec): Map<string, Accum> {
  const out = new Map<string, Accum>();
  for (const m of s.methods) {
    const a = emptyAccum();
    const spread = methodSpread(m, s.spread);
    let seated = m.entryTc === null;
    let left = false;
    let pending = false;
    let y = 0;
    let x = 0;
    let e = 0;
    let inShoe = 0;
    const close = () => {
      if (x === 0 && e === 0) return;
      a.sy2 += y * y;
      a.sxy += x * y;
      a.sx2 += x * x;
      a.se2 += e * e;
      a.sey += e * y;
      a.sxe += x * e;
      a.shoes += 1;
      y = x = e = 0;
    };
    const fresh = (roundsIn: number) => {
      close();
      seated = m.entryTc === null;
      left = false;
      pending = false;
      inShoe = roundsIn;
    };
    for (const r of rounds) {
      if (r.shuffled) fresh(0);
      a.dealt += 1;
      const exitNow = !left && seated && m.exitTc !== null && inShoe > 0 && r.tc <= m.exitTc;
      if (left && pending) {
        // The shoe dealt on after the exit: now it costs time.
        pending = false;
        a.exits += 1;
        e += 1;
      }
      if (exitNow) {
        left = true;
        pending = true;
      } else if (!left) {
        if (!seated && m.entryTc !== null && r.tc >= m.entryTc) seated = true;
        if (!seated) {
          a.observed += 1;
          x += 1;
        } else {
          const tc = Math.max(-TC_CLAMP, Math.min(TC_CLAMP, r.tc));
          const { units, hands } = methodBet(spread, tc);
          const bet = Math.min(units * s.unit, s.maxBet ?? Infinity);
          const net = bet * (hands === 2 && r.hands === 2 ? r.total : r.first);
          a.observed += 1;
          a.played += 1;
          if (hands === 2) a.twoHands += 1;
          a.net += net;
          a.net2 += net * net;
          a.wagered += bet * hands;
          y += net;
          x += 1;
        }
      }
      inShoe += 1;
      if (r.midShuffle) fresh(1);
    }
    close();
    out.set(m.id, a);
  }
  return out;
}

function expectSameAccum(got: Accum, want: Accum, id: string): void {
  for (const k of Object.keys(want) as (keyof Accum)[]) {
    const tol = Math.max(1e-6, Math.abs(want[k]) * 1e-12);
    expect(Math.abs(got[k] - want[k]), `${id}.${k}: ${got[k]} vs ${want[k]}`).toBeLessThanOrEqual(tol);
  }
}

describe('every sum, against the reference scorer', () => {
  it('six decks, cut 1.5, a capped x2 ramp', () => {
    const want = reference(base.rounds, spec());
    for (const m of METHODS) expectSameAccum(base.accs.get(m.id)!, want.get(m.id)!, m.id);
  });

  it('one deck dealt to half a deck', () => {
    const s = spec({ rules: { decks: 1, s17: true, das: true, ls: false, rsa: true, bj65: false }, cutDecks: 0.5 });
    const r = run(s, 150_000, 7);
    const want = reference(r.rounds, s);
    for (const m of METHODS) expectSameAccum(r.accs.get(m.id)!, want.get(m.id)!, m.id);
  });

  it('review N7: a shoe that runs dry inside a round is closed like any other, and a method that left comes back', () => {
    // With the cut at half a deck or more a round never runs a shoe dry in
    // practice (a million one-deck rounds found none), so the test holds the
    // cut card off: every shoe is dealt to its last card.
    const s = spec({ rules: { decks: 1, s17: true, das: true, ls: false, rsa: false, bj65: false }, cutDecks: 0.5 });
    const sim = new CasinoSim(s, 'count', 99);
    const hold = sim as unknown as { cutPos: number };
    hold.cutPos = 1e9;
    const rounds: Round[] = [];
    sim.onRound = (r) => {
      rounds.push({ ...r });
      hold.cutPos = 1e9;
    };
    sim.run(20_000);
    const accs = new Map(sim.methodAccums().map((m) => [m.method.id, m.acc]));
    const dry = rounds.filter((r) => r.midShuffle).length;
    expect(dry, 'every shoe ran dry').toBeGreaterThan(1500);
    // The first shoe is the one the constructor shuffled; no cut ever comes.
    expect(rounds.filter((r) => r.shuffled).length).toBe(0);
    const want = reference(rounds, s);
    for (const m of METHODS) expectSameAccum(accs.get(m.id)!, want.get(m.id)!, m.id);
    // Shoes are closed at each dry run: as many shoes as dry runs (plus the open one).
    expect(accs.get('ramp')!.shoes).toBe(dry + 1);
    // And the wong-out came back each time: it left far more often than once.
    expect(accs.get('wong-1')!.exits).toBeGreaterThan(dry / 2);
  });
});
