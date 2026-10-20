import { describe, it, expect } from 'vitest';
import { buildRanking, bestGameOf, gameFigures } from './casinoRanking';
import { emptyCasinoLog, blankGame, type Casino, type CasinoGame, type CasinoLog } from '../store/casinoLog';
import { resultState, simInputFor, type GameResult } from '../store/casinoGameStats';
import { emptyAccum, type Accum } from '../engine/casinoSim';
import { makeDefaultProfile } from '../store/profiles';

const NOW = Date.parse('2026-10-20T12:00:00');
const profile = makeDefaultProfile();

function game(id: string, over: Partial<CasinoGame> = {}): CasinoGame {
  return { ...blankGame(id), decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1, minBet: 25, ...over };
}

function casino(id: string, games: CasinoGame[], over: Partial<Casino> = {}): Casino {
  return { id, name: id, games, status: 'ok', notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over };
}

function logOf(casinos: Casino[], settings: Partial<CasinoLog['settings']> = {}): CasinoLog {
  const log = emptyCasinoLog();
  return { ...log, casinos, settings: { ...log.settings, ...settings } };
}

/** A result whose every method wins `perRound` dollars a round observed (one shoe of 100 rounds). */
function acc(perRound: number): Accum {
  const a = emptyAccum();
  a.observed = a.played = 100;
  a.net = perRound * 100;
  a.net2 = perRound * perRound * 100 + 100 * 100 * 25 * 25;
  a.wagered = 100 * 25;
  a.shoes = 1;
  return a;
}

function resultFor(g: CasinoGame, perRound: number, key = simInputFor(g, profile, []).key): GameResult {
  const input = simInputFor(g, profile, []);
  return {
    key,
    computedAt: '2026-10-20T00:00:00Z',
    profileName: profile.name,
    status: 'done',
    ms: 1,
    basicRounds: 100,
    countRounds: 100,
    unit: 25,
    basic: acc(-0.1),
    methods: g.csm ? null : input.methods.map((method, i) => ({ method, acc: acc(i === 1 ? perRound : perRound - 1) })),
  };
}

describe('buildRanking', () => {
  const a = game('ga');
  const b = game('gb', { cutDecksLeft: 2 });
  const c = game('gc', { s17: true });

  it('orders by EV per hour, uncomputed games last in log order', () => {
    const log = logOf([casino('c1', [a, b]), casino('c2', [c])]);
    const results = { ga: resultFor(a, 1), gc: resultFor(c, 3) };
    const rows = buildRanking(log, profile, results, NOW, null, 'ev');
    expect(rows.map((r) => r.game.id)).toEqual(['gc', 'ga', 'gb']);
    expect(rows[0]!.figures!.evHour).toBeCloseTo(3 * 80, 9);
    expect(rows[0]!.figures!.best!.method.id).toBe('ramp');
    expect(rows[2]!.state.kind).toBe('none');
  });

  it('skips burned casinos until the cool-off is over; greys Avoid ones', () => {
    const log = logOf([
      casino('burned', [a], { status: 'burned', burnedUntil: '2027-01-01' }),
      casino('forever', [b], { status: 'burned', burnedUntil: null }),
      casino('over', [c], { status: 'burned', burnedUntil: '2026-10-01' }),
      casino('avoid', [game('gd')], { status: 'avoid' }),
    ]);
    const rows = buildRanking(log, profile, {}, NOW, null, 'ev');
    expect(rows.map((r) => r.casino.id)).toEqual(['over', 'avoid']);
    expect(rows.map((r) => r.greyed)).toEqual([false, true]);
  });

  it('EV per trip hour: games with a drive time first, then computed games without one, then uncomputed', () => {
    const near = casino('near', [a], { driveMinutes: 15 });
    const far = casino('far', [c], { driveMinutes: 240 });
    const none = casino('none', [b]);
    const log = logOf([far, none, near, casino('todo', [game('ge')], { driveMinutes: 5 })], { sessionHours: 4 });
    // far earns more per hour (3 vs 2), but 8 hours on the road buries it.
    const results = { ga: resultFor(a, 2), gc: resultFor(c, 3), gb: resultFor(b, 9) };
    const rows = buildRanking(log, profile, results, NOW, null, 'trip');
    expect(rows.map((r) => r.casino.id)).toEqual(['near', 'far', 'none', 'todo']);
    expect(rows[0]!.tripEv).toBeCloseTo((160 * 4) / (4 + 0.5), 9);
    expect(rows[2]!.tripEv).toBeNull();
    // The plain EV sort would have put "none" (9/round) first.
    expect(buildRanking(log, profile, results, NOW, null, 'ev')[0]!.casino.id).toBe('none');
  });

  it('distance: live miles first (nearest first), then drive times, then neither', () => {
    const here = { lat: 36.1, lon: -115.17 };
    const log = logOf([
      casino('noinfo', [a]),
      casino('drive', [b], { driveMinutes: 30 }),
      casino('far', [c], { location: { lat: 36.5, lon: -115.17 } }),
      casino('close', [game('gd')], { location: { lat: 36.11, lon: -115.17 }, driveMinutes: 90 }),
    ]);
    expect(buildRanking(log, profile, {}, NOW, here, 'distance').map((r) => r.casino.id)).toEqual(['close', 'far', 'drive', 'noinfo']);
    // Without the user's location, the saved spots count for nothing: drive times only.
    expect(buildRanking(log, profile, {}, NOW, null, 'distance').map((r) => r.casino.id)).toEqual(['drive', 'close', 'noinfo', 'far']);
  });

  it("a casino's row shows its best computed game", () => {
    const log = logOf([casino('c1', [a, b])]);
    const rows = buildRanking(log, profile, { gb: resultFor(b, 2), ga: resultFor(a, 1) }, NOW, null, 'ev');
    expect(bestGameOf(log.casinos[0]!, rows).id).toBe('gb');
    expect(bestGameOf(log.casinos[0]!, []).id).toBe('ga');
  });
});

