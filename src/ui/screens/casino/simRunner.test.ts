import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CHECKPOINT_MS,
  _resetRunner,
  _setHidden,
  _setWorkerFactory,
  attachAuto,
  canRunLonger,
  runAnotherMinute,
  runnerState,
  setAutoPlan,
} from './simRunner';
import { AUTO_CAP_MS, EXTEND_MS, QUICK_ROUNDS, type AutoCandidate } from '../../casinoAutoSim';
import { _setGameStatsStorage, loadGameResults, runSeed, saveGameResult, simInputFor } from '../../../store/casinoGameStats';
import { blankGame, type CasinoGame } from '../../../store/casinoLog';
import { makeDefaultProfile } from '../../../store/profiles';
import { emptyAccum, type Accum } from '../../../engine/casinoSim';
import type { RunProgress } from '../../../engine/casinoRun';
import type { SimMessage, SimRequest } from './casinoSim.worker';

/**
 * Wave Q: the runner that works every game out on its own, driven with a fake
 * worker: what it asks for, in what order, what it keeps when it stops, and
 * that it stops at all when Casino closes or the page is hidden.
 */

class FakeWorker {
  posted: SimRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<SimMessage>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(req: SimRequest): void {
    this.posted.push(req);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(msg: SimMessage): void {
    this.onmessage?.({ data: msg } as MessageEvent<SimMessage>);
  }
}

let workers: FakeWorker[] = [];
const live = () => workers.filter((w) => !w.terminated);
const lastReq = () => workers[workers.length - 1]!.posted.at(-1)!;

const profile = makeDefaultProfile();
const game = (id: string, over: Partial<CasinoGame> = {}): CasinoGame => ({ ...blankGame(id), decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1, minBet: 25, ...over });
const cand = (g: CasinoGame): AutoCandidate => ({ gameId: g.id, input: simInputFor(g, profile, []), exitRounds: 0, profileName: profile.name });

const A = cand(game('ga'));
const B = cand(game('gb', { s17: true }));
const C = cand(game('gc', { minBet: 10 }));

function acc(net: number): Accum {
  return { ...emptyAccum(), observed: 10, played: 10, dealt: 10, net, net2: 100, wagered: 250, shoes: 1, sx2: 100, sy2: net * net, sxy: 10 * net };
}

function progress(job: { methods: number }, over: Partial<RunProgress> = {}): RunProgress {
  return {
    status: 'running',
    basic: acc(-1),
    methods: Array.from({ length: job.methods }, (_, i) => ({ method: A.input.methods[i]!, acc: acc(i) })),
    basicRounds: QUICK_ROUNDS,
    countRounds: QUICK_ROUNDS,
    ms: 120,
    fraction: 0.5,
    seeds: { basic: 0x1234, count: 0x5678 },
    ...over,
  };
}
const M = A.input.methods.length;

let mem: Map<string, string>;
beforeEach(() => {
  mem = new Map();
  _setGameStatsStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  _resetRunner();
  workers = [];
  _setWorkerFactory(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as unknown as Worker;
  });
  delete (globalThis as { __bjCasinoSimBudget?: number }).__bjCasinoSimBudget;
});

afterEach(() => {
  _resetRunner();
  _setWorkerFactory(null);
  _setGameStatsStorage(null);
});

/** Finish the job in progress as a quick first pass does. */
const finishFirst = () => live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'budget' }) });

