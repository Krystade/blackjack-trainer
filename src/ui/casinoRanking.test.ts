import { describe, it, expect } from 'vitest';
import { buildRanking, bestGameOf, evTargetMet, exitMinutesOf, gameFigures, rankedEvHour, seatedThroughout, sideCombinedText, withSideBet, type GameFigures } from './casinoRanking';
import { emptyCasinoLog, blankGame, type Casino, type CasinoGame, type CasinoLog } from '../store/casinoLog';
import { resultState, simInputFor, type GameResult } from '../store/casinoGameStats';
import { workFor } from './casinoAutoSim';
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
    // Wave Q: dealt differently from 'ga' (a twin would share its result, resultForKey).
    const log = logOf([far, none, near, casino('todo', [game('ge', { minBet: 10 })], { driveMinutes: 5 })], { sessionHours: 4 });
    // far earns more per hour (3 vs 2), but 8 hours on the road buries it.
    const results = { ga: resultFor(a, 2), gc: resultFor(c, 3), gb: resultFor(b, 9) };
    const rows = buildRanking(log, profile, results, NOW, null, 'trip');
    expect(rows.map((r) => r.casino.id)).toEqual(['near', 'far', 'none', 'todo']);
    expect(rows[0]!.tripEv).toBeCloseTo((160 * 4) / (4 + 0.5), 9);
    expect(rows[2]!.tripEv).toBeNull();
    // The plain EV sort would have put "none" (9/round) first.
    expect(buildRanking(log, profile, results, NOW, null, 'ev')[0]!.casino.id).toBe('none');
  });

  it('distance: nearest first, live miles and drive minutes on one scale (40 mph), then neither', () => {
    const here = { lat: 36.1, lon: -115.17 };
    const log = logOf([
      casino('noinfo', [a]),
      casino('drive60', [game('gx')], { driveMinutes: 60 }),
      casino('drive', [b], { driveMinutes: 30 }),
      // 0.4 degrees of latitude = 27.6 miles = 41 minutes at 40 mph: between the two drive times.
      casino('far', [c], { location: { lat: 36.5, lon: -115.17 } }),
      casino('close', [game('gd')], { location: { lat: 36.11, lon: -115.17 }, driveMinutes: 90 }),
    ]);
    expect(buildRanking(log, profile, {}, NOW, here, 'distance').map((r) => r.casino.id)).toEqual(['close', 'drive', 'far', 'drive60', 'noinfo']);
    // Without the user's location, the saved spots count for nothing: drive times only.
    expect(buildRanking(log, profile, {}, NOW, null, 'distance').map((r) => r.casino.id)).toEqual(['drive', 'drive60', 'close', 'noinfo', 'far']);
  });

  it("a casino's row shows its best computed game", () => {
    const log = logOf([casino('c1', [a, b])]);
    const rows = buildRanking(log, profile, { gb: resultFor(b, 2), ga: resultFor(a, 1) }, NOW, null, 'ev');
    expect(bestGameOf(log.casinos[0]!, rows).id).toBe('gb');
    expect(bestGameOf(log.casinos[0]!, []).id).toBe('ga');
  });
});

/** A method's sums: `net` dollars over `observed` rounds in `shoes` equal shoes, leaving `exits` times. */
function accX(net: number, observed: number, exits: number, shoes = 10): Accum {
  const a = emptyAccum();
  a.observed = a.played = a.dealt = observed;
  a.exits = exits;
  a.net = net;
  a.net2 = observed * 25 * 25 * 9;
  a.wagered = observed * 25;
  a.shoes = shoes;
  const x = observed / shoes;
  const y = net / shoes;
  const e = exits / shoes;
  // Shoes that differ a little, so the interval is finite.
  for (let i = 0; i < shoes; i++) {
    const yi = y + (i % 2 === 0 ? 5 : -5);
    a.sy2 += yi * yi;
    a.sxy += x * yi;
    a.sx2 += x * x;
    a.se2 += e * e;
    a.sey += e * yi;
    a.sxe += x * e;
  }
  return a;
}

