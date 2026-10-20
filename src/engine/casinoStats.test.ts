import { describe, it, expect } from 'vitest';
import { bestIndex, evPrecise, edgePrecise, hourly, houseEdge, riskOfRuin, summarize } from './casinoStats';
import { emptyAccum, type Accum } from './casinoSim';
import { runGame, MIN_ROUNDS } from './casinoRun';
import { DEFAULT_SPREAD } from './game';

/** Sums for a list of shoes, each a list of per-round results (null = watched). */
function accumOf(shoes: (number | null)[][], bet = 10): Accum {
  const a = emptyAccum();
  for (const shoe of shoes) {
    let y = 0;
    let x = 0;
    for (const r of shoe) {
      a.observed += 1;
      x += 1;
      if (r === null) continue;
      a.played += 1;
      a.net += r;
      a.net2 += r * r;
      a.wagered += bet;
      y += r;
    }
    a.sy2 += y * y;
    a.sxy += x * y;
    a.sx2 += x * x;
    a.shoes += 1;
  }
  return a;
}

describe('the definitions', () => {
  const a = accumOf([
    [10, -10, 20, null],
    [-10, 10, 10, null],
  ]);
  const s = summarize(a);

  it('EV and SD are per played round; EV per observed round counts watched rounds', () => {
    // Played: 10, -10, 20, -10, 10, 10 -> mean 30/6 = 5; observed 8 -> 3.75.
    expect(s.ev).toBeCloseTo(5, 12);
    expect(s.evObserved).toBeCloseTo(30 / 8, 12);
    expect(s.playedShare).toBeCloseTo(6 / 8, 12);
    // E[x^2] = (100+100+400+100+100+100)/6 = 150; var = 150 - 25 = 125.
    expect(s.sd).toBeCloseTo(Math.sqrt(125), 12);
    expect(s.avgBet).toBe(10);
  });

  it('hours scale by rounds PLAYED per hour; N0 = (SD/EV)^2; DI = 1000 EV/SD', () => {
    const h = hourly(s, 80, null);
    expect(h.playedPerHour).toBeCloseTo(60, 12);
    expect(h.evHour).toBeCloseTo(80 * 3.75, 12); // = 60 played x $5
    expect(h.sdHour).toBeCloseTo(Math.sqrt(125) * Math.sqrt(60), 9);
    expect(h.n0Rounds).toBeCloseTo(125 / 25, 12);
    expect(h.n0Hours).toBeCloseTo(5 / 60, 12);
    // (SD_h / EV_h)^2 is the same N0 in hours.
    expect((h.sdHour / h.evHour) ** 2).toBeCloseTo(h.n0Hours!, 9);
    expect(h.di).toBeCloseTo((1000 * 5) / Math.sqrt(125), 9);
    expect(h.evPer100).toBeCloseTo(500, 9);
    expect(h.sdPer100).toBeCloseTo(10 * Math.sqrt(125), 9);
  });

  it('the error of the mean is taken over shoes (ratio estimator), not over rounds', () => {
    // y = shoe nets 20 and 10; x = 4, 4; R = 30/8.
    const r = 30 / 8;
    const resid = (20 - r * 4) ** 2 + (10 - r * 4) ** 2;
    expect(s.seObserved).toBeCloseTo(Math.sqrt(resid * 2) / 8, 12);
    const h = hourly(s, 80, null);
    expect(h.evHourCi).toBeCloseTo(1.96 * 80 * s.seObserved, 9);
    // One shoe says nothing about the spread between shoes.
    expect(summarize(accumOf([[1, 2, 3]])).seObserved).toBe(Infinity);
  });

  it('risk of ruin is the diffusion approximation, 1 with no edge, absent without a bankroll', () => {
    expect(riskOfRuin(0.05, 10, 1000)).toBeCloseTo(Math.exp(-1), 12); // exp(-2 x 0.05 x 1000 / 100)
    expect(riskOfRuin(-1, 10, 1000)).toBe(1);
    expect(riskOfRuin(5, 10, null)).toBeNull();
    expect(hourly(s, 80, 10).ror).toBeCloseTo(Math.exp((-2 * 5 * 10) / 125), 12); // = exp(-0.8), per played round
  });

  it('no edge: N0 is never, and N0 hours follows', () => {
    const neg = summarize(accumOf([[-10, 10, -10], [-10, -10, 10]]));
    const h = hourly(neg, 80, 500);
    expect(h.n0Hours).toBeNull();
    expect(h.n0Rounds).toBeNull();
    expect(h.ror).toBe(1);
  });

  it('house edge is the loss per unit bet, positive for the house', () => {
    const he = houseEdge(accumOf([[-1, -1, 1], [1, -1, 0]], 1), 1);
    expect(he.edge).toBeCloseTo(1 / 6, 12);
    // Dollars: the same loss on a $25 unit is the same edge.
    expect(houseEdge(accumOf([[-25, -25, 25], [25, -25, 0]], 25), 25).edge).toBeCloseTo(1 / 6, 12);
  });

  it('picks the best method by EV per observed round', () => {
    expect(bestIndex([accumOf([[1, 1]]), accumOf([[3, null]]), accumOf([[-1]])])).toBe(1);
  });

  it('precision targets: +/-0.05% on the edge, +/-10% on the EV', () => {
    expect(edgePrecise(accumOf([[1, -1], [1, -1]], 1), 1)).toBe(true); // zero spread between shoes
    expect(edgePrecise(accumOf([[1, 1], [-1, -1]], 1), 1)).toBe(false);
    expect(evPrecise(accumOf([[5, 5], [5, 5]]))).toBe(true);
    expect(evPrecise(accumOf([[50, -40], [-40, 50], [10, -9]]))).toBe(false);
  });
});

describe('the run', () => {
  const spec = {
    rules: { decks: 6 as const, s17: false, das: true, ls: true, rsa: false, bj65: false },
    cutDecks: 1,
    csm: false,
    unit: 25,
    maxBet: null,
    spread: DEFAULT_SPREAD,
    tcRounding: 'floor' as const,
    indices: true,
    methods: [{ id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null }],
  };

  it('stops at the time cap with what it has, and reports progress on the way', () => {
    let t = 0;
    const run = runGame(spec, { seed: 1, timeCapMs: 1000, now: () => t, basicChunk: 1000, countChunk: 1000 });
    const seen: number[] = [];
    let step = run.next();
    while (!step.done) {
      seen.push(step.value.fraction);
      t += 300; // each chunk "takes" 300 ms
      step = run.next();
    }
    expect(step.value.status).toBe('time');
    expect(step.value.basicRounds).toBe(4000);
    expect(seen.length).toBe(4);
    expect(seen.every((f) => f > 0 && f < 1)).toBe(true);
  });

  it('never stops on a target before the minimum rounds without a budget', () => {
    const run = runGame(spec, { seed: 1, timeCapMs: 1e9, now: () => 0, basicChunk: 50_000, countChunk: 50_000 });
    let step = run.next();
    while (!step.done && step.value.basicRounds < MIN_ROUNDS) {
      expect(step.value.status).toBe('running');
      step = run.next();
    }
    expect(step.value.basicRounds).toBeGreaterThanOrEqual(MIN_ROUNDS);
  });
});