describe('the automatic runner', () => {
  it('runs nothing until a Casino screen is up, then a first estimate for every game, then refines, in order', () => {
    setAutoPlan([A, B], null);
    expect(workers).toHaveLength(0);
    expect(runnerState().paused).toBe(true);
    attachAuto();
    expect(runnerState().paused).toBe(false);
    // A first pass: the input's own seed, the quick round count, no prior.
    let req = lastReq();
    expect(req.seed).toBe(A.input.seed);
    expect(req.countSeed).toBeUndefined();
    expect(req.maxRounds).toBe(QUICK_ROUNDS);
    expect(req.prior).toBeUndefined();
    expect(runnerState().running).toMatchObject({ gameId: 'ga', work: 'first' });
    expect(runnerState().todo).toEqual({ first: 2, refine: 0 });
    finishFirst();
    // Stored as an estimate (more to come), and the next game's first pass starts on the same worker.
    expect(loadGameResults().ga).toMatchObject({ key: A.input.key, status: 'partial', runs: 1, basicRounds: QUICK_ROUNDS, nextSeeds: { basic: 0x1234, count: 0x5678 } });
    expect(workers).toHaveLength(1);
    req = lastReq();
    expect(req.seed).toBe(B.input.seed);
    expect(req.maxRounds).toBe(QUICK_ROUNDS);
    finishFirst();
    // Then A again, continuing its estimate: each stream carried on where the first pass left it (re-review R1),
    // its sums as the prior, the minute cap, no round budget.
    req = lastReq();
    expect(req.spec).toEqual(A.input.spec);
    expect([req.seed, req.countSeed]).toEqual([0x1234, 0x5678]);
    expect(req.prior).toMatchObject({ basicRounds: QUICK_ROUNDS, ms: 120 });
    expect(req.timeCapMs).toBe(AUTO_CAP_MS);
    expect(req.maxRounds).toBeUndefined();
    expect(runnerState().running).toMatchObject({ gameId: 'ga', work: 'refine' });
    expect(runnerState().todo).toEqual({ first: 0, refine: 2 });
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'done', basicRounds: 20e6, ms: 9000 }) });
    expect(loadGameResults().ga).toMatchObject({ status: 'done', runs: 2, basicRounds: 20e6, ms: 9000 });
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'time', ms: AUTO_CAP_MS }) });
    expect(loadGameResults().gb).toMatchObject({ status: 'time' });
    // Nothing left: idle, and nothing more asked of the worker.
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
    expect(workers[0]!.posted).toHaveLength(4);
  });

  it('stops when the page is hidden, keeping a refine; resumes from it when shown', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    const w = live()[0]!;
    w.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 900_000, countRounds: 700_000, ms: 4000, seeds: { basic: 0xabc, count: 0xdef } }) });
    _setHidden(true);
    expect(w.terminated).toBe(true);
    expect(live()).toHaveLength(0);
    expect(runnerState()).toMatchObject({ running: null, paused: true });
    // What it had is kept, as an estimate, with its time.
    expect(loadGameResults().ga).toMatchObject({ status: 'partial', basicRounds: 900_000, countRounds: 700_000, ms: 4000, runs: 2 });
    _setHidden(false);
    const req = lastReq();
    expect(workers).toHaveLength(2);
    expect(req.prior).toMatchObject({ basicRounds: 900_000, ms: 4000 });
    expect([req.seed, req.countSeed]).toEqual([0xabc, 0xdef]);
  });

  it('re-review R1: a result saved before the continuation seeds is continued from runSeed', () => {
    const p = progress({ methods: M });
    saveGameResult('ga', { key: A.input.key, computedAt: '2026-01-01T00:00:00.000Z', profileName: profile.name, status: 'partial', ms: p.ms, basicRounds: p.basicRounds, countRounds: p.countRounds, unit: A.input.spec.unit, basic: p.basic, methods: p.methods, runs: 3 });
    setAutoPlan([A], null);
    attachAuto();
    const req = lastReq();
    expect(req.prior).toMatchObject({ basicRounds: QUICK_ROUNDS });
    expect(req.seed).toBe(runSeed(A.input, 3));
    expect(req.countSeed).toBeUndefined();
  });

  it('a first pass stopped short of the floor keeps nothing (review S3), and starts again', () => {
    setAutoPlan([A], null);
    const detach = attachAuto();
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 50_000, countRounds: 25_000 }) });
    detach();
    expect(loadGameResults().ga).toBeUndefined();
    expect(live()).toHaveLength(0);
    attachAuto();
    expect(lastReq()).toMatchObject({ seed: A.input.seed, maxRounds: QUICK_ROUNDS });
  });

  it("the open card's game, and a game with no estimate, cut in; the stopped run keeps its rounds", () => {
    setAutoPlan([A, B, C], null);
    attachAuto();
    finishFirst();
    finishFirst();
    finishFirst();
    // Refining A.
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 400_000, ms: 1500 }) });
    setAutoPlan([A, B, C], 'gc');
    expect(runnerState().running).toMatchObject({ gameId: 'gc', work: 'refine' });
    expect(loadGameResults().ga).toMatchObject({ basicRounds: 400_000, ms: 1500, status: 'partial' });
    // A new game (just added) has no estimate: it cuts in ahead of refining, but not ahead of the open card.
    const D = cand(game('gd', { minBet: 5 }));
    setAutoPlan([D, A, B, C], 'gc');
    expect(runnerState().running).toMatchObject({ gameId: 'gc' });
    setAutoPlan([D, A, B, C], null);
    expect(runnerState().running).toMatchObject({ gameId: 'gd', work: 'first' });
    // A first pass is not cut into by refining.
    setAutoPlan([A, D, B, C], null);
    expect(runnerState().running).toMatchObject({ gameId: 'gd' });
  });

  it('a game whose inputs changed mid-run: that run is thrown away, the new inputs start', () => {
    setAutoPlan([A], null);
    attachAuto();
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }) });
    const edited = cand(game('ga', { s17: true, minBet: 15 }));
    setAutoPlan([edited], null);
    expect(workers[0]!.terminated).toBe(true);
    expect(loadGameResults().ga).toBeUndefined();
    expect(lastReq().spec).toEqual(edited.input.spec);
    expect(runnerState().running?.key).toBe(edited.input.key);
  });

  it('two games dealt alike are worked out once', () => {
    const twin = cand(game('gt'));
    expect(twin.input.key).toBe(A.input.key);
    setAutoPlan([A, twin], null);
    attachAuto();
    finishFirst();
    // The twin's first estimate is A's: next up is refining, not a second first pass.
    expect(runnerState().running).toMatchObject({ work: 'refine' });
    // One run to make for the two (review N5).
    expect(runnerState().todo).toEqual({ first: 0, refine: 1 });
  });

  it('a long refine is saved as it goes', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    const w = live()[0]!;
    w.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 300_000, ms: 120 + CHECKPOINT_MS - 1 }) });
    expect(loadGameResults().ga).toMatchObject({ basicRounds: QUICK_ROUNDS });
    w.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 600_000, ms: 120 + CHECKPOINT_MS }) });
    expect(loadGameResults().ga).toMatchObject({ basicRounds: 600_000, status: 'partial' });
    expect(w.terminated).toBe(false);
  });

  it('stops at the cap; "Run another minute" raises it and the runner carries on from there', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'time', ms: AUTO_CAP_MS + 30 }) });
    const r = loadGameResults().ga!;
    expect(r.status).toBe('time');
    expect(runnerState().running).toBeNull();
    expect(canRunLonger(r, A.input.spec)).toBe(true);
    runAnotherMinute('ga', r);
    expect(loadGameResults().ga).toMatchObject({ status: 'partial', capMs: AUTO_CAP_MS + 30 + EXTEND_MS });
    expect(lastReq()).toMatchObject({ timeCapMs: AUTO_CAP_MS + 30 + EXTEND_MS, prior: { ms: AUTO_CAP_MS + 30 } });
    // The raised cap survives the next save.
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'time', ms: AUTO_CAP_MS + 30 + EXTEND_MS }) });
    expect(loadGameResults().ga).toMatchObject({ status: 'time', capMs: AUTO_CAP_MS + 30 + EXTEND_MS });
    // Never past five minutes.
    expect(canRunLonger({ ...r, ms: 5 * 60_000 }, A.input.spec)).toBe(false);
    expect(canRunLonger({ ...r, status: 'partial' }, A.input.spec)).toBe(false);
    // Review S1: a count at its round ceiling (the edge settled too) gets no button: another minute adds no rounds.
    expect(canRunLonger({ ...r, status: 'done', countRounds: 30_000_000, basicRounds: 60_000_000 }, A.input.spec)).toBe(false);
  });

  it('the e2e round budget: a first pass at the budget is final', () => {
    (globalThis as { __bjCasinoSimBudget?: number }).__bjCasinoSimBudget = 4000;
    setAutoPlan([A], null);
    attachAuto();
    expect(lastReq().maxRounds).toBe(4000);
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'budget', basicRounds: 4000, countRounds: 4000 }) });
    expect(loadGameResults().ga!.status).toBe('budget');
    expect(runnerState().running).toBeNull();
  });

  it('a run that fails is reported and not retried; the others go on', () => {
    setAutoPlan([A, B], null);
    attachAuto();
    live()[0]!.emit({ type: 'error', message: 'boom' });
    expect(runnerState().error).toBe('boom');
    expect(runnerState().failed).toEqual({ [A.input.key]: 'boom' });
    expect(runnerState().running).toMatchObject({ gameId: 'gb' });
    // Review S2: the failed game is not counted as work to come.
    expect(runnerState().todo).toEqual({ first: 1, refine: 0 });
    finishFirst();
    // A is not tried again; B is refined.
    expect(runnerState().running).toMatchObject({ gameId: 'gb', work: 'refine' });
    live()[0]!.emit({ type: 'done', progress: progress({ methods: M }, { status: 'done' }) });
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
  });

  it('a worker that cannot start fails every game, each with the message, and nothing is left pending', () => {
    _setWorkerFactory(() => {
      throw new Error('no workers here');
    });
    setAutoPlan([A, B], null);
    attachAuto();
    expect(runnerState().failed).toEqual({ [A.input.key]: 'no workers here', [B.input.key]: 'no workers here' });
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
  });
});

