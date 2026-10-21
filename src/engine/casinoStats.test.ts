import { describe, it, expect } from 'vitest';
import { bestIndex, evPrecise, edgePrecise, hourly, houseEdge, riskOfRuin, summarize } from './casinoStats';
import { emptyAccum, type Accum } from './casinoSim';
import { runGame, MIN_ROUNDS } from './casinoRun';
import { DEFAULT_SPREAD } from './game';

/**
 * Sums for a list of shoes, each a list of per-round results: a number is a
 * played round's net, null a watched round, 'exit' the method leaving the
 * shoe, and 'gone' a round dealt after it left.
 */
function accumOf(shoes: (number | null | 'exit' | 'gone')[][], bet = 10): Accum {
  const a = emptyAccum();
  for (const shoe of shoes) {
    let y = 0;
    let x = 0;
    let e = 0;
    for (const r of shoe) {
      a.dealt += 1;
      if (r === 'exit') {
        a.exits += 1;
        e += 1;
        continue;
      }
      if (r === 'gone') continue;
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
    a.se2 += e * e;
    a.sey += e * y;
    a.sxe += x * e;
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
    expect(s.evTime).toBeCloseTo(30 / 8, 12);
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
    expect(s.seTime).toBeCloseTo(Math.sqrt(resid * 2) / 8, 12);
    const h = hourly(s, 80, null);
    expect(h.evHourCi).toBeCloseTo(1.96 * 80 * s.seTime, 9);
    // One shoe says nothing about the spread between shoes.
    expect(summarize(accumOf([[1, 2, 3]])).seTime).toBe(Infinity);
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

describe('review B1: an exit costs table time', () => {
  // Shoe 1: plays 3 rounds (+30), leaves, 2 rounds go by. Shoe 2: plays 4 (+10), no exit.
  const a = accumOf([
    [10, 10, 10, 'exit', 'gone', 'gone'],
    [10, -10, 0, 10],
  ]);

  it('time is observed rounds plus exits at k rounds each; EV per hour follows it', () => {
    const free = summarize(a, 0);
    expect(free.time).toBe(7);
    expect(free.evTime).toBeCloseTo(40 / 7, 12);
    // 5 minutes at 80 rounds an hour = 6 2/3 rounds per exit.
    const k = (80 * 5) / 60;
    const s = summarize(a, k);
    expect(s.exits).toBe(1);
    expect(s.time).toBeCloseTo(7 + k, 12);
    expect(s.evTime).toBeCloseTo(40 / (7 + k), 12);
    const h = hourly(s, 80, null);
    expect(h.evHour).toBeCloseTo((80 * 40) / (7 + k), 9);
    expect(h.exitsPerHour).toBeCloseTo(80 / (7 + k), 9);
    expect(h.playedPerHour).toBeCloseTo((80 * 7) / (7 + k), 9);
    // Per played round nothing changes: EV, SD, N0 in rounds, DI.
    expect(s.ev).toBe(free.ev);
    expect(s.sd).toBe(free.sd);
    expect(hourly(s, 80, null).di).toBeCloseTo(hourly(free, 80, null).di, 12);
  });

  it('"rounds played" is the share of the rounds dealt, not 100% for a wong-out', () => {
    expect(summarize(a).playedShare).toBeCloseTo(7 / 10, 12);
  });

  it('the interval takes each shoe\'s time, exits included, in the ratio estimator', () => {
    const k = 4;
    const t = [3 + k, 4];
    const y = [30, 10];
    const r = 40 / (7 + k);
    const resid = (y[0]! - r * t[0]!) ** 2 + (y[1]! - r * t[1]!) ** 2;
    expect(summarize(a, k).seTime).toBeCloseTo(Math.sqrt(resid * 2) / (7 + k), 12);
  });

  it('the best method and the stopping rule both pay for exits', () => {
    // A: +1 a round, never leaves. B: +2 a round over 3 rounds, then leaves every shoe.
    const A = accumOf([[1, 1, 1], [1, 1, 1]]);
    const B = accumOf([[2, 2, 2, 'exit'], [2, 2, 2, 'exit']]);
    expect(bestIndex([A, B], 0)).toBe(1);
    // An exit worth 4 rounds: B makes 12 in 14 rounds of time, A 6 in 6.
    expect(bestIndex([A, B], 4)).toBe(0);
    // The stopping rule's error grows with the exit cost when exits vary from shoe to shoe.
    const C = accumOf([[3, 1, 'exit'], [1, 3, 2, 2], [2, 'exit'], [2, 2, 1, 3]]);
    expect(summarize(C, 10).seTime / summarize(C, 10).evTime).toBeGreaterThan(summarize(C, 0).seTime / summarize(C, 0).evTime);
    expect(evPrecise(C, 0)).not.toBe(evPrecise(C, 50));
  });

  it('a result stored before exits were counted reads as no exits', () => {
    const old = { ...accumOf([[1, 2]]) } as Partial<Accum>;
    delete old.exits;
    delete old.se2;
    delete old.sey;
    delete old.sxe;
    delete old.dealt;
    const s = summarize(old as Accum, 10);
    expect(s.time).toBe(2);
    expect(s.playedShare).toBe(1);
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
    const run = runGame(spec, { seed: 1, timeCapMs: 1000, now: () => t, basicChunk: 50_000, countChunk: 50_000 });
    const seen: number[] = [];
    let step = run.next();
    while (!step.done) {
      seen.push(step.value.fraction);
      t += 300; // each chunk "takes" 300 ms
      step = run.next();
    }
    expect(step.value.status).toBe('time');
    expect(step.value.basicRounds).toBe(MIN_ROUNDS);
    expect(seen.length).toBe(4);
    expect(seen.every((f) => f > 0 && f < 1)).toBe(true);
  });

  it('review S3: the time cap does not end a run short of the minimum rounds', () => {
    let t = 0;
    // The cap passes after two chunks (100k rounds); the run carries on to the floor, then stops on the clock.
    const run = runGame(spec, { seed: 1, timeCapMs: 500, now: () => t, basicChunk: 50_000, countChunk: 50_000 });
    let step = run.next();
    while (!step.done) {
      t += 300;
      step = run.next();
    }
    expect(step.value.status).toBe('time');
    expect(step.value.basicRounds).toBe(MIN_ROUNDS);
    expect(step.value.countRounds).toBe(MIN_ROUNDS);
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
