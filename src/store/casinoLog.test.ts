import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CASINO_LOG_KEY,
  LEGACY_CASINO_LOG_KEY,
  _setCasinoStorage,
  addBuyIn,
  blankCasinoDraft,
  deleteCasino,
  deleteSession,
  emptyCasinoLog,
  endSession,
  exportFileName,
  loadCasinoLog,
  markExported,
  mergeImport,
  migrateCasinoLog,
  normCasino,
  blankGame,
  setCasinoNotes,
  setCasinoLocation,
  setCasinoSettings,
  normSession,
  quarantinedCasinoLog,
  runningSession,
  saveCasino,
  saveCasinoLog,
  serializeExport,
  setSessionHeat,
  setStartingBankroll,
  startSession,
  subscribeCasinoLog,
  updateSession,
  VERSIONED_FIELDS,
  type CasinoLog,
} from './casinoLog';
import { _resetStorageHealthForTest, onStorageFailure } from './storageHealth';
import { exportAll, _setStorage } from './persist';

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

const EPOCH = '1970-01-01T00:00:00.000Z';

/**
 * Wave W: a game as a pre-versions log is migrated -- its version 1,
 * `<id>-v1`, begun when its casino was, holding its rules.
 */
function versionOne<G extends { id: string }>(g: G, createdAt: string, updatedAt: string) {
  const rules = Object.fromEntries(Object.entries(g).filter(([k]) => (VERSIONED_FIELDS as readonly string[]).includes(k)));
  return { ...g, versionId: `${g.id}-v1`, versions: [{ versionId: `${g.id}-v1`, createdAt, updatedAt, rules }] };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setCasinoStorage(store);
  _resetStorageHealthForTest();
});
afterEach(() => {
  _setCasinoStorage(null);
});

const T0 = Date.parse('2026-10-10T20:00:00.000Z');
const H = 3_600_000;

/** A log with one casino and nothing else. */
function withCasino(name = 'Golden Nugget'): { log: CasinoLog; id: string } {
  const r = saveCasino(emptyCasinoLog(), { ...blankCasinoDraft(name), area: 'Downtown' }, T0)!;
  return { log: r.log, id: r.casino.id };
}

describe('load and save', () => {
  it('reads absent storage as an empty log', () => {
    expect(loadCasinoLog()).toEqual(emptyCasinoLog());
  });

  it('round-trips a log through storage under its own key', () => {
    const { log } = withCasino();
    expect(saveCasinoLog(log)).toBe(true);
    expect(store.map.has(CASINO_LOG_KEY)).toBe(true);
    expect(loadCasinoLog()).toEqual(log);
  });

  it('a running session survives a reload', () => {
    const { log, id } = withCasino();
    const started = startSession(log, id, T0, 500)!;
    saveCasinoLog(started.log);
    const back = loadCasinoLog();
    expect(runningSession(back)?.id).toBe(started.session.id);
    expect(runningSession(back)?.start).toBe(new Date(T0).toISOString());
    expect(runningSession(back)?.buyIns).toEqual([500]);
  });

  it('reports a save that cannot land, and tells subscribers only of saves that did', () => {
    const failures: string[] = [];
    onStorageFailure((f) => failures.push(f.key));
    const heard: number[] = [];
    const off = subscribeCasinoLog(() => heard.push(1));
    _setCasinoStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    });
    expect(saveCasinoLog(emptyCasinoLog())).toBe(false);
    expect(failures).toEqual([CASINO_LOG_KEY]);
    expect(heard).toEqual([]);
    _setCasinoStorage(store);
    expect(saveCasinoLog(emptyCasinoLog())).toBe(true);
    expect(heard).toEqual([1]);
    off();
  });
});

