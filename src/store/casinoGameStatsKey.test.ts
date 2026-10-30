import { describe, it, expect, beforeEach } from 'vitest';
import {
  ARCHIVE_MAX,
  pinGameKeys,
  GAME_STATS_KEY,
  SIM_VERSION,
  _setGameStatsStorage,
  fnv1a,
  relabel,
  gameStatsUnsaved,
  loadGameCache,
  loadGameArchive,
  loadGameResults,
  pruneGameResults,
  resultForKey,
  resultState,
  runSeed,
  SPACED_RUNS,
  saveGameResult,
  simInputFor,
  type GameResult,
} from './casinoGameStats';
import { blankGame, type CasinoGame } from './casinoLog';
import { makeDefaultProfile } from './profiles';
import { sideRowSpec, sideSpecKey } from './casinoSideRows';
import { emptyAccum } from '../engine/casinoSim';
import type { Profile } from './types';

/**
 * Wave Q: figures follow the rules on their own, so the cache key is the
 * whole contract: every input that changes a simulated round must change it
 * (or a stale figure would pass as current), and nothing else may (or a
 * figure would be worked out again for nothing, on a phone battery).
 */

const profile = makeDefaultProfile();
// Every rule logged, so no assumed value hides a change.
const GAME: CasinoGame = {
  ...blankGame('g1'),
  decks: 6,
  s17: false,
  das: true,
  surrender: true,
  payout: '3:2',
  cutDecksLeft: 1,
  minBet: 25,
  maxBet: 1000,
  midShoeEntry: 'allowed',
  csm: false,
  rsa: false,
  doubleSplitAces: false,
  maxSplitHands: 4,
  doubleOn: 'any2',
  commissionPer100: 0,
};
const key = (g: CasinoGame = GAME, p: Profile = profile, custom = [] as Parameters<typeof simInputFor>[2], kind?: 'casino' | 'cardroom') =>
  simInputFor(g, p, custom, kind).key;

describe('the cache key: every input of a simulated round changes it', () => {
  const base = key();
  const cases: [string, string][] = [
    ['decks 6 -> 8', key({ ...GAME, decks: 8 })],
    ['decks 6 -> 2', key({ ...GAME, decks: 2 })],
    ['decks 6 -> 4 (same chart, own shoe)', key({ ...GAME, decks: 4 })],
    ['decks 6 -> 5', key({ ...GAME, decks: 5 })],
    ['S17', key({ ...GAME, s17: true })],
    ['no DAS', key({ ...GAME, das: false })],
    ['no surrender', key({ ...GAME, surrender: false })],
    ['6:5', key({ ...GAME, payout: '6:5' })],
    ['RSA', key({ ...GAME, rsa: true })],
    ['double split aces', key({ ...GAME, doubleSplitAces: true })],
    ['split to 3', key({ ...GAME, maxSplitHands: 3 })],
    ['double 10-11', key({ ...GAME, doubleOn: '10-11' })],
    ['commission $1', key({ ...GAME, commissionPer100: 1 })],
    ['penetration (cut 1 -> 1.5)', key({ ...GAME, cutDecksLeft: 1.5 })],
    ['min bet', key({ ...GAME, minBet: 15 })],
    ['max bet', key({ ...GAME, maxBet: 500 })],
    ['no table max', key({ ...GAME, maxBet: null })],
    ['continuous shuffler', key({ ...GAME, csm: true })],
    ['no mid-shoe entry (back-counts dropped)', key({ ...GAME, midShoeEntry: 'no' })],
    ['ramp', key(GAME, { ...profile, spread: [{ minTc: -99, units: 1 }, { minTc: 2, units: 6 }] })],
    ['TC rounding', key(GAME, { ...profile, tcRounding: 'truncate' })],
    ['indices off', key(GAME, { ...profile, gradeDeviations: false })],
    ['surrender indices (the game offers LS)', key(GAME, { ...profile, surrenderIndices: true })],
    ['BJA extras (H17 game)', key(GAME, { ...profile, bjaExtras: true })],
    ['wong exit', key(GAME, { ...profile, wongExitTc: -3 })],
    ['back-count entry', key(GAME, { ...profile, wongInTc: 3 })],
    ['a custom betting method', key(GAME, profile, [{ id: 'mine', entryTc: null, exitTc: -4, rampStartTc: null }])],
  ];

  it.each(cases)('%s', (_name, k) => {
    expect(k).not.toBe(base);
  });

  it('and no two of those changes collide', () => {
    expect(cases.length).toBeGreaterThan(20);
    expect(new Set(cases.map(([, k]) => k)).size).toBe(cases.length);
  });

  it('the min bet: the profile unit stands in only when the game has none', () => {
    const noMin = { ...GAME, minBet: null };
    expect(key(noMin, { ...profile, unitDollars: 10 })).not.toBe(key(noMin, { ...profile, unitDollars: 50 }));
    expect(key(GAME, { ...profile, unitDollars: 10 })).toBe(base);
  });

  it('a card room: its unlogged commission is assumed, so the kind matters only then', () => {
    const unlogged = { ...GAME, commissionPer100: null };
    expect(key(unlogged, profile, [], 'cardroom')).not.toBe(key(unlogged, profile, [], 'casino'));
    expect(key(GAME, profile, [], 'cardroom')).toBe(key(GAME, profile, [], 'casino'));
  });

  it('SIM_VERSION leads the key, so a bump retires every stored result', () => {
    expect(base.startsWith(`${SIM_VERSION}:`)).toBe(true);
    const old: GameResult = { ...result('x', 1), key: base.replace(/^\d+:/, `${SIM_VERSION - 1}:`) };
    expect(resultState(old, base).kind).toBe('stale');
  });
});

