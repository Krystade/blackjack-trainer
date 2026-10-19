import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CASINO_LOG_KEY,
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
    const FUTURE = JSON.stringify({ version: 2, casinos: [{ id: 'c1', name: 'X' }], sessions: [] });
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
    expect(c.game).toEqual({ decks: null, s17: null, das: null, surrender: null, payout: '6:5', cutDecksLeft: null });
    expect(c.minBet).toBeNull();
    expect(c.status).toBe('ok');
    expect(c.midShoeEntry).toBe('unknown');
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
    expect(r.report).toEqual({ casinosAdded: 1, casinosUpdated: 0, sessionsAdded: 1, sessionsUpdated: 0, kept: 0, skipped: 0, extraRunning: 0 });
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
    expect(mergeImport(emptyCasinoLog(), '{"version":3,"casinos":[]}').ok).toBe(false);
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