describe('corrupt and partial blobs', () => {
  it('quarantines truncated JSON once and reads it as empty without throwing', () => {
    const TRUNC = '{"version":1,"casinos":[{"id":"c1","name":"Bell';
    store.map.set(CASINO_LOG_KEY, TRUNC);
    expect(loadCasinoLog()).toEqual(emptyCasinoLog());
    expect(quarantinedCasinoLog()).toBe(TRUNC);
    // A second bad blob must not replace the first, closer-to-original copy.
    store.map.set(CASINO_LOG_KEY, '{"oops"');
    loadCasinoLog();
    expect(quarantinedCasinoLog()).toBe(TRUNC);
  });

  it('quarantines a version this build does not know instead of flattening it', () => {
    const FUTURE = JSON.stringify({ version: 4, casinos: [{ id: 'c1', name: 'X' }], sessions: [] });
    store.map.set(CASINO_LOG_KEY, FUTURE);
    expect(loadCasinoLog().casinos).toEqual([]);
    expect(quarantinedCasinoLog()).toBe(FUTURE);
  });

  it('repairs a partial v1 blob field by field and drops entries it cannot use', () => {
    store.map.set(
      CASINO_LOG_KEY,
      JSON.stringify({
        version: 1,
        casinos: [
          { id: 'c1', name: '  Bellagio ', game: { decks: 7, s17: 'yes', payout: '6:5' }, minBet: -5, status: 'weird' },
          { id: 'c2' }, // no name
          'nope',
          { id: 'c1', name: 'duplicate id' },
        ],
        sessions: [
          { id: 's1', casinoId: 'c1', start: '2026-10-01T20:00:00Z', end: null, buyIns: [100, 'x', -3, 0], heat: 'meltdown' },
          { id: 's2', casinoId: 'c1', start: 'not a date' },
          { id: 's3', casinoId: 'c1', start: '2026-10-02T20:00:00Z', end: '2026-10-02T19:00:00Z', cashOut: 50 },
        ],
        settings: 'nope',
      }),
    );
    const log = loadCasinoLog();
    expect(log.casinos).toHaveLength(1);
    const c = log.casinos[0]!;
    expect(c.name).toBe('Bellagio');
    expect(c.games).toEqual([
      versionOne(
        {
          id: 'g-c1',
          decks: null,
          s17: null,
          das: null,
          surrender: null,
          payout: '6:5',
          cutDecksLeft: null,
          minBet: null,
          maxBet: null,
          midShoeEntry: 'unknown',
          csm: false,
          roundsPerHour: null,
        },
        EPOCH,
        EPOCH,
      ),
    ]);
    expect(c.status).toBe('ok');
    expect(log.sessions.map((s) => s.id)).toEqual(['s1', 's3']);
    expect(log.sessions[0]!.buyIns).toEqual([100]);
    expect(log.sessions[0]!.heat).toBe('none');
    // An end before the start is clamped to the start, not a negative session.
    expect(log.sessions[1]!.end).toBe('2026-10-02T20:00:00Z');
    expect(log.settings).toEqual({ startingBankroll: null, updatedAt: null });
    expect(quarantinedCasinoLog()).toBeNull();
  });

  it('reads a hand-edited export with no version as v1, and refuses anything else', () => {
    expect(migrateCasinoLog({ casinos: [{ id: 'a', name: 'A' }] })?.log.casinos).toHaveLength(1);
    expect(migrateCasinoLog({ hello: 1 })).toBeNull();
    expect(migrateCasinoLog([])).toBeNull();
    expect(migrateCasinoLog(null)).toBeNull();
  });
});