describe('review B1: storage full', () => {
  const quota = () => {
    const e = new Error('The quota has been exceeded.');
    e.name = 'QuotaExceededError';
    throw e;
  };

  it('a first pass that cannot be saved is shown, said, and not run again', () => {
    _setGameStatsStorage({ getItem: () => null, setItem: quota });
    setAutoPlan([A, B], null);
    attachAuto();
    expect(lastReq().spec).toEqual(A.input.spec);
    finishFirst();
    // The next game, not the same one again.
    expect(lastReq().spec).toEqual(B.input.spec);
    finishFirst();
    const all = workers.flatMap((w) => w.posted);
    expect(all).toHaveLength(2);
    // Both are first passes (partial): refining them would fail to save too, so nothing more runs.
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
    expect(runnerState().storageFull).toBe(true);
    // The figures are there for this session.
    expect(loadGameResults()[A.gameId]?.key).toBe(A.input.key);
    expect(loadGameResults()[B.gameId]?.status).toBe('partial');
  });

  it('a refine whose checkpoint cannot be saved is not started again once stopped', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    expect(lastReq().prior).toBeDefined();
    _setGameStatsStorage({ getItem: (k) => mem.get(k) ?? null, setItem: quota });
    const w = live()[0]!;
    w.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 900_000, ms: 120 + CHECKPOINT_MS }) });
    // Paused (its save fails too) and shown again: still under its cap, but not run again.
    _setHidden(true);
    expect(runnerState().storageFull).toBe(true);
    expect(loadGameResults()[A.gameId]).toMatchObject({ status: 'partial', basicRounds: 900_000 });
    _setHidden(false);
    expect(workers.flatMap((x) => x.posted)).toHaveLength(2);
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
  });
});

