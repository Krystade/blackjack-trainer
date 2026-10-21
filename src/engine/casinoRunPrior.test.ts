import { describe, it, expect } from 'vitest';
import { emptyAccum, mergeAccum, type Accum, type SimSpec } from './casinoSim';
import { MIN_ROUNDS, runGame, type RunOptions, type RunProgress } from './casinoRun';
import { DEFAULT_SPREAD } from './game';

/**
 * Wave Q: a run that continues an earlier one (casinoRun.ts `prior`) lands
 * exactly where the two runs' sums added together would, and every target,
 * cap and budget is judged on the total.
 */

const SPEC: SimSpec = {
  rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
  cutDecks: 1,
  csm: false,
  unit: 25,
  maxBet: null,
  spread: DEFAULT_SPREAD,
  tcRounding: 'floor',
  indices: true,
  methods: [
    { id: 'flat', flat: true, entryTc: null, exitTc: null, rampStartTc: null },
    { id: 'ramp', entryTc: null, exitTc: null, rampStartTc: null },
    { id: 'wong-1', entryTc: null, exitTc: -1, rampStartTc: null },
  ],
};

function finish(opts: Omit<RunOptions, 'now'> & { now?: () => number }, spec: SimSpec = SPEC): { last: RunProgress; steps: RunProgress[] } {
  const run = runGame(spec, { now: () => 0, ...opts });
  const steps: RunProgress[] = [];
  let s = run.next();
  while (!s.done) {
    steps.push(s.value);
    s = run.next();
  }
  return { last: s.value, steps };
}

const prior = (p: RunProgress) => ({ basic: p.basic, methods: p.methods, basicRounds: p.basicRounds, countRounds: p.countRounds, ms: p.ms });

describe('mergeAccum', () => {
  it('adds every field, and reads an absent one as 0', () => {
    const a: Accum = { observed: 1, played: 2, exits: 3, dealt: 4, twoHands: 5, net: 6, net2: 7, wagered: 8, sy2: 9, sxy: 10, sx2: 11, se2: 12, sey: 13, sxe: 14, shoes: 15 };
    const b: Accum = { ...emptyAccum(), observed: 100, net: -6, shoes: 1 };
    const m = mergeAccum(a, b);
    expect(m).toEqual({ ...a, observed: 101, net: 0, shoes: 16 });
    // Every field of the type is covered: a field left out of the merge would read 0 here.
    for (const k of Object.keys(emptyAccum()) as (keyof Accum)[]) expect(mergeAccum(a, a)[k], k).toBe(2 * a[k]);
    const legacy = { observed: 5, played: 5, net: 1, net2: 1, wagered: 5, sy2: 1, sxy: 1, sx2: 25, shoes: 1 } as unknown as Accum;
    expect(mergeAccum(legacy, emptyAccum()).exits).toBe(0);
  });
});

describe('runGame with a prior run', () => {
  it('reports the two runs added: the same sums as each run alone, merged', () => {
    const a = finish({ seed: 1, timeCapMs: 1e9, maxRounds: 100_000 }).last;
    const b = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 100_000 }).last;
    const m = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 200_000, prior: prior(a) }).last;
    expect(a.basicRounds).toBe(100_000);
    expect(m.basicRounds).toBe(200_000);
    expect(m.countRounds).toBe(200_000);
    expect(m.basic).toEqual(mergeAccum(a.basic, b.basic));
    expect(m.methods!.map((x) => x.acc)).toEqual(a.methods!.map((x, i) => mergeAccum(x.acc, b.methods![i]!.acc)));
    expect(m.methods!.map((x) => x.method.id)).toEqual(['flat', 'ramp', 'wong-1']);
    // A different seed really dealt different rounds (the merge is not a doubling).
    expect(b.basic.net).not.toBe(a.basic.net);
  });

  it('judges the floor on the total: a prior past it lets the clock stop the run at once', () => {
    const a = finish({ seed: 1, timeCapMs: 1e9, maxRounds: MIN_ROUNDS }).last;
    let t = 0;
    const run = runGame(SPEC, { seed: 9, timeCapMs: 1000, now: () => t, prior: { ...prior(a), ms: 900 } });
    let s = run.next();
    let chunks = 0;
    while (!s.done) {
      chunks += 1;
      t += 200; // past the 1000 ms cap after one chunk, counting the prior's 900
      s = run.next();
    }
    expect(s.value.status).toBe('time');
    expect(chunks).toBe(1);
    expect(s.value.ms).toBe(1100);
    expect(s.value.basicRounds).toBe(MIN_ROUNDS + 50_000);
    // Without the prior's time the same clock runs far longer.
    t = 0;
    const fresh = runGame(SPEC, { seed: 9, timeCapMs: 1000, now: () => t });
    let f = fresh.next();
    let freshChunks = 0;
    while (!f.done) {
      freshChunks += 1;
      t += 200;
      f = fresh.next();
    }
    expect(freshChunks).toBeGreaterThan(chunks);
  });

  it('a prior already at the budget returns at once, unchanged', () => {
    const a = finish({ seed: 1, timeCapMs: 1e9, maxRounds: 50_000 }).last;
    const { last, steps } = finish({ seed: 3, timeCapMs: 1e9, maxRounds: 50_000, prior: prior(a) });
    expect(steps).toHaveLength(0);
    expect(last.status).toBe('budget');
    expect(last.basic).toEqual(a.basic);
  });

  it('ignores a prior from other methods (the key should prevent it; this is the backstop)', () => {
    const a = finish({ seed: 1, timeCapMs: 1e9, maxRounds: 50_000 }).last;
    const other = { ...SPEC, methods: [SPEC.methods[1]!, SPEC.methods[0]!, SPEC.methods[2]!] };
    const m = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 50_000, prior: prior(a) }, other).last;
    expect(m.basicRounds).toBe(50_000);
    const alone = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 50_000 }, other).last;
    expect(m.basic).toEqual(alone.basic);
  });

  it('a continuous shuffler continues on its house edge alone', () => {
    const csm = { ...SPEC, csm: true, methods: [] };
    const a = finish({ seed: 1, timeCapMs: 1e9, maxRounds: 50_000 }, csm).last;
    const b = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 50_000 }, csm).last;
    const m = finish({ seed: 2, timeCapMs: 1e9, maxRounds: 100_000, prior: prior(a) }, csm).last;
    expect(m.methods).toBeNull();
    expect(m.basic).toEqual(mergeAccum(a.basic, b.basic));
  });
});