describe('wave K: version 2, several games per casino', () => {
  const V1_CASINO = {
    id: 'c1',
    name: 'El Cortez',
    area: 'Downtown',
    game: { decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1.25 },
    minBet: 15,
    maxBet: 500,
    midShoeEntry: 'no',
    csm: false,
    status: 'avoid',
    notes: 'Swing shift is friendly',
    createdAt: '2026-10-01T20:00:00.000Z',
    updatedAt: '2026-10-02T20:00:00.000Z',
  };
  const V1_GAME = {
    id: 'g-c1',
    decks: 6,
    s17: false,
    das: true,
    surrender: true,
    payout: '3:2',
    cutDecksLeft: 1.25,
    minBet: 15,
    maxBet: 500,
    midShoeEntry: 'no',
    csm: false,
    roundsPerHour: null,
  };

  it('loads a stored v1 blob with its game and casino-level bets as games[0], meaning unchanged', () => {
    const v1 = JSON.stringify({ version: 1, casinos: [V1_CASINO], sessions: [], settings: { startingBankroll: 5000, updatedAt: null }, lastExportAt: null });
    store.map.set(LEGACY_CASINO_LOG_KEY, v1);
    const log = loadCasinoLog();
    expect(log.version).toBe(3);
    const c = log.casinos[0]!;
    expect(c.games).toEqual([versionOne(V1_GAME, V1_CASINO.createdAt, V1_CASINO.updatedAt)]);
    expect(c).toMatchObject({ name: 'El Cortez', area: 'Downtown', status: 'avoid', notes: 'Swing shift is friendly', updatedAt: V1_CASINO.updatedAt });
    expect(c).not.toHaveProperty('game');
    expect(c).not.toHaveProperty('minBet');
    expect(log.settings).toEqual({ startingBankroll: 5000, updatedAt: null });
    expect(quarantinedCasinoLog()).toBeNull();
    // Saved back, it is a v3 blob under its own key that loads to the same
    // thing; the v1 bytes are left exactly as they were.
    saveCasinoLog(log);
    expect(JSON.parse(store.map.get(CASINO_LOG_KEY)!).version).toBe(3);
    expect(store.map.get(LEGACY_CASINO_LOG_KEY)).toBe(v1);
    expect(loadCasinoLog()).toEqual(log);
  });

  it('imports a v1 export file, migrating it the same way, and a second import of it is a no-op', () => {
    const file = JSON.stringify({ app: 'bjtrainer-casino-log', version: 1, casinos: [V1_CASINO], sessions: [] });
    const r = mergeImport(emptyCasinoLog(), file);
    if (!r.ok) throw new Error(r.error);
    const migrated = versionOne(V1_GAME, V1_CASINO.createdAt, V1_CASINO.updatedAt);
    expect(r.log.casinos[0]!.games).toEqual([migrated]);
    const again = mergeImport(r.log, file);
    if (!again.ok) throw new Error(again.error);
    expect(again.report).toMatchObject({ casinosAdded: 0, casinosUpdated: 0, kept: 1 });
    expect(again.log.casinos[0]!.games).toEqual([migrated]);
  });

  it('round-trips two games, drive time, a saved spot, notes and the Casino settings through export', () => {
    const draft = blankCasinoDraft('Rampart');
    const g1 = { ...blankGame('g1'), label: 'Shoe', decks: 6 as const, minBet: 25, roundsPerHour: 70, notes: 'pit 2' };
    const g2 = { ...blankGame('g2'), label: 'DD pit 3', decks: 2 as const, minBet: 50, midShoeEntry: 'no' as const };
    const saved = saveCasino(emptyCasinoLog(), { ...draft, games: [g1, g2], driveMinutes: 25, location: { lat: 36.2, lon: -115.3 } }, T0)!;
    let log = setCasinoNotes(saved.log, saved.casino.id, 'Ask for Maria\nNo mid-shoe on DD', T0 + H);
    log = setCasinoSettings(log, { methods: [{ id: 'm1', entryTc: 3, exitTc: 0, rampStartTc: null }], sessionHours: 3 }, T0);
    const r = mergeImport(emptyCasinoLog(), serializeExport(log, T0, null));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos).toEqual(log.casinos);
    expect(r.log.settings).toEqual(log.settings);
    const c = r.log.casinos[0]!;
    expect(c.games.map((g) => g.label)).toEqual(['Shoe', 'DD pit 3']);
    expect(c.driveMinutes).toBe(25);
    expect(c.location).toEqual({ lat: 36.2, lon: -115.3 });
    expect(c.notes).toBe('Ask for Maria\nNo mid-shoe on DD');
    expect(c.updatedAt).toBe(new Date(T0 + H).toISOString());
  });

  it('repairs games: bad fields, duplicate ids, and an empty list gets one blank game', () => {
    const c1 = normCasino({ id: 'c1', name: 'A', games: [{ id: 'x', decks: 3, roundsPerHour: -3 }, { id: 'x' }, 'junk'] })!;
    expect(c1.games.map((g) => g.id)).toEqual(['x', 'g-c1-2']);
    expect(c1.games[0]!.decks).toBeNull();
    expect(c1.games[0]!.roundsPerHour).toBeNull();
    expect(normCasino({ id: 'c2', name: 'B', games: [] })!.games).toEqual([versionOne(blankGame('g-c2'), EPOCH, EPOCH)]);
    expect(normCasino({ id: 'c3', name: 'C', location: { lat: 99, lon: 0 }, driveMinutes: 'far' })).toMatchObject({ location: null, driveMinutes: null });
  });

  it('setCasinoNotes moves updatedAt only when the text changed; setCasinoLocation saves and clears', () => {
    const { log, id } = withCasino();
    const a = setCasinoNotes(log, id, 'hello', T0 + H);
    expect(a.casinos[0]!.updatedAt).toBe(new Date(T0 + H).toISOString());
    expect(setCasinoNotes(a, id, 'hello', T0 + 2 * H)).toBe(a);
    const b = setCasinoLocation(a, id, { lat: 1, lon: 2 }, T0 + 3 * H);
    expect(b.casinos[0]!.location).toEqual({ lat: 1, lon: 2 });
    expect(setCasinoLocation(b, id, null, T0 + 4 * H).casinos[0]!.location).toBeNull();
  });

  it('refuses a custom method whose entry is not above its exit, and an import of version 4', () => {
    const log = setCasinoSettings(emptyCasinoLog(), { methods: [{ id: 'bad', entryTc: 0, exitTc: 0, rampStartTc: null }] }, T0);
    expect(log.settings.methods).toEqual([]);
    const r = mergeImport(emptyCasinoLog(), JSON.stringify({ version: 4, casinos: [], sessions: [] }));
    expect(r.ok).toBe(false);
  });
});

