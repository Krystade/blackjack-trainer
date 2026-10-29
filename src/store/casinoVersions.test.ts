import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CASINO_LOG_KEY,
  PREV_CASINO_LOG_KEY,
  _setCasinoStorage,
  blankGame,
  deleteSession,
  earlierVersions,
  emptyCasinoLog,
  loadCasinoLog,
  mergeImport,
  saveCasino,
  saveCasinoLog,
  serializeExport,
  startSession,
  versionAt,
  type Casino,
  type CasinoGame,
  type CasinoLog,
  type VersionChoice,
} from './casinoLog';

/**
 * Wave W (review S2): VERSIONS OF A GAME. A rule the casino changed makes a
 * new version and the old rules keep their sessions; a rule entered wrong is
 * corrected in place; the v2 log migrates with every session kept; a merge
 * keeps every version either side has.
 */

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}
let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setCasinoStorage(store);
});
afterEach(() => _setCasinoStorage(null));

const AT = '2026-09-01T00:00:00.000Z';
const LATER = '2026-10-01T00:00:00.000Z';
const T1 = Date.parse('2026-10-10T00:00:00.000Z');
const T2 = Date.parse('2026-10-20T00:00:00.000Z');

const sess = (id: string, casinoId: string, over: Record<string, unknown> = {}) => ({
  id, casinoId, start: AT, end: AT, buyIns: [500], cashOut: 700, heat: 'none', notes: `note ${id}`, createdAt: AT, updatedAt: AT, ...over,
});
const GAME = { id: 'g-one', label: 'Shoe', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: 1.5, minBet: 25, maxBet: 1000, midShoeEntry: 'no', csm: false, roundsPerHour: 80 };
/** A log as the build before versions wrote it. */
const V2 = {
  version: 2,
  casinos: [
    { id: 'c1', name: 'One Game', notes: 'n1', status: 'ok', createdAt: AT, updatedAt: AT, games: [GAME] },
    { id: 'c2', name: 'Two Games', notes: 'n2', status: 'ok', createdAt: AT, updatedAt: AT, games: [{ ...GAME, id: 'g-a' }, { ...GAME, id: 'g-b', decks: 2 }] },
  ],
  sessions: [sess('s1', 'c1'), sess('s2', 'c1', { avgBet: 50, maxTc: 4, tables: 'pit 2' }), sess('s3', 'c2')],
  settings: { startingBankroll: 5000, updatedAt: AT },
  lastExportAt: AT,
};