describe('the cache key: nothing else changes it', () => {
  const base = key();
  const cases: [string, string][] = [
    ['rounds per hour', key({ ...GAME, roundsPerHour: 120 })],
    ['notes', key({ ...GAME, notes: 'pit 3, Ray' })],
    ['label', key({ ...GAME, label: 'High limit' })],
    ['variant name (free text)', key({ ...GAME, variantName: 'Vegas Strip' })],
    ['marked unsure', key({ ...GAME, unsure: ['das', 'cutDecksLeft'] })],
    ['side bets (their own key, below)', key({ ...GAME, sideBets: [{ bet: 'buster', payTable: 'bu-evo', minBet: 25, maxBet: null }] })],
    ['mid-shoe entry unknown vs allowed (only a badge)', key({ ...GAME, midShoeEntry: 'unknown' })],
    ['profile name', key(GAME, { ...profile, name: 'Other' })],
    ['profile id', key(GAME, { ...profile, id: 'other' })],
    ["the profile's own table rules (the game's replace them)", key(GAME, { ...profile, rules: { ...profile.rules, decks: 2, s17: true } })],
    ['bankroll', key(GAME, { ...profile, bankrollStart: 99_999 })],
    ["the profile's penetration (the game's cut is used)", key(GAME, { ...profile, penetration: 0.5, cutDecks: 2 })],
    ['count checks, bet-spread grading, cover bets', key(GAME, { ...profile, countCheckEvery: 9, betSpreadOn: true, coverBets: true })],
    ['seats and shoe-out', key(GAME, { ...profile, seats: { ...profile.seats }, startShoeOut: true })],
    ['the same ramp, listed in another order', key(GAME, { ...profile, spread: [...profile.spread].reverse() })],
  ];

  it("review S4: a custom method's name is not in the key; its numbers are", () => {
    const m = { id: 'mine', entryTc: null, exitTc: -4, rampStartTc: null };
    const named = (label?: string) => key(GAME, profile, [label === undefined ? m : { ...m, label }]);
    expect(named('Leave at -4')).toBe(named());
    expect(named('My exit')).toBe(named());
    expect(named()).not.toBe(base);
    expect(key(GAME, profile, [{ ...m, exitTc: -3, label: 'Leave at -4' }])).not.toBe(named('Leave at -4'));
  });

  it('review S4: a setup with no named method keeps the key it had (nothing is worked out again for the change)', () => {
    const spec = simInputFor(GAME, profile, []).spec;
    const text = JSON.stringify({ v: SIM_VERSION, ...spec });
    expect(base).toBe(`${SIM_VERSION}:${fnv1a(text).toString(36)}:${text.length.toString(36)}`);
  });

  it('review S4: a stored result shows the names as they are now', () => {
    const m = { id: 'mine', entryTc: null, exitTc: -4, rampStartTc: null, label: 'Old' };
    const r: GameResult = { ...result('k', 1), methods: [{ method: m, acc: emptyAccum() }] };
    expect(relabel(r, [{ ...m, label: 'New' }]).methods![0]!.method.label).toBe('New');
    expect(relabel(r, [{ id: 'mine', entryTc: null, exitTc: -4, rampStartTc: null }]).methods![0]!.method).not.toHaveProperty('label');
    expect(relabel(r, [m])).toBe(r);
    expect(relabel(r, [])).toBe(r);
  });

  it('(the default ramp has steps to reorder)', () => {
    expect(profile.spread.length).toBeGreaterThan(1);
  });

  it.each(cases)('%s', (_name, k) => {
    expect(k).toBe(base);
  });

  it('a side bet has its own key, which the game rules it reads do change', () => {
    const sb = { bet: 'buster' as const, payTable: 'bu-evo', minBet: 25, maxBet: null };
    const k = sideSpecKey(sideRowSpec(GAME, sb));
    expect(sideSpecKey(sideRowSpec({ ...GAME, cutDecksLeft: 1.5 }, sb))).not.toBe(k);
    expect(sideSpecKey(sideRowSpec({ ...GAME, s17: true }, sb))).not.toBe(k);
    expect(sideSpecKey(sideRowSpec({ ...GAME, decks: 2 }, sb))).not.toBe(k);
    expect(sideSpecKey(sideRowSpec({ ...GAME, minBet: 5, das: false }, sb))).toBe(k);
  });
});