describe('changes', () => {
  it('refuses an empty casino name and trims a real one', () => {
    expect(saveCasino(emptyCasinoLog(), blankCasinoDraft('   '), T0)).toBeNull();
    expect(withCasino('  Wynn  ').log.casinos[0]!.name).toBe('Wynn');
  });

  it('edits a casino in place, keeping its id and createdAt and moving updatedAt', () => {
    const { log, id } = withCasino();
    const r = saveCasino(log, { ...log.casinos[0]!, notes: 'Swing shift is friendly' }, T0 + H, id)!;
    expect(r.log.casinos).toHaveLength(1);
    expect(r.casino.id).toBe(id);
    expect(r.casino.createdAt).toBe(new Date(T0).toISOString());
    expect(r.casino.updatedAt).toBe(new Date(T0 + H).toISOString());
  });

  it('allows one running session at a time, and only at a known casino', () => {
    const { log, id } = withCasino();
    const a = startSession(log, id, T0)!;
    expect(a.session.buyIns).toEqual([]);
    expect(startSession(a.log, id, T0 + 1)).toBeNull();
    expect(startSession(log, 'nowhere', T0)).toBeNull();
  });

  it('adds buy-ins, sets heat, and ends with a cash-out', () => {
    const { log, id } = withCasino();
    const a = startSession(log, id, T0, 500)!;
    let next = addBuyIn(a.log, a.session.id, 300, T0 + H);
    next = addBuyIn(next, a.session.id, -50, T0 + H); // ignored
    next = setSessionHeat(next, a.session.id, 'attention', T0 + H);
    next = endSession(next, a.session.id, { cashOut: 1200, heat: 'shuffle-up', maxTc: 4, notes: 'good pen' }, T0 + 3 * H);
    const s = next.sessions[0]!;
    expect(s.buyIns).toEqual([500, 300]);
    expect(s.cashOut).toBe(1200);
    expect(s.heat).toBe('shuffle-up');
    expect(s.maxTc).toBe(4);
    expect(s.end).toBe(new Date(T0 + 3 * H).toISOString());
    expect(runningSession(next)).toBeNull();
    // No burn asked for: the casino is untouched.
    expect(next.casinos[0]!.status).toBe('ok');
  });

  it('ending with a burn marks the casino burned until the given date, or indefinitely', () => {
    const { log, id } = withCasino();
    const a = startSession(log, id, T0, 500)!;
    const backedOff = endSession(a.log, a.session.id, { cashOut: 0, heat: 'back-off', burn: { until: '2027-04-10' } }, T0 + H);
    expect(backedOff.casinos[0]).toMatchObject({ status: 'burned', burnedUntil: '2027-04-10' });
    const trespassed = endSession(a.log, a.session.id, { cashOut: 0, heat: 'trespass', burn: { until: null } }, T0 + H);
    expect(trespassed.casinos[0]).toMatchObject({ status: 'burned', burnedUntil: null });
  });

  it('updates a finished session through the normaliser and deletes one', () => {
    const { log, id } = withCasino();
    const a = startSession(log, id, T0, 500)!;
    const ended = endSession(a.log, a.session.id, { cashOut: 700, heat: 'none' }, T0 + H);
    const s = ended.sessions[0]!;
    const edited = updateSession(ended, { ...s, cashOut: 650, buyIns: [500, 100], heat: 'flat-bet' }, T0 + 2 * H);
    expect(edited.sessions[0]).toMatchObject({ cashOut: 650, buyIns: [500, 100], heat: 'flat-bet' });
    expect(deleteSession(edited, s.id).sessions).toEqual([]);
  });

  it('deleting a casino deletes the sessions played there', () => {
    const { log, id } = withCasino();
    const other = saveCasino(log, blankCasinoDraft('Other'), T0)!;
    const a = startSession(other.log, id, T0)!;
    const next = deleteCasino(a.log, id);
    expect(next.casinos.map((c) => c.name)).toEqual(['Other']);
    expect(next.sessions).toEqual([]);
  });

  it('keeps the starting bankroll and refuses a negative one', () => {
    expect(setStartingBankroll(emptyCasinoLog(), 5000, T0).settings.startingBankroll).toBe(5000);
    expect(setStartingBankroll(emptyCasinoLog(), -1, T0).settings.startingBankroll).toBeNull();
  });
});