describe('a casino session running: estimates only', () => {
  it('first estimates are made; the firming up waits for the session to end, then carries on', () => {
    setAutoPlan([A, B], null, { sessionRunning: true });
    attachAuto();
    finishFirst();
    expect(lastReq().spec).toEqual(B.input.spec);
    finishFirst();
    // Both estimated: nothing more runs while the session does.
    expect(runnerState().running).toBeNull();
    expect(runnerState()).toMatchObject({ holdRefines: true, todo: { first: 0, refine: 2 } });
    expect(workers.flatMap((w) => w.posted)).toHaveLength(2);
    // Re-review ruling: the open card's game is firmed up all the same, from its estimate.
    setAutoPlan([A, B], 'gb', { sessionRunning: true });
    expect(runnerState().running).toMatchObject({ gameId: 'gb', work: 'refine' });
    expect(lastReq().prior).toMatchObject({ basicRounds: QUICK_ROUNDS });
    // Its card closed: it stops, keeping its rounds, and nothing else runs.
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 700_000, ms: 900 }) });
    setAutoPlan([A, B], null, { sessionRunning: true });
    expect(runnerState().running).toBeNull();
    expect(live()).toHaveLength(0);
    expect(loadGameResults().gb).toMatchObject({ status: 'partial', basicRounds: 700_000 });
    // The session ends: the rest is firmed up.
    setAutoPlan([A, B], null, { sessionRunning: false });
    expect(runnerState().running).toMatchObject({ work: 'refine' });
  });

  it("a session started while the open card's game is firming up leaves that run alone", () => {
    setAutoPlan([A], 'ga');
    attachAuto();
    finishFirst();
    expect(runnerState().running).toMatchObject({ gameId: 'ga', work: 'refine' });
    const posted = workers.flatMap((w) => w.posted).length;
    setAutoPlan([A], 'ga', { sessionRunning: true });
    expect(runnerState().running).toMatchObject({ gameId: 'ga', work: 'refine' });
    expect(live()).toHaveLength(1);
    expect(workers.flatMap((w) => w.posted)).toHaveLength(posted);
  });

  it('a session started mid-refine stops it, keeping its rounds; a game with no estimate still gets one', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 700_000, ms: 900 }) });
    setAutoPlan([A], null, { sessionRunning: true });
    expect(runnerState().running).toBeNull();
    expect(live()).toHaveLength(0);
    expect(loadGameResults().ga).toMatchObject({ status: 'partial', basicRounds: 700_000 });
    setAutoPlan([A, C], null, { sessionRunning: true });
    expect(runnerState().running).toMatchObject({ gameId: 'gc', work: 'first' });
  });
});

describe('review N1: a run paused at or past its cap is finished, not an estimate', () => {
  it('saved as time, and nothing more is scheduled for it', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 9_000_000, ms: AUTO_CAP_MS + 5 }) });
    _setHidden(true);
    expect(loadGameResults().ga).toMatchObject({ status: 'time', basicRounds: 9_000_000 });
    _setHidden(false);
    expect(runnerState().running).toBeNull();
    expect(runnerState().todo).toEqual({ first: 0, refine: 0 });
  });

  it('a pause short of the cap stays an estimate', () => {
    setAutoPlan([A], null);
    attachAuto();
    finishFirst();
    live()[0]!.emit({ type: 'progress', progress: progress({ methods: M }, { basicRounds: 900_000, ms: AUTO_CAP_MS - 1 }) });
    _setHidden(true);
    expect(loadGameResults().ga).toMatchObject({ status: 'partial', basicRounds: 900_000 });
  });
});