// ---------------------------------------------------------------- the store

function result(k: string, rounds: number, at = '2026-10-20T00:00:00Z'): GameResult {
  return {
    key: k,
    computedAt: at,
    profileName: 'p',
    status: 'done',
    ms: 1,
    basicRounds: rounds,
    countRounds: rounds,
    unit: 25,
    basic: emptyAccum(),
    methods: null,
  };
}

describe('the stored results (Wave Q: by game, and by key)', () => {
  let mem: Map<string, string>;
  beforeEach(() => {
    mem = new Map();
    _setGameStatsStorage({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) });
  });

  it('review B1: a save that does not land says so, and the session keeps the figures until one does', () => {
    let full = true;
    _setGameStatsStorage({
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        if (full) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        mem.set(k, v);
      },
    });
    expect(saveGameResult('g1', result('k1', 10))).toBe(false);
    expect(mem.size).toBe(0);
    expect(gameStatsUnsaved()).toBe(true);
    expect(loadGameCache().results['g1']?.key).toBe('k1');
    expect(saveGameResult('g2', result('k2', 10))).toBe(false);
    expect(Object.keys(loadGameResults()).sort()).toEqual(['g1', 'g2']);
    // Room again: the next save writes everything the session held.
    full = false;
    expect(saveGameResult('g3', result('k3', 10))).toBe(true);
    expect(gameStatsUnsaved()).toBe(false);
    expect(Object.keys(JSON.parse(mem.get(GAME_STATS_KEY)!).results).sort()).toEqual(['g1', 'g2', 'g3']);
  });

  it('review N9: the archive keeps no result from another SIM_VERSION', () => {
    const old = `${SIM_VERSION - 1}:abc:1`;
    const now = `${SIM_VERSION}:abc:1`;
    saveGameResult('g1', result(old, 10));
    saveGameResult('g1', result(now, 10));
    saveGameResult('g1', result(`${SIM_VERSION}:def:1`, 10));
    expect(Object.keys(loadGameArchive())).toEqual([now]);
  });

  it("a game's result replaced for another key goes to the archive, and comes back when its inputs do", () => {
    saveGameResult('g1', result('A', 10));
    saveGameResult('g1', result('B', 20));
    expect(loadGameResults().g1!.key).toBe('B');
    expect(Object.keys(loadGameArchive())).toEqual(['A']);
    // The rule changed back: A is found without a run.
    expect(resultForKey(loadGameResults(), loadGameArchive(), 'g1', 'A')?.basicRounds).toBe(10);
    expect(resultForKey(loadGameResults(), loadGameArchive(), 'g1', 'C')).toBeUndefined();
  });

  it('two games dealt alike share one result; the fuller one wins', () => {
    saveGameResult('g1', result('K', 10));
    saveGameResult('g2', result('K', 30));
    const all = loadGameResults();
    expect(resultForKey(all, {}, 'g3', 'K')?.basicRounds).toBe(30);
    expect(resultForKey(all, {}, 'g1', 'K')?.basicRounds).toBe(30);
    // resultState: current through the shared result, though g3 has nothing of its own.
    expect(resultState(undefined, 'K', resultForKey(all, {}, 'g3', 'K')).kind).toBe('current');
    expect(resultState(result('OLD', 1), 'K', undefined).kind).toBe('stale');
  });

  it('a deleted game goes to the archive, so a twin keeps its figures', () => {
    saveGameResult('g1', result('K', 10));
    saveGameResult('g2', result('L', 10));
    pruneGameResults(new Set(['g2']));
    expect(Object.keys(loadGameResults())).toEqual(['g2']);
    expect(resultForKey(loadGameResults(), loadGameArchive(), 'g9', 'K')?.basicRounds).toBe(10);
  });

  it('the archive keeps the newest ARCHIVE_MAX, and never a key a game holds', () => {
    for (let i = 0; i <= ARCHIVE_MAX + 5; i++) saveGameResult('g1', result(`k${i}`, i, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
    const archive = loadGameArchive();
    expect(Object.keys(archive)).toHaveLength(ARCHIVE_MAX);
    // The oldest went first; the live key is not duplicated there.
    // k0..k44 were replaced in turn: the newest 40 of them (k5..k44) stay.
    expect(archive.k0).toBeUndefined();
    expect(archive.k4).toBeUndefined();
    expect(archive.k5).toBeDefined();
    expect(archive[`k${ARCHIVE_MAX + 5}`]).toBeUndefined();
    expect(loadGameResults().g1!.key).toBe(`k${ARCHIVE_MAX + 5}`);
  });

  it('wave W review S2: a pinned key (the figures of an earlier version) is kept however many newer ones push it', () => {
    pinGameKeys(['k0', 'k3']);
    try {
      for (let i = 0; i <= ARCHIVE_MAX + 5; i++) saveGameResult('g1', result(`k${i}`, i, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
      const archive = loadGameArchive();
      expect(archive.k0).toBeDefined();
      expect(archive.k3).toBeDefined();
      // The newest ARCHIVE_MAX beside them, as without pins.
      expect(Object.keys(archive)).toHaveLength(ARCHIVE_MAX + 2);
      expect(archive.k4).toBeUndefined();
      expect(archive.k5).toBeDefined();
    } finally {
      pinGameKeys([]);
    }
  });

  it('an older blob with no archive reads as one; unreadable storage reads as empty', () => {
    mem.set(GAME_STATS_KEY, JSON.stringify({ version: 1, results: { g1: result('A', 1) } }));
    expect(loadGameResults().g1!.key).toBe('A');
    expect(loadGameArchive()).toEqual({});
    mem.set(GAME_STATS_KEY, '{nope');
    expect(loadGameResults()).toEqual({});
  });
});

describe('runSeed', () => {
  it("run 0 is the input's own seed (a one-go run deals what it always did); later runs deal fresh rounds", () => {
    const input = simInputFor(GAME, profile, []);
    expect(runSeed(input, 0)).toBe(input.seed);
    const seeds = [0, 1, 2, 3].map((n) => runSeed(input, n));
    expect(new Set(seeds).size).toBe(4);
    expect(runSeed(input, 2)).toBe(runSeed(input, 2));
  });

  it('review N4 / re-review R1: legacy runs 1-7 sit 2^29 steps apart on the one cycle; 8 on land in the unreached half of a stretch', () => {
    const input = simInputFor(GAME, profile, []);
    const STEP = 0x6d2b79f5;
    // The state after k draws from seed s is s + k*STEP (mod 2^32); back again with STEP's inverse (it is odd).
    let inv = STEP;
    for (let i = 0; i < 5; i++) inv = Math.imul(inv, 2 - Math.imul(STEP, inv));
    expect(Math.imul(inv, STEP)).toBe(1);
    const steps = (state: number) => Math.imul((state - input.seed) >>> 0, inv) >>> 0;
    const STRETCH = 2 ** 29;
    for (let n = 0; n < SPACED_RUNS; n++) expect(steps(runSeed(input, n)), `run ${n}`).toBe(n * STRETCH);
    const seen = new Set<number>();
    for (let n = SPACED_RUNS; n < SPACED_RUNS * 17; n++) {
      const at = steps(runSeed(input, n));
      expect(Math.floor(at / STRETCH), `run ${n}`).toBe(n % SPACED_RUNS);
      expect(at % STRETCH, `run ${n}`).toBeGreaterThanOrEqual(STRETCH / 2);
      seen.add(at);
    }
    // 128 runs past the eighth, no two alike.
    expect(seen.size).toBe(SPACED_RUNS * 16);
  });
});

// C4 (audit 2026-10-29): a single-deck game keeps its logged cut.
describe('the simulator cut follows the logged cut on single deck (C4)', () => {
  const oneDeck = (cutDecksLeft: number | null): CasinoGame => ({ ...GAME, decks: 1, cutDecksLeft });

  it('0.75 and 0.25 decks left are simulated as logged, with different keys', () => {
    const shallow = simInputFor(oneDeck(0.75), profile, []);
    const deep = simInputFor(oneDeck(0.25), profile, []);
    expect(shallow.cutUsed).toBe(0.75);
    expect(deep.cutUsed).toBe(0.25);
    expect(shallow.spec.cutDecks).toBe(0.75);
    expect(shallow.key).not.toBe(deep.key);
    expect(shallow.cutClamped).toBeUndefined();
  });

  it('a cut the simulator cannot deal is clamped, and says so', () => {
    const silly = simInputFor(oneDeck(1), profile, []);
    expect(silly.cutUsed).toBe(0.75);
    expect(silly.cutClamped).toBe(true);
    const zero = simInputFor({ ...GAME, cutDecksLeft: 0 }, profile, []);
    expect(zero.cutUsed).toBe(0.25);
    expect(zero.cutClamped).toBe(true);
  });
});