describe('export and import', () => {
  function populated(): CasinoLog {
    const { log, id } = withCasino();
    const a = startSession(log, id, T0, 500)!;
    const ended = endSession(a.log, a.session.id, { cashOut: 900, heat: 'attention' }, T0 + 2 * H);
    return markExported(setStartingBankroll(ended, 10_000, T0), T0 + 2 * H);
  }

  it('names the file by the local date', () => {
    expect(exportFileName(new Date(2026, 9, 18, 23, 30).getTime())).toBe('casino-log-2026-10-18.json');
  });

  it('round-trips into an empty store exactly', () => {
    const log = populated();
    const r = mergeImport(emptyCasinoLog(), serializeExport(log, T0, null));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.log.casinos).toEqual(log.casinos);
    expect(r.log.sessions).toEqual(log.sessions);
    expect(r.log.settings).toEqual(log.settings);
    expect(r.report).toEqual({
      casinosAdded: 1,
      casinosUpdated: 0,
      sessionsAdded: 1,
      sessionsUpdated: 0,
      kept: 0,
      skipped: 0,
      extraRunning: 0,
      casinos: [{ id: log.casinos[0]!.id, name: log.casinos[0]!.name, outcome: 'added' }],
      nameMatches: [],
      ruleChanges: [],
    });
  });

  it('merges by id: the newer updatedAt wins, a tie or older keeps the local copy', () => {
    const base = populated();
    const casino = base.casinos[0]!;
    // The file has a newer casino edit and an OLDER session edit.
    const file: CasinoLog = {
      ...base,
      casinos: [{ ...casino, notes: 'from the file', updatedAt: new Date(T0 + 10 * H).toISOString() }],
      sessions: [{ ...base.sessions[0]!, cashOut: 1, updatedAt: new Date(T0).toISOString() }],
    };
    const r = mergeImport(base, serializeExport(file, T0, null));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos[0]!.notes).toBe('from the file');
    expect(r.log.sessions[0]!.cashOut).toBe(900);
    expect(r.report).toMatchObject({ casinosUpdated: 1, sessionsUpdated: 0, kept: 1 });
    // Importing the same file twice changes nothing more.
    const again = mergeImport(r.log, serializeExport(file, T0, null));
    if (!again.ok) throw new Error(again.error);
    expect(again.report).toMatchObject({ casinosAdded: 0, casinosUpdated: 0, sessionsAdded: 0, sessionsUpdated: 0, kept: 2 });
  });

  it('adds what is new, keeps what is local only, and counts unreadable entries', () => {
    const local = populated();
    const file = {
      version: 1,
      casinos: [{ id: 'c-new', name: 'Resorts World', createdAt: new Date(T0).toISOString() }, { id: 'bad' }],
      sessions: [],
    };
    const r = mergeImport(local, JSON.stringify(file));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos.map((c) => c.name)).toEqual(['Golden Nugget', 'Resorts World']);
    expect(r.log.sessions).toHaveLength(1);
    expect(r.report).toMatchObject({ casinosAdded: 1, skipped: 1 });
  });

  it('an import that would leave two sessions running says so (review S4)', () => {
    const { log, id } = withCasino();
    const here = startSession(log, id, T0 + H)!;
    const there = startSession(log, id, T0)!; // another device's running session, started earlier
    const r = mergeImport(here.log, serializeExport(there.log, T0, null));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.sessions.filter((s) => s.end === null)).toHaveLength(2);
    expect(runningSession(r.log)?.id).toBe(here.session.id);
    expect(r.report.extraRunning).toBe(1);
    // One running session imported into a log with none: nothing extra.
    const clean = mergeImport(emptyCasinoLog(), serializeExport(there.log, T0, null));
    expect(clean.ok && clean.report.extraRunning).toBe(0);
  });

  it('hands back bytes the file carried as unreadable, so they can be kept (review N3)', () => {
    const file = JSON.stringify({ version: 1, casinos: [], sessions: [], unreadable: '{"lost' });
    const r = mergeImport(emptyCasinoLog(), file);
    expect(r.ok && r.unreadable).toBe('{"lost');
  });

  it('refuses timestamps that are not ISO, which Date.parse would otherwise accept (review N2)', () => {
    expect(normSession({ id: 's', casinoId: 'c', start: '1' })).toBeNull();
    expect(normSession({ id: 's', casinoId: 'c', start: 'March 3 2026' })).toBeNull();
    expect(normSession({ id: 's', casinoId: 'c', start: '2026-10-01T20:00:00Z' })).not.toBeNull();
  });

  it('rejects files that are not a casino log', () => {
    expect(mergeImport(emptyCasinoLog(), 'not json').ok).toBe(false);
    expect(mergeImport(emptyCasinoLog(), '{"settings":{},"stats":{}}').ok).toBe(false);
    expect(mergeImport(emptyCasinoLog(), '{"version":4,"casinos":[]}').ok).toBe(false);
    expect(mergeImport(emptyCasinoLog(), '[1,2]').ok).toBe(false);
  });

  it('the newer starting bankroll wins', () => {
    const local = setStartingBankroll(emptyCasinoLog(), 1000, T0);
    const newer = setStartingBankroll(emptyCasinoLog(), 2000, T0 + H);
    const r1 = mergeImport(local, serializeExport(newer, T0, null));
    const r2 = mergeImport(newer, serializeExport(local, T0, null));
    expect(r1.ok && r1.log.settings.startingBankroll).toBe(2000);
    expect(r2.ok && r2.log.settings.startingBankroll).toBe(2000);
  });

  it('carries quarantined bytes in the export so a bad load is never the end of them', () => {
    store.map.set(CASINO_LOG_KEY, '{"broken');
    loadCasinoLog();
    expect(JSON.parse(serializeExport(emptyCasinoLog(), T0)).unreadable).toBe('{"broken');
  });
});