describe('the v2 -> v3 migration', () => {
  it('gives every game its version 1, attaches the one-game casino’s sessions to it, and loses nothing', () => {
    const v2 = JSON.stringify(V2);
    store.map.set(PREV_CASINO_LOG_KEY, v2);
    const log = loadCasinoLog();
    expect(log.version).toBe(3);
    const one = log.casinos[0]!.games[0]!;
    expect(one.versionId).toBe('g-one-v1');
    expect(one.versions).toEqual([{ versionId: 'g-one-v1', createdAt: AT, updatedAt: AT, rules: expect.objectContaining({ decks: 6, das: true, minBet: 25 }) }]);
    expect(one.versions![0]!.rules).not.toHaveProperty('label');
    expect(one.versions![0]!.rules).not.toHaveProperty('roundsPerHour');
    expect(log.casinos[1]!.games.map((g) => g.versionId)).toEqual(['g-a-v1', 'g-b-v1']);
    // Every session, every field, kept; at the casino of one game, attached to its version 1.
    expect(log.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(log.sessions[0]).toMatchObject({ casinoId: 'c1', gameId: 'g-one', versionId: 'g-one-v1', notes: 'note s1', cashOut: 700 });
    expect(log.sessions[1]).toMatchObject({ gameId: 'g-one', versionId: 'g-one-v1', avgBet: 50, maxTc: 4, tables: 'pit 2' });
    // At the casino of two it never said which: it stays the casino's.
    expect(log.sessions[2]!.casinoId).toBe('c2');
    expect(log.sessions[2]).not.toHaveProperty('gameId');
    expect(log.settings.startingBankroll).toBe(5000);

    // Saved: under the v3 key; the v2 bytes stay exactly as they were, the backup.
    expect(saveCasinoLog(log)).toBe(true);
    expect(store.map.get(PREV_CASINO_LOG_KEY)).toBe(v2);
    expect(JSON.parse(store.map.get(CASINO_LOG_KEY)!).version).toBe(3);
    expect(loadCasinoLog()).toEqual(log);
  });

  it('what a tab still on the old build writes to v2 since is merged in, and what was deleted here stays deleted', () => {
    store.map.set(PREV_CASINO_LOG_KEY, JSON.stringify(V2));
    expect(saveCasinoLog(deleteSession(loadCasinoLog(), 's3'))).toBe(true);
    // The old tab, still holding s3, edits a casino's notes and adds a session.
    store.map.set(
      PREV_CASINO_LOG_KEY,
      JSON.stringify({ ...V2, casinos: [{ ...V2.casinos[0], notes: 'old tab', updatedAt: LATER }, V2.casinos[1]], sessions: [...V2.sessions, sess('s4', 'c1', { updatedAt: LATER })] }),
    );
    const log = loadCasinoLog();
    expect(log.casinos[0]!.notes).toBe('old tab');
    expect(log.sessions.map((s) => s.id)).toEqual(['s1', 's2', 's4']);
    // The game kept its version through the old tab's record.
    expect(log.casinos[0]!.games[0]!.versionId).toBe('g-one-v1');
    // The fingerprints are bookkeeping, never exported.
    const file = serializeExport(log, T1, null);
    expect(file).not.toContain('prevSeen');
    expect(file).not.toContain('prevIds');
  });

  it('a blob newer than v3 is refused, not flattened', () => {
    store.map.set(CASINO_LOG_KEY, JSON.stringify({ version: 4, casinos: [{ id: 'c', name: 'X' }], sessions: [] }));
    expect(loadCasinoLog().casinos).toEqual([]);
  });
});

/** The migrated log, with one more session at the one-game casino. */
function migrated(): CasinoLog {
  store.map.set(PREV_CASINO_LOG_KEY, JSON.stringify(V2));
  return loadCasinoLog();
}
const c1 = (log: CasinoLog): Casino => log.casinos.find((c) => c.id === 'c1')!;
const draftWith = (c: Casino, patch: Partial<CasinoGame>, i = 0) => ({ ...c, games: c.games.map((g, j) => (j === i ? { ...g, ...patch } : g)) });

describe('a rule change: a new version, or a fix', () => {
  it('"New version": the old rules kept, with their sessions; the new ones current; the next session at them', () => {
    const log = migrated();
    const r = saveCasino(log, draftWith(c1(log), { surrender: false, minBet: 50 }), T1, 'c1', { 'g-one': 'new' })!;
    const g = r.casino.games[0]!;
    expect(g.id).toBe('g-one');
    expect(g.versionId).not.toBe('g-one-v1');
    expect(g.versionId).toMatch(/^v-/);
    expect(g.versions!.map((v) => v.versionId)).toEqual(['g-one-v1', g.versionId]);
    expect(g.versions![0]!.rules).toMatchObject({ surrender: true, minBet: 25 });
    expect(g.versions![1]).toMatchObject({ createdAt: new Date(T1).toISOString(), rules: expect.objectContaining({ surrender: false, minBet: 50 }) });
    expect(g).toMatchObject({ surrender: false, minBet: 50 });
    expect(earlierVersions(g).map((v) => v.versionId)).toEqual(['g-one-v1']);
    // The old sessions stay with the old rules.
    expect(r.log.sessions.filter((s) => s.casinoId === 'c1').map((s) => s.versionId)).toEqual(['g-one-v1', 'g-one-v1']);
    const started = startSession(r.log, 'c1', T2)!;
    expect(started.session).toMatchObject({ gameId: 'g-one', versionId: g.versionId });
    // Saved and read back, unchanged.
    saveCasinoLog(started.log);
    expect(c1(loadCasinoLog()).games[0]).toEqual(g);
  });

  it('"Fix this version", or a version with no data (no choice): corrected in place, the same version', () => {
    const log = migrated();
    const choices: Record<string, VersionChoice>[] = [{ 'g-one': 'fix' }, {}];
    for (const choice of choices) {
      const g = saveCasino(log, draftWith(c1(log), { surrender: false }), T1, 'c1', choice)!.casino.games[0]!;
      expect(g.versionId).toBe('g-one-v1');
      expect(g.versions).toHaveLength(1);
      expect(g.versions![0]).toMatchObject({ createdAt: AT, updatedAt: new Date(T1).toISOString(), rules: expect.objectContaining({ surrender: false }) });
    }
  });

  it('a change to what is not a rule (label, notes, pace) or only to a "?" makes no version, whatever is asked', () => {
    const log = migrated();
    const g = saveCasino(log, draftWith(c1(log), { label: 'Main', notes: 'x', roundsPerHour: 60, unsure: ['das'] }), T1, 'c1', { 'g-one': 'new' })!.casino.games[0]!;
    expect(g.versionId).toBe('g-one-v1');
    expect(g.versions).toHaveLength(1);
    // The "?" rides with the rules it marks.
    expect(g.versions![0]!.rules.unsure).toEqual(['das']);
    expect(g.versions![0]!.rules).not.toHaveProperty('label');
  });

  it('a game added to a casino begins its version 1 when it is added', () => {
    const log = migrated();
    const c = log.casinos[1]!;
    const added = { ...blankGame('g-new'), decks: 1 as const };
    const g = saveCasino(log, { ...c, games: [...c.games, added] }, T1, c.id)!.casino.games[2]!;
    expect(g.versions).toEqual([{ versionId: 'g-new-v1', createdAt: new Date(T1).toISOString(), updatedAt: new Date(T1).toISOString(), rules: expect.objectContaining({ decks: 1 }) }]);
  });

  it('versionAt: the version current at a moment', () => {
    const log = migrated();
    const g = saveCasino(log, draftWith(c1(log), { decks: 8 }), T1, 'c1', { 'g-one': 'new' })!.casino.games[0]!;
    expect(versionAt(g, '2026-10-05T00:00:00.000Z').versionId).toBe('g-one-v1');
    expect(versionAt(g, '2026-10-15T00:00:00.000Z').versionId).toBe(g.versionId);
    expect(versionAt(g, '2020-01-01T00:00:00.000Z').versionId).toBe('g-one-v1');
  });

  it('startSession: a one-game casino needs no game named; at several, the one named, else "several"', () => {
    const log = migrated();
    expect(startSession(log, 'c2', T1)!.session).not.toHaveProperty('gameId');
    expect(startSession(log, 'c2', T1, null, 'g-b')!.session).toMatchObject({ gameId: 'g-b', versionId: 'g-b-v1' });
    expect(startSession(log, 'c1', T1, null, null)!.session).not.toHaveProperty('gameId');
  });
});

describe('merging two copies: every version either has', () => {
  /** Here: a new version made at T1. There (another phone, from the same start): its own made at T2, and the record touched later. */
  function twoPhones() {
    const base = migrated();
    const here = saveCasino(base, draftWith(c1(base), { surrender: false }), T1, 'c1', { 'g-one': 'new' })!.log;
    const there = saveCasino(base, draftWith(c1(base), { minBet: 100 }), T2, 'c1', { 'g-one': 'new' })!.log;
    return { here, there };
  }

  it('union by version id, the newest current, its rules the game’s -- whichever record is newer', () => {
    const { here, there } = twoPhones();
    const r = mergeImport(here, serializeExport(there, T2, null));
    if (!r.ok) throw new Error(r.error);
    const g = c1(r.log).games[0]!;
    const theirs = c1(there).games[0]!;
    const mine = c1(here).games[0]!;
    expect(g.versions!.map((v) => v.versionId)).toEqual(['g-one-v1', mine.versionId, theirs.versionId]);
    expect(g.versionId).toBe(theirs.versionId);
    expect(g).toMatchObject({ minBet: 100, surrender: true });
    expect(r.report.casinosUpdated).toBe(1);
    // The other way round: the same versions, the same current one.
    const back = mergeImport(there, serializeExport(here, T2, null));
    if (!back.ok) throw new Error(back.error);
    expect(c1(back.log).games[0]!.versions).toEqual(g.versions);
    expect(c1(back.log).games[0]!.versionId).toBe(theirs.versionId);
    // A second import changes nothing.
    const again = mergeImport(r.log, serializeExport(there, T2, null));
    if (!again.ok) throw new Error(again.error);
    expect(again.report).toMatchObject({ casinosUpdated: 0, casinosAdded: 0 });
    expect(again.log.casinos).toEqual(r.log.casinos);
  });

  it('an older record still brings its versions in, and never takes one away', () => {
    const { here, there } = twoPhones();
    // Here is touched last: its record wins, but the other phone's version comes in.
    const newer = saveCasino(here, { ...c1(here), notes: 'latest' }, T2 + 1000, 'c1')!.log;
    const r = mergeImport(newer, serializeExport(there, T2, null));
    if (!r.ok) throw new Error(r.error);
    expect(c1(r.log).notes).toBe('latest');
    expect(c1(r.log).games[0]!.versions).toHaveLength(3);
  });

  it('one version fixed in place on both: the later fix wins', () => {
    const base = migrated();
    const a = saveCasino(base, draftWith(c1(base), { cutDecksLeft: 2 }), T1, 'c1', { 'g-one': 'fix' })!.log;
    const b = saveCasino(base, draftWith(c1(base), { cutDecksLeft: 1 }), T2, 'c1', { 'g-one': 'fix' })!.log;
    const r = mergeImport(a, serializeExport(b, T2, null));
    if (!r.ok) throw new Error(r.error);
    const g = c1(r.log).games[0]!;
    expect(g.versions).toHaveLength(1);
    expect(g.cutDecksLeft).toBe(1);
  });

  it('the export carries versions and the sessions’ game and version, and imports into an empty log exactly', () => {
    const log = migrated();
    const file = serializeExport(log, T1, null);
    expect(JSON.parse(file).version).toBe(3);
    const r = mergeImport(emptyCasinoLog(), file);
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos).toEqual(log.casinos);
    expect(r.log.sessions).toEqual(log.sessions);
  });

  it('a v2 export file (the old build’s) migrates on import exactly as the stored v2 log does', () => {
    const r = mergeImport(emptyCasinoLog(), JSON.stringify({ app: 'bjtrainer-casino-log', ...V2 }));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos).toEqual(migrated().casinos);
    expect(r.log.sessions).toEqual(migrated().sessions);
  });
});
