import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MULBERRY32_STEP, mulberry32 } from './cards';
import { CasinoSim, type SimSpec } from './casinoSim';
import { runGame, type RunOptions, type RunProgress } from './casinoRun';
import { DEFAULT_SPREAD } from './game';

/**
 * Wave Q re-review R1: a run that continues a game carries on each of its
 * streams exactly where the last run left it, so no two runs of a game deal
 * the same draw -- however long either was, and however many runs there are.
 *
 * Every mulberry32 the simulator makes is recorded here: its seed, and the
 * state of every draw it takes (the state steps by MULBERRY32_STEP per draw),
 * so "the same draw" is checked as the same point on the generator's cycle.
 */
const made = vi.hoisted(() => [] as { seed: number; states: number[] }[]);

vi.mock('./cards', async (orig) => {
  const real = await orig<typeof import('./cards')>();
  return {
    ...real,
    mulberry32: (seed: number) => {
      const rec = { seed: seed >>> 0, states: [] as number[] };
      made.push(rec);
      const rng = real.mulberry32(seed);
      let state = seed >>> 0;
      return () => {
        state = (state + real.MULBERRY32_STEP) >>> 0;
        rec.states.push(state);
        return rng();
      };
    },
  };
});

beforeEach(() => {
  made.length = 0;
});

const SHOE: SimSpec = {
  rules: { decks: 2, s17: false, das: true, ls: true, rsa: false, bj65: false },
  cutDecks: 0.75,
  csm: false,
  unit: 25,
  maxBet: null,
  spread: DEFAULT_SPREAD,
  tcRounding: 'floor',
  indices: true,
  methods: [
    { id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null },
    { id: 'wong-1', entryTc: null, exitTc: -1, rampStartTc: null },
  ],
};
const CSM: SimSpec = { ...SHOE, rules: { ...SHOE.rules, decks: 6 }, cutDecks: 1, csm: true };

function finish(spec: SimSpec, opts: Omit<RunOptions, 'now' | 'timeCapMs'>): RunProgress {
  const run = runGame(spec, { now: () => 0, timeCapMs: 1e12, ...opts });
  let s = run.next();
  while (!s.done) s = run.next();
  return s.value;
}

/** Every state drawn by a generator seeded with `seed`, since the last `clear`. */
const drawn = (seed: number) => new Set(made.filter((m) => m.seed === seed >>> 0).flatMap((m) => m.states));

describe('CasinoSim.nextSeed', () => {
  for (const [name, spec] of [
    ['a shoe game', SHOE],
    ['a continuous shuffler', CSM],
  ] as const) {
    for (const mode of ['basic', 'count'] as const) {
      it(`${name}, ${mode}: carries on the seed's stream from its last draw`, () => {
        const seed = 0x9e3779b1;
        const sim = new CasinoSim(spec, mode, seed);
        sim.run(3000);
        const states = drawn(seed);
        // Every draw any generator of this seed took is counted, and nothing more: the stream is one run of states.
        expect(sim.draws).toBe(states.size);
        expect(sim.draws).toBeGreaterThan(3000);
        const last = (seed + Math.imul(sim.draws, MULBERRY32_STEP)) >>> 0;
        expect(states.has(last)).toBe(true);
        expect(sim.nextSeed()).toBe(last);
        // A fresh generator of the next seed deals what the stream would have dealt next.
        const on = mulberry32(seed);
        for (let i = 0; i < sim.draws; i++) on();
        expect(mulberry32(sim.nextSeed())()).toBe(on());
      });
    }
  }
});

describe('runGame: a continued run deals none of the earlier draws', () => {
  for (const [name, spec] of [
    ['a two-deck shoe', SHOE],
    ['a continuous shuffler', CSM],
  ] as const) {
    it(`${name}: four runs, each starting where the last stopped, never overlapping`, () => {
      let p = finish(spec, { seed: 12345, maxRounds: 20_000 });
      const runs: { basic: Set<number>; count: Set<number> }[] = [];
      let seeds = { basic: 12345, count: (12345 ^ 0x9e3779b9) >>> 0 };
      runs.push({ basic: drawn(seeds.basic), count: spec.csm ? new Set() : drawn(seeds.count) });
      for (let n = 1; n < 4; n++) {
        const at = p.seeds;
        // The streams went on exactly as far as they were dealt.
        expect(at.basic).toBe((seeds.basic + Math.imul(runs[n - 1]!.basic.size, MULBERRY32_STEP)) >>> 0);
        if (spec.csm) expect(at.count).toBe(seeds.count);
        else expect(at.count).toBe((seeds.count + Math.imul(runs[n - 1]!.count.size, MULBERRY32_STEP)) >>> 0);
        made.length = 0;
        p = finish(spec, { seed: at.basic, countSeed: at.count, maxRounds: 20_000 * (n + 1), prior: { basic: p.basic, methods: p.methods, basicRounds: p.basicRounds, countRounds: p.countRounds, ms: p.ms } });
        seeds = at;
        runs.push({ basic: drawn(at.basic), count: spec.csm ? new Set() : drawn(at.count) });
        expect(runs[n]!.basic.size).toBeGreaterThan(0);
      }
      for (const stream of ['basic', 'count'] as const) {
        const all = runs.flatMap((r) => [...r[stream]]);
        expect(new Set(all).size, stream).toBe(all.length);
      }
    });
  }
});