describe('the cache key', () => {
  const g = game('g1');
  const key = simInputFor(g, profile, []).key;

  it('changes with any rule, the cut, the bets, the ramp or the method set', () => {
    const changed = [
      simInputFor({ ...g, s17: true }, profile, []),
      simInputFor({ ...g, das: false }, profile, []),
      simInputFor({ ...g, payout: '6:5' }, profile, []),
      simInputFor({ ...g, cutDecksLeft: 1.5 }, profile, []),
      simInputFor({ ...g, minBet: 15 }, profile, []),
      simInputFor({ ...g, maxBet: 500 }, profile, []),
      simInputFor({ ...g, midShoeEntry: 'no' }, profile, []),
      simInputFor(g, { ...profile, spread: [{ minTc: -99, units: 1 }, { minTc: 2, units: 6 }] }, []),
      simInputFor(g, { ...profile, tcRounding: 'truncate' }, []),
      simInputFor(g, profile, [{ id: 'mine', entryTc: null, exitTc: -4, rampStartTc: null }]),
    ].map((x) => x.key);
    for (const k of changed) expect(k).not.toBe(key);
    expect(new Set(changed).size).toBe(changed.length);
  });

  it('does not change with rounds per hour, notes, a label or the bankroll (applied at display time)', () => {
    expect(simInputFor({ ...g, roundsPerHour: 120, notes: 'x', label: 'pit 3' }, profile, []).key).toBe(key);
    expect(simInputFor(g, { ...profile, bankrollStart: 99999, name: 'Other' }, []).key).toBe(key);
  });

  it('a result for an older key is stale, and still shown', () => {
    const r = resultFor(g, 1, key);
    expect(resultState(r, key).kind).toBe('current');
    expect(resultState(r, simInputFor({ ...g, s17: true }, profile, []).key).kind).toBe('stale');
    expect(resultState(undefined, key).kind).toBe('none');
    const log = logOf([casino('c1', [{ ...g, s17: true }])]);
    const row = buildRanking(log, profile, { g1: r }, NOW, null, 'ev')[0]!;
    expect(row.state.kind).toBe('stale');
    expect(row.figures).not.toBeNull();
  });

  it('unknown rules are simulated at the conservative choice and listed as assumed', () => {
    const input = simInputFor(blankGame('b'), profile, []);
    expect(input.assumed).toEqual(['decks', 's17', 'das', 'surrender', 'payout', 'cut', 'minBet']);
    expect(input.spec.rules).toMatchObject({ decks: 6, s17: false, das: false, ls: false, bj65: true });
    expect(input.cutUsed).toBe(1.5);
  });

  it('a continuous shuffler gets no methods and a flat-bet EV per hour', () => {
    const csm = game('cs', { csm: true });
    const input = simInputFor(csm, profile, []);
    expect(input.methods).toEqual([]);
    const f = gameFigures(resultFor(csm, 0), 100, null);
    expect(f.methods).toBeNull();
    expect(f.edge).toBeCloseTo(0.1 / 25, 12);
    expect(f.evHour).toBeCloseTo(-0.1 * 100, 9);
  });
});
