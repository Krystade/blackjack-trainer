import { describe, it, expect } from 'vitest';
import {
  AUTO_CAP_MS,
  newEditTracker,
  noteKeys,
  orderCandidates,
  pickJob,
  shouldPreempt,
  workCounts,
  workFor,
  type AutoCandidate,
} from './casinoAutoSim';
import { buildRanking } from './casinoRanking';
import { simInputFor, type GameResult } from '../store/casinoGameStats';
import { blankGame, emptyCasinoLog, type Casino, type CasinoGame } from '../store/casinoLog';
import { makeDefaultProfile } from '../store/profiles';
import { emptyAccum } from '../engine/casinoSim';

/** Wave Q: the plan the automatic runs follow. Pure; simRunner.test.ts drives the runner itself. */

const profile = makeDefaultProfile();

function result(over: Partial<GameResult> = {}): GameResult {
  return {
    key: 'k',
    computedAt: '2026-10-20T00:00:00Z',
    profileName: 'p',
    status: 'partial',
    ms: 100,
    basicRounds: 200_000,
    countRounds: 200_000,
    unit: 25,
    basic: emptyAccum(),
    methods: null,
    ...over,
  };
}

function cand(gameId: string, key = `key-${gameId}`): AutoCandidate {
  const input = simInputFor(blankGame(gameId), profile, []);
  return { gameId, input: { ...input, key }, exitRounds: 0, profileName: 'p' };
}

describe('workFor', () => {
  it('a first estimate with nothing; more rounds while unfinished and under the cap; nothing once finished', () => {
    expect(workFor(undefined)).toBe('first');
    expect(workFor(result({ status: 'partial', ms: AUTO_CAP_MS - 1 }))).toBe('refine');
    expect(workFor(result({ status: 'partial', ms: AUTO_CAP_MS }))).toBeNull();
    // A build before Wave Q's hand-stopped run is continued too.
    expect(workFor(result({ status: 'cancelled', ms: 5000 }))).toBe('refine');
    for (const status of ['done', 'time', 'budget'] as const) expect(workFor(result({ status, ms: 10 })), status).toBeNull();
    // "Run another minute" raised the cap.
    expect(workFor(result({ status: 'partial', ms: AUTO_CAP_MS, capMs: 2 * AUTO_CAP_MS }))).toBe('refine');
  });
});

describe('pickJob', () => {
  const a = cand('a');
  const b = cand('b');
  const c = cand('c');
  const stored = (m: Record<string, GameResult | undefined>) => (x: AutoCandidate) => m[x.gameId];

  it("every game's first estimate before any refining, each in the plan's order", () => {
    const lookup = stored({ a: result({ key: 'key-a' }), b: undefined, c: undefined });
    const j = pickJob([a, b, c], lookup, null)!;
    expect(j.cand.gameId).toBe('b');
    expect(j.work).toBe('first');
    expect(j.prior).toBeUndefined();
    const all = stored({ a: result({ key: 'key-a' }), b: result({ key: 'key-b' }), c: result({ key: 'key-c', status: 'done' }) });
    const r = pickJob([a, b, c], all, null)!;
    expect([r.cand.gameId, r.work]).toEqual(['a', 'refine']);
    expect(r.prior?.key).toBe('key-a');
  });

  it("the open card's game goes first, refining or not", () => {
    const lookup = stored({ a: undefined, b: undefined, c: result({ key: 'key-c' }) });
    expect(pickJob([a, b, c], lookup, 'c')!.cand.gameId).toBe('c');
    // Nothing left to do for the open game: the plan carries on.
    expect(pickJob([a, b, c], stored({ c: result({ status: 'done' }) }), 'c')!.cand.gameId).toBe('a');
  });

  it('nothing to do is null; a failed key is passed over', () => {
    const done = stored({ a: result({ status: 'done' }), b: result({ status: 'time' }), c: result({ status: 'budget' }) });
    expect(pickJob([a, b, c], done, null)).toBeNull();
    expect(pickJob([a, b], stored({}), null, new Set(['key-a']))!.cand.gameId).toBe('b');
    expect(pickJob([], stored({}), null)).toBeNull();
  });

  it('counts what is left, by kind', () => {
    expect(workCounts([a, b, c], stored({ a: result(), b: result({ status: 'done' }) }))).toEqual({ first: 1, refine: 1 });
  });
});

describe('shouldPreempt', () => {
  const first = { cand: cand('x'), work: 'first' as const, prior: undefined };
  const refine = { cand: cand('x'), work: 'refine' as const, prior: result() };
  const run = (work: 'first' | 'refine', gameId = 'r', key = 'key-r') => ({ gameId, key, work });

  it('the open card, or a first estimate over a refine; never the same inputs; never a refine over a first', () => {
    expect(shouldPreempt(run('refine'), first, null)).toBe(true);
    expect(shouldPreempt(run('first'), first, null)).toBe(false);
    expect(shouldPreempt(run('first'), refine, null)).toBe(false);
    expect(shouldPreempt(run('refine'), refine, null)).toBe(false);
    expect(shouldPreempt(run('first'), refine, 'x')).toBe(true);
    // The run in progress is for the open card's inputs (a twin game): left alone.
    expect(shouldPreempt(run('refine', 'twin', 'key-x'), first, 'x')).toBe(false);
  });
});

describe('orderCandidates and noteKeys', () => {
  const g = (id: string, over: Partial<CasinoGame> = {}): CasinoGame => ({ ...blankGame(id), decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1, minBet: 25, ...over });
  const casino = (id: string, games: CasinoGame[], over: Partial<Casino> = {}): Casino => ({
    id,
    name: id,
    games,
    status: 'ok',
    notes: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  });
  const log = {
    ...emptyCasinoLog(),
    casinos: [
      casino('c1', [g('g1'), g('g2', { s17: true })]),
      casino('c2', [g('g3', { minBet: 10 })], { status: 'avoid' }),
      casino('c3', [g('g4', { minBet: 15 }), g('gv', { variant: 'freebet' })]),
    ],
  };
  const rows = buildRanking(log, profile, {}, Date.parse('2026-10-20T12:00:00'), null, 'ev');

  it('playable before Avoid, the ranking order within, variants left out', () => {
    expect(orderCandidates(rows, new Map(), 'p').map((c) => c.gameId)).toEqual(['g1', 'g2', 'g4', 'g3']);
  });

  it('the most recently changed inputs first', () => {
    const t = newEditTracker();
    const keys = () => rows.map((r) => ({ id: r.game.id, key: r.input.key }));
    noteKeys(t, keys());
    // The first look marks nothing.
    expect(t.editedAt.size).toBe(0);
    noteKeys(t, keys());
    expect(t.editedAt.size).toBe(0);
    noteKeys(t, keys().map((k) => (k.id === 'g4' ? { ...k, key: 'edited' } : k)));
    const both = keys().map((k) => (k.id === 'g4' ? { ...k, key: 'edited' } : k.id === 'g2' ? { ...k, key: 'edited too' } : k));
    noteKeys(t, both);
    expect(orderCandidates(rows, t.editedAt, 'p').map((c) => c.gameId)).toEqual(['g2', 'g4', 'g1', 'g3']);
    // A game that appears after the first look (added, imported) counts as changed; the others, unchanged, keep their marks.
    noteKeys(t, [...both, { id: 'new', key: 'n' }]);
    expect(t.editedAt.get('new')).toBeGreaterThan(t.editedAt.get('g2')!);
    expect(t.editedAt.get('g2')).toBeGreaterThan(t.editedAt.get('g4')!);
  });
});