describe('review B1: leaving costs time', () => {
  const g = game('gw');
  const methods = simInputFor(g, profile, []).methods;
  const ramp = methods.find((m) => m.id === 'ramp')!;
  const wong = methods.find((m) => m.id === 'wong-1')!;
  const result = (status: GameResult['status'] = 'done'): GameResult => ({
    ...resultFor(g, 0),
    status,
    // Play all: $1 a round. Wong out: $1.50 a round over the rounds it stays, leaving 20 times in 100 rounds.
    methods: [
      { method: ramp, acc: accX(100, 100, 0) },
      { method: wong, acc: accX(150, 100, 20) },
    ],
  });

  it('a wong-out that wins when leaving is free loses once a new table takes five minutes', () => {
    const free = gameFigures(result(), 80, null, 0);
    expect(free.best!.method.id).toBe('wong-1');
    expect(free.evHour).toBeCloseTo(150 * 0.8, 9);
    const five = gameFigures(result(), 80, null, 5);
    // 20 exits x (80 x 5 / 60 = 6.67 rounds) = 133 rounds more: 150 / 233 a round.
    expect(five.methods![1]!.hours.evHour).toBeCloseTo((80 * 150) / (100 + 20 * (400 / 60)), 9);
    expect(five.best!.method.id).toBe('ramp');
    expect(five.methods![1]!.hours.exitsPerHour).toBeCloseTo((80 * 20) / (100 + 20 * (400 / 60)), 9);
  });

  it('the minutes are the settings, by whether mid-shoe entry is barred', () => {
    const log = logOf([]);
    expect(exitMinutesOf(log, g)).toBe(5);
    expect(exitMinutesOf(log, { ...g, midShoeEntry: 'unknown' })).toBe(5);
    expect(exitMinutesOf(log, { ...g, midShoeEntry: 'no' })).toBe(15);
    const set = logOf([], { exitFindMinutes: 0, exitWaitMinutes: 30 });
    expect(exitMinutesOf(set, g)).toBe(0);
    expect(exitMinutesOf(set, { ...g, midShoeEntry: 'no' })).toBe(30);
  });

  it('the ranking charges them: same result, different minutes, a different best method and no re-run', () => {
    const at = (settings: Partial<CasinoLog['settings']>) =>
      buildRanking(logOf([casino('c1', [g])], settings), profile, { gw: result() }, NOW, null, 'ev')[0]!;
    expect(at({ exitFindMinutes: 0 }).figures!.best!.method.id).toBe('wong-1');
    expect(at({}).figures!.best!.method.id).toBe('ramp');
    expect(at({}).state.kind).toBe('current');
    expect(at({}).exitRounds).toBeCloseTo(400 / 60, 12);
  });
});