describe('privacy: the casino log stays out of the training backup', () => {
  it('exportAll (Stats > Export backup) does not carry it', () => {
    const shared = memStore();
    _setStorage(shared);
    _setCasinoStorage(shared);
    try {
      const { log } = withCasino('Secret Casino Name');
      saveCasinoLog(setStartingBankroll(log, 12345, T0));
      expect(shared.map.get(CASINO_LOG_KEY)).toContain('Secret Casino Name');
      const backup = exportAll();
      expect(backup).not.toContain('Secret Casino Name');
      expect(backup).not.toContain('12345');
    } finally {
      _setStorage(null);
    }
  });
});

describe('review S2: the v2 log has its own key, and an older build\'s writes are merged in', () => {
  const AT = '2026-10-01T00:00:00.000Z';
  const LATER = '2026-10-05T00:00:00.000Z';
  const v1Casino = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    name: 'El Cortez',
    game: { decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1.25 },
    minBet: 15,
    maxBet: 500,
    midShoeEntry: 'allowed',
    csm: false,
    status: 'ok',
    notes: 'first notes',
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });
  const v1Blob = (casinos: unknown[], sessions: unknown[] = [], settings = { startingBankroll: 5000, updatedAt: AT }) =>
    JSON.stringify({ version: 1, casinos, sessions, settings, lastExportAt: null });

  /** This build takes the v1 log in, the user adds a second game, a drive time, a spot and a method, and it saves. */
  function upgraded(): CasinoLog {
    store.map.set(LEGACY_CASINO_LOG_KEY, v1Blob([v1Casino()]));
    const first = loadCasinoLog();
    const c = first.casinos[0]!;
    const games = [{ ...c.games[0]!, label: 'Main pit', roundsPerHour: 90 }, { ...blankGame('g-dd'), decks: 2 as const }];
    const r = saveCasino(first, { ...c, games, driveMinutes: 25, location: { lat: 36.17, lon: -115.14 } }, Date.parse('2026-10-02T00:00:00.000Z'), c.id)!;
    const log = setCasinoSettings(r.log, { methods: [{ id: 'm1', entryTc: null, exitTc: -3, rampStartTc: null }] }, Date.parse('2026-10-02T00:00:00.000Z'));
    expect(saveCasinoLog(log)).toBe(true);
    return loadCasinoLog();
  }

  it('never writes the v1 key, and keeps v2 data where an older build cannot see it', () => {
    const before = v1Blob([v1Casino()]);
    upgraded();
    expect(store.map.get(LEGACY_CASINO_LOG_KEY)).toBe(before);
    expect(CASINO_LOG_KEY).toBe('bjtrainer.casinoLog.v3');
    expect(JSON.parse(store.map.get(CASINO_LOG_KEY)!).casinos[0].games).toHaveLength(2);
  });

  it('merges what an older tab wrote since: newer records win, and a casino from v1 keeps its games, drive time and spot', () => {
    upgraded();
    // The old tab edits El Cortez (rules and notes), adds a casino and a session, and saves the bankroll.
    store.map.set(
      LEGACY_CASINO_LOG_KEY,
      v1Blob(
        [
          v1Casino({ notes: 'old tab notes', minBet: 25, game: { decks: 6, s17: true, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1 }, updatedAt: LATER }),
          v1Casino({ id: 'c2', name: 'Binion\'s', updatedAt: LATER }),
        ],
        [{ id: 's9', casinoId: 'c2', start: LATER, end: null, buyIns: [500], cashOut: null, heat: 'none', notes: '', createdAt: LATER, updatedAt: LATER }],
        { startingBankroll: 8000, updatedAt: LATER },
      ),
    );
    const log = loadCasinoLog();
    const c1 = log.casinos.find((c) => c.id === 'c1')!;
    // Wave W (review S3): the notes here are not dropped either; the newer come first.
    expect(c1.notes).toBe('old tab notes\n\nfirst notes');
    expect(c1.games).toHaveLength(2);
    // The v1 game updated its own game's v1 facts, and kept what only v2 knows.
    expect(c1.games[0]).toMatchObject({ id: 'g-c1', s17: true, cutDecksLeft: 1, minBet: 25, label: 'Main pit', roundsPerHour: 90 });
    expect(c1.games[1]!.id).toBe('g-dd');
    expect(c1.driveMinutes).toBe(25);
    expect(c1.location).toEqual({ lat: 36.17, lon: -115.14 });
    expect(log.casinos.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(log.sessions.map((x) => x.id)).toEqual(['s9']);
    // The bankroll came from the old tab; the v2-only settings stayed.
    expect(log.settings.startingBankroll).toBe(8000);
    expect(log.settings.methods).toHaveLength(1);
  });

  it('an older record from v1 loses to the newer one here', () => {
    upgraded();
    store.map.set(LEGACY_CASINO_LOG_KEY, v1Blob([v1Casino({ notes: 'stale', updatedAt: '2026-09-01T00:00:00.000Z' })], [], { startingBankroll: 1, updatedAt: '2026-09-01T00:00:00.000Z' }));
    const log = loadCasinoLog();
    expect(log.casinos[0]!.notes).toBe('first notes');
    expect(log.casinos[0]!.games).toHaveLength(2);
    expect(log.settings.startingBankroll).toBe(5000);
  });

  it('load never writes; once saved, the same v1 bytes are not merged again', () => {
    upgraded();
    store.map.set(LEGACY_CASINO_LOG_KEY, v1Blob([v1Casino(), v1Casino({ id: 'c2', name: 'Binion\'s', updatedAt: LATER })]));
    const v2Before = store.map.get(CASINO_LOG_KEY);
    const merged = loadCasinoLog();
    expect(store.map.get(CASINO_LOG_KEY)).toBe(v2Before);
    expect(loadCasinoLog()).toEqual(merged);
    expect(merged.casinos.map((c) => c.id)).toEqual(['c1', 'c2']);
    // Deleted here and saved: the unchanged v1 blob does not bring it back.
    saveCasinoLog(deleteCasino(merged, 'c2'));
    expect(loadCasinoLog().casinos.map((c) => c.id)).toEqual(['c1']);
    // The fingerprint is storage bookkeeping, never exported.
    expect(serializeExport(loadCasinoLog(), T0)).not.toContain('legacySeen');
  });

  it('re-review R1: a casino, its sessions and a session deleted here stay deleted when an old tab writes v1 again', () => {
    const sess = (id: string, casinoId: string, updatedAt = AT) => ({
      id, casinoId, start: AT, end: AT, buyIns: [500], cashOut: 700, heat: 'none', notes: '', createdAt: AT, updatedAt,
    });
    store.map.set(
      LEGACY_CASINO_LOG_KEY,
      v1Blob([v1Casino(), v1Casino({ id: 'c2', name: 'Binions' })], [sess('s1', 'c1'), sess('s2', 'c2'), sess('s3', 'c1')]),
    );
    const first = loadCasinoLog();
    expect(first.sessions.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(saveCasinoLog(deleteSession(deleteCasino(first, 'c2'), 's3'))).toBe(true);
    // The old tab, still holding all of it, edits the deleted records and adds new ones.
    store.map.set(
      LEGACY_CASINO_LOG_KEY,
      v1Blob(
        [v1Casino(), v1Casino({ id: 'c2', name: 'Binions', notes: 'edited', updatedAt: LATER }), v1Casino({ id: 'c3', name: 'Four Queens', updatedAt: LATER })],
        [sess('s1', 'c1'), sess('s2', 'c2', LATER), sess('s3', 'c1', LATER), sess('s4', 'c3', LATER), sess('s5', 'c1', LATER)],
      ),
    );
    const log = loadCasinoLog();
    expect(log.casinos.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(log.sessions.map((x) => x.id)).toEqual(['s1', 's4', 's5']);
    expect(serializeExport(log, T0)).not.toContain('legacyIds');
    // Saved and loaded again, the ids are remembered.
    saveCasinoLog(log);
    expect(loadCasinoLog().legacyIds).toEqual({ casinos: ['c1', 'c2', 'c3'], sessions: ['s1', 's2', 's3', 's4', 's5'] });
  });

  it('re-review R1: a log saved before R1 learns the v1 ids from the blob it already took in', () => {
    store.map.set(LEGACY_CASINO_LOG_KEY, v1Blob([v1Casino(), v1Casino({ id: 'c2', name: 'Binions' })]));
    const first = loadCasinoLog();
    const { legacyIds: _drop, ...preR1 } = deleteCasino(first, 'c2');
    void _drop;
    store.map.set(CASINO_LOG_KEY, JSON.stringify(preR1));
    const relearned = loadCasinoLog();
    expect(relearned.legacyIds).toEqual({ casinos: ['c1', 'c2'], sessions: [] });
    saveCasinoLog(relearned);
    store.map.set(LEGACY_CASINO_LOG_KEY, v1Blob([v1Casino(), v1Casino({ id: 'c2', name: 'Binions', updatedAt: LATER })]));
    expect(loadCasinoLog().casinos.map((c) => c.id)).toEqual(['c1']);
  });

  it('an unreadable v1 blob is kept aside, not merged and not lost', () => {
    upgraded();
    store.map.set(LEGACY_CASINO_LOG_KEY, '{"version":1,"casinos":[{"id":"c1"');
    const log = loadCasinoLog();
    expect(log.casinos[0]!.games).toHaveLength(2);
    expect(quarantinedCasinoLog()).toBe('{"version":1,"casinos":[{"id":"c1"');
  });

  it('review N8: a newer casino in a v1 export file keeps the games, drive time and spot here', () => {
    const local = upgraded();
    const file = JSON.stringify({ app: 'bjtrainer-casino-log', version: 1, casinos: [v1Casino({ notes: 'from the old phone', updatedAt: LATER })], sessions: [] });
    const r = mergeImport(local, file);
    if (!r.ok) throw new Error(r.error);
    const c = r.log.casinos[0]!;
    expect(c.notes).toBe('from the old phone\n\nfirst notes');
    expect(c.games.map((g) => g.id)).toEqual(['g-c1', 'g-dd']);
    expect(c.games[0]!.label).toBe('Main pit');
    expect(c.driveMinutes).toBe(25);
    expect(c.location).not.toBeNull();
    // A v2 file's newer record wins the casino's own fields; Wave W (review S3): the games here are kept beside its own.
    const v2 = JSON.stringify({ app: 'bjtrainer-casino-log', version: 2, casinos: [{ ...local.casinos[0]!, games: [blankGame('g-x')], driveMinutes: null, location: null, updatedAt: LATER }], sessions: [] });
    const r2 = mergeImport(local, v2);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.log.casinos[0]!.games.map((g) => g.id)).toEqual(['g-x', 'g-c1', 'g-dd']);
    expect(r2.log.casinos[0]!.driveMinutes).toBeNull();
  });

  it('review B1: the exit minutes are settings, 0 allowed, out of range refused, null clears', () => {
    let log = setCasinoSettings(emptyCasinoLog(), { exitFindMinutes: 0, exitWaitMinutes: 20 }, T0);
    expect(log.settings).toMatchObject({ exitFindMinutes: 0, exitWaitMinutes: 20 });
    log = setCasinoSettings(log, { exitFindMinutes: 500 }, T0);
    expect(log.settings.exitFindMinutes).toBeUndefined();
    log = setCasinoSettings(log, { exitWaitMinutes: null }, T0);
    expect(log.settings.exitWaitMinutes).toBeUndefined();
    const back = mergeImport(emptyCasinoLog(), serializeExport(setCasinoSettings(emptyCasinoLog(), { exitFindMinutes: 7 }, T0), T0));
    if (!back.ok) throw new Error(back.error);
    expect(back.log.settings.exitFindMinutes).toBe(7);
  });
});