describe('review S3 and S4: partial runs and unknown mid-shoe entry', () => {
  const a = game('ga');
  const b = game('gb', { cutDecksLeft: 2 });

  it('a partial run is marked and run again on its own; Wave Q review S3: it ranks by its figure, not by how far it got', () => {
    const log = logOf([casino('c1', [a, b])]);
    const results = { ga: { ...resultFor(a, 3), status: 'cancelled' as const }, gb: resultFor(b, 1) };
    const rows = buildRanking(log, profile, results, NOW, null, 'ev');
    expect(rows.map((r) => r.game.id)).toEqual(['ga', 'gb']);
    expect(rows[0]!.figures!.partial).toBe(true);
    expect(rows[0]!.state.kind).toBe('current');
    expect(rows.map((r) => workFor(r.state.kind === 'current' ? r.state.result : undefined))).toEqual(['refine', null]);
    // Every status, either way round: the figure decides.
    for (const status of ['partial', 'cancelled', 'time', 'budget', 'done'] as const) {
      for (const sort of ['ev', 'trip'] as const) {
        const hi = buildRanking(log, profile, { ga: { ...resultFor(a, 3), status }, gb: resultFor(b, 1) }, NOW, null, sort);
        expect(hi.map((r) => r.game.id), `${status} ${sort} above`).toEqual(['ga', 'gb']);
        const lo = buildRanking(log, profile, { ga: { ...resultFor(a, -3), status }, gb: { ...resultFor(b, 1), status: 'time' } }, NOW, null, sort);
        expect(lo.map((r) => r.game.id), `${status} ${sort} below`).toEqual(['gb', 'ga']);
      }
    }
    for (const status of ['time', 'budget'] as const) {
      const r = buildRanking(log, profile, { ga: { ...resultFor(a, 3), status } }, NOW, null, 'ev');
      expect(r.find((x) => x.game.id === 'ga')!.figures!.partial, status).toBe(true);
    }
  });

  it('a back-count best at a game whose mid-shoe entry is unknown is flagged', () => {
    const bcResult = (g: CasinoGame): GameResult => {
      const ms = simInputFor(g, profile, []).methods;
      return { ...resultFor(g, 0), methods: ms.map((m) => ({ method: m, acc: accX(m.id === 'bc+2+0' ? 200 : 10, 100, 0) })) };
    };
    const unknown = game('gu', { midShoeEntry: 'unknown' });
    const allowed = game('gl', { midShoeEntry: 'allowed' });
    const rows = buildRanking(logOf([casino('c1', [unknown, allowed])]), profile, { gu: bcResult(unknown), gl: bcResult(allowed) }, NOW, null, 'ev');
    const byId = new Map(rows.map((r) => [r.game.id, r]));
    expect(byId.get('gu')!.figures!.best!.method.id).toBe('bc+2+0');
    expect(byId.get('gu')!.midShoeUnknown).toBe(true);
    expect(byId.get('gl')!.midShoeUnknown).toBe(false);
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

  it('unknown rules are simulated at the conservative choice (the split cap and double-on at the best case) and listed as assumed', () => {
    const input = simInputFor(blankGame('b'), profile, []);
    // Wave M adds rsa, doubling split aces, the split cap and double-on.
    expect(input.assumed).toEqual(['decks', 's17', 'das', 'surrender', 'rsa', 'payout', 'doubleSplitAces', 'maxSplitHands', 'doubleOn', 'cut', 'minBet']);
    expect(input.spec.rules).toMatchObject({ decks: 6, s17: false, das: false, ls: false, rsa: false, bj65: true });
    // Wave P, owner's ruling: split to 4 and double any two, which the simulator plays when the spec is silent.
    expect(input.spec).not.toHaveProperty('maxSplitHands');
    expect(input.spec).not.toHaveProperty('doubleOn');
    expect(input.spec.commissionPct).toBeUndefined();
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

describe('re-review R2: the +/-10% EV target is judged at the minutes shown', () => {
  const fig = (evHour: number, evHourCi: number) => ({ best: { hours: { evHour, evHourCi } } }) as unknown as Pick<GameFigures, 'best'>;
  it('met within 10% of the EV, missed beyond it or at zero; a shuffler has no EV target', () => {
    expect(evTargetMet(fig(60, 6))).toBe(true);
    expect(evTargetMet(fig(60, 6.01))).toBe(false);
    expect(evTargetMet(fig(-20, 2))).toBe(true);
    expect(evTargetMet(fig(0, 0))).toBe(false);
    expect(evTargetMet({ best: null })).toBe(true);
  });
});

describe('Wave L: side bets in the ranking', () => {
  it('a game whose side bet is worth making ranks on its EV plus the side bet', () => {
    const plainGame = game('gp', { s17: true });
    // Same rules and cut (6 decks, cut at 1: the generated table's), plus a countable side bet.
    const withSide = game('gs', { s17: true, sideBets: [{ bet: 'buster', payTable: 'bu-evo', minBet: 25, maxBet: null }] });
    const log = logOf([casino('c1', [plainGame]), casino('c2', [withSide])]);
    // Equal main-game EV, so the side bet decides the order.
    const rows = buildRanking(log, profile, { gp: resultFor(plainGame, 2), gs: resultFor(withSide, 2) }, NOW, null, 'ev');
    const side = rows.find((r) => r.game.id === 'gs')!;
    expect(side.sideEvHour).toBeGreaterThan(0);
    expect(rows[0]!.game.id).toBe('gs');
    expect(rows.find((r) => r.game.id === 'gp')!.sideEvHour).toBeUndefined();
    // A side bet that loses (not countable here) adds nothing and does not reorder.
    const losing = game('gl', { s17: true, sideBets: [{ bet: 'perfectPairs', payTable: 'pp-a', minBet: 25, maxBet: null }] });
    const rows2 = buildRanking(logOf([casino('c1', [plainGame]), casino('c3', [losing])]), profile, { gp: resultFor(plainGame, 2), gl: resultFor(losing, 2) }, NOW, null, 'ev');
    expect(rows2.map((r) => r.game.id)).toEqual(['gp', 'gl']);
    expect(rows2[1]!.sideEvHour).toBeUndefined();
  });
});

describe('Wave L merge, review S7: side bets on a variant game add nothing', () => {
  it('a variant row is not modelled and carries no side figure; its standard twin does', () => {
    const sides = { sideBets: [{ bet: 'buster' as const, payTable: 'bu-evo', minBet: 25, maxBet: null }] };
    const std = game('gs', { s17: true, ...sides });
    const variant = game('gv', { s17: true, ...sides, variant: 'freebet' });
    const rows = buildRanking(logOf([casino('c1', [std, variant])]), profile, { gs: resultFor(std, 2), gv: resultFor(std, 2) }, NOW, null, 'ev');
    const v = rows.find((r) => r.game.id === 'gv')!;
    expect(v.notModelled).toBe(true);
    expect(v.sideEvHour).toBeUndefined();
    expect(v.withSide).toBeUndefined();
    expect(rankedEvHour(v)).toBeNull();
    expect(rows.find((r) => r.game.id === 'gs')!.sideEvHour).toBeGreaterThan(0);
  });
});

/** The figures with every method's 95% interval (and the game's) set to `ci` dollars an hour. */
function withCi(f: GameFigures, ci: number): GameFigures {
  const methods = f.methods?.map((m) => ({ ...m, hours: { ...m.hours, evHourCi: ci } })) ?? null;
  const best = f.best && methods ? (methods.find((m) => m.method.id === f.best!.method.id) ?? null) : null;
  return { ...f, methods, best, evHourCi: ci };
}

describe('review S1: a side bet rides only on a method that stays seated', () => {
  const g = game('gs', { s17: true, sideBets: [{ bet: 'buster', payTable: 'bu-evo', minBet: 25, maxBet: null }] });
  /** Every method wins `rest` a round, except the ones named. */
  const result = (by: Record<string, number>, rest = 0): GameResult => {
    const r = resultFor(g, 0);
    return { ...r, methods: r.methods!.map(({ method }) => ({ method, acc: acc(by[method.id] ?? rest) })) };
  };
  const rowFor = (res: GameResult) => buildRanking(logOf([casino('c', [g], { driveMinutes: 30 })]), profile, { gs: res }, NOW, null, 'ev')[0]!;
  // The side bet alone, from a ranking where the seated ramp is best (so it is added).
  const sideAlone = rowFor(result({ ramp: 2 })).sideEvHour!;

  it('the side bet is worth something here', () => {
    expect(sideAlone).toBeGreaterThan(5);
  });

  it('best method wongs out and beats ramp + side: ranked on the wong alone, no side badge', () => {
    // wong-1 $3/round = $240/h; ramp $2/round = $160/h; +side is still below $240.
    const row = rowFor(result({ 'wong-1': 3, ramp: 2 }));
    expect(row.figures!.best!.method.id).toBe('wong-1');
    expect(rankedEvHour(row)).toBeCloseTo(240, 9);
    expect(row.sideEvHour).toBeUndefined();
    expect(row.withSide).toBeUndefined();
    const side = Math.round(160 + sideAlone);
    expect(sideCombinedText(withCi(row.figures!, 20), 'Buster', sideAlone)).toBe(
      `none — the best method wongs out (+$240 ±$20/h), so Buster is not added to it. Seated with Buster: +$${side} ±$20/h.`,
    );
  });

  it('Wave O: seated play plus the side bet still loses: said plainly, not as a figure to sit for', () => {
    // ramp loses $3/round = -$240/h, far more than the side bet wins back.
    const row = rowFor(result({ 'wong-1': 3, ramp: -3 }, -3));
    const text = sideCombinedText(withCi(row.figures!, 20), 'Buster', sideAlone);
    expect(text).toMatch(/\. Seated play with Buster still loses \(−\$\d+ ±\$20\/h\), so it isn't worth sitting for\.$/);
    expect(text).not.toContain('Seated with');
  });

  describe('review S3: the interval decides the wording', () => {
    // wong-1 +$240/h is best; ramp $1/round = $80/h, so ramp + side is just under it.
    const loss = (ci: number) => sideCombinedText(withCi(rowFor(result({ 'wong-1': 3, ramp: -1 }, -3)).figures!, ci), 'Buster', sideAlone);

    it('a seated loss inside its interval is about break-even, not a loss', () => {
      const total = -80 + sideAlone; // ramp -$80/h plus the side bet
      expect(total).toBeLessThan(0);
      const roundedTotal = Math.round(total);
      // Just wider than the loss: about break-even. Just narrower: a loss.
      expect(loss(-total + 0.5)).toContain(`Seated play with Buster is about break-even (−$${-roundedTotal} ±$${Math.ceil(-total + 0.5)}/h).`);
      expect(loss(-total - 0.5)).toContain(`Seated play with Buster still loses (−$${-roundedTotal} ±$${Math.ceil(-total - 0.5)}/h), so it isn't worth sitting for.`);
    });

    it('an infinite interval is never a win or a loss', () => {
      expect(loss(Infinity)).toContain('is about break-even (');
      expect(loss(Infinity)).toContain('±?/h');
    });

    it('review N1: when the best method itself loses, nothing here wins', () => {
      // Every method loses $3/round; wong-1 loses least (-$1/round).
      const row = rowFor(result({ 'wong-1': -1, ramp: -2 }, -3));
      expect(row.figures!.best!.method.id).toBe('wong-1');
      const text = sideCombinedText(withCi(row.figures!, 10), 'Buster', sideAlone);
      expect(text).toMatch(/^none — nothing here wins: the best method wongs out and still loses \(−\$80 ±\$10\/h\)\. Seated play with Buster still loses \(−\$\d+ ±\$10\/h\), so it isn't worth sitting for\.$/);
      expect(text).not.toContain('is not added to it');
      // The same best method with a wide interval is about break-even, so its leaving the table is the reason again.
      expect(sideCombinedText(withCi(row.figures!, 100), 'Buster', sideAlone)).toMatch(
        /^none — the best method wongs out \(about break-even, −\$80 ±\$100\/h\), so Buster is not added to it\. /,
      );
    });

    it('a partial run is marked', () => {
      const f = withCi(rowFor(result({ 'wong-1': 3, ramp: -1 }, -3)).figures!, 20);
      expect(sideCombinedText({ ...f, partial: true }, 'Buster', sideAlone)).toMatch(/\. Partial run\.$/);
      expect(sideCombinedText(f, 'Buster', sideAlone)).not.toContain('Partial');
    });

    it('the other two lines carry the interval too', () => {
      const f = withCi(rowFor(result({ 'wong-1': 3, ramp: -1 }, -3)).figures!, 20);
      expect(sideCombinedText(f, null, 0)).toBe('+$240 ±$20/h — no side bet here is worth making.');
      const ramp = withCi(rowFor(result({ ramp: 2 })).figures!, 20);
      expect(sideCombinedText(ramp, 'Buster', sideAlone)).toMatch(/^\+\$\d+ ±\$20\/h \(Profile ramp, play all \+\$160\/h \+ Buster \+\$\d+\/h\)\.$/);
      expect(sideCombinedText(withCi(rowFor(result({ ramp: 2 })).figures!, 1000), 'Buster', sideAlone)).toMatch(/^about break-even, \+\$\d+ ±\$1000\/h \(/);
    });
  });

  it('best method wongs out but ramp + side beats it: ranked on ramp + side, never wong + side', () => {
    // wong-1 $2.1/round = $168/h; ramp $160/h + side > $168.
    const row = rowFor(result({ 'wong-1': 2.1, ramp: 2 }));
    expect(row.figures!.best!.method.id).toBe('wong-1');
    expect(row.withSide!.method!.method.id).toBe('ramp');
    expect(rankedEvHour(row)).toBeCloseTo(160 + sideAlone, 9);
    expect(rankedEvHour(row)).toBeLessThan(168 + sideAlone - 1);
    expect(row.sideEvHour).toBeCloseTo(sideAlone, 9);
    // The trip figure takes the same number.
    const tripBase = rowFor(result({ ramp: 2 })); // ramp best, side added: the same ranked figure
    expect(row.tripEv).toBeCloseTo(tripBase.tripEv!, 9);
    expect(sideCombinedText(row.figures!, 'Buster', sideAlone)).toContain('(Profile ramp, play all ');
  });

  it('a back-count best method is treated the same', () => {
    const row = rowFor(result({ 'bc+1-1': 3, ramp: 2 }));
    expect(row.figures!.best!.method.id).toBe('bc+1-1');
    expect(rankedEvHour(row)).toBeCloseTo(240, 9);
    expect(row.withSide).toBeUndefined();
  });

  it('re-review R2: a back-count entry with no exit is not seated either (it sits out until the count rises)', () => {
    const base = result({ ramp: 2 });
    const bc = base.methods!.find((m) => m.method.id === 'bc+1-1')!.method;
    const backIn = { ...bc, id: 'bc+1', exitTc: null };
    expect(seatedThroughout(backIn)).toBe(false);
    // Back-counted in at $3/round = $240/h; ramp + side is below that, so the side bet is not added to it.
    const row = rowFor({ ...base, methods: [...base.methods!, { method: backIn, acc: acc(3) }] });
    expect(row.figures!.best!.method.id).toBe('bc+1');
    expect(rankedEvHour(row)).toBeCloseTo(240, 9);
    expect(row.withSide).toBeUndefined();
  });

  it('a continuous shuffler is played every round: its side bet always adds', () => {
    const f: GameFigures = { edge: 0.005, edgeCi: 0, methods: null, best: null, evHour: -10, evHourCi: 0, n0Hours: null, partial: false, exitMinutes: 0 };
    expect(withSideBet(f, 12)).toEqual({ evHour: 2, sideEvHour: 12, method: null });
    expect(withSideBet(f, 0)).toBeNull();
  });
});
