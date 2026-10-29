import { describe, it, expect } from 'vitest';
import { emptyCasinoLog, mergeImport, migrateCasinoLog, serializeExport, type CasinoLog } from './casinoLog';

/**
 * Wave W (review S3): an import or a paste never drops a game or a note
 * here, says what it would do to each casino before anything is saved, and
 * a casino named as one here under another id is merged into it or added
 * beside it, as asked.
 */

const AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-15T00:00:00.000Z';
const game = (id: string, over: Record<string, unknown> = {}) => ({ id, decks: 6, s17: false, midShoeEntry: 'no', csm: false, ...over });
const casino = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, status: 'ok', notes: '', createdAt: AT, updatedAt: AT, games: [game(`g-${id}`)], ...over });
const sess = (id: string, casinoId: string) => ({ id, casinoId, start: AT, end: AT, buyIns: [500], cashOut: 600, heat: 'none', notes: '', createdAt: AT, updatedAt: AT });

function logOf(casinos: unknown[], sessions: unknown[] = []): CasinoLog {
  return migrateCasinoLog({ version: 3, casinos, sessions, settings: { startingBankroll: null, updatedAt: null }, lastExportAt: null })!.log;
}
const file = (casinos: unknown[], sessions: unknown[] = []) => JSON.stringify({ app: 'bjtrainer-casino-log', version: 3, casinos, sessions });

describe('nothing here is dropped', () => {
  it('a newer record from the file keeps the games only this phone has, and the notes here', () => {
    const local = logOf([casino('c1', 'Nugget', { notes: 'Ray on swing', games: [game('g-a', { notes: 'pit 3' }), game('g-b')] })]);
    const inc = file([casino('c1', 'Nugget', { notes: 'Ask for Maria', updatedAt: LATER, games: [game('g-a', { notes: 'deep cut' }), game('g-c')] })]);
    const r = mergeImport(local, inc);
    if (!r.ok) throw new Error(r.error);
    const c = r.log.casinos[0]!;
    expect(c.games.map((g) => g.id)).toEqual(['g-a', 'g-c', 'g-b']);
    expect(c.notes).toBe('Ask for Maria\n\nRay on swing');
    expect(c.games[0]!.notes).toBe('deep cut\n\npit 3');
    // The same file again changes nothing.
    const again = mergeImport(r.log, inc);
    if (!again.ok) throw new Error(again.error);
    expect(again.log.casinos).toEqual(r.log.casinos);
    expect(again.report.casinos).toEqual([{ id: 'c1', name: 'Nugget', outcome: 'unchanged' }]);
  });

  it('notes that only grew on one side read as the longer, not twice', () => {
    const local = logOf([casino('c1', 'Nugget', { notes: 'Ray on swing' })]);
    const r = mergeImport(local, file([casino('c1', 'Nugget', { notes: 'Ray on swing. Maria on days.', updatedAt: LATER })]));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos[0]!.notes).toBe('Ray on swing. Maria on days.');
    const older = mergeImport(r.log, file([casino('c1', 'Nugget', { notes: 'Ray on swing' })]));
    if (!older.ok) throw new Error(older.error);
    expect(older.log.casinos[0]!.notes).toBe('Ray on swing. Maria on days.');
  });
});

describe('the preview: what the import does to each casino', () => {
  it('lists each casino in the file as added, updated or unchanged, and changes nothing until committed', () => {
    const local = logOf([casino('c1', 'Nugget'), casino('c2', 'Aria')]);
    const before = JSON.stringify(local);
    const r = mergeImport(local, file([casino('c1', 'Nugget', { notes: 'new', updatedAt: LATER }), casino('c2', 'Aria'), casino('c3', 'Bicycle')]));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.casinos).toEqual([
      { id: 'c1', name: 'Nugget', outcome: 'updated' },
      { id: 'c2', name: 'Aria', outcome: 'unchanged' },
      { id: 'c3', name: 'Bicycle', outcome: 'added' },
    ]);
    expect(JSON.stringify(local)).toBe(before);
  });
});

describe('a casino named as one here, under another id', () => {
  const local = () => logOf([casino('c1', 'Golden Nugget', { notes: 'here', games: [game('g-c1', { notes: 'pit 3' })] })], [sess('s1', 'c1')]);
  const inc = file([casino('x9', ' golden  nugget ', { notes: 'there', games: [game('g-x9', { decks: 2 })] })], [sess('s9', 'x9')]);

  it('is flagged, and by default merged into the one here, its sessions with it', () => {
    const r = mergeImport(local(), inc);
    if (!r.ok) throw new Error(r.error);
    expect(r.report.nameMatches).toEqual([{ id: 'x9', name: 'golden  nugget', localId: 'c1', choice: 'merge' }]);
    expect(r.log.casinos.map((c) => c.id)).toEqual(['c1']);
    const c = r.log.casinos[0]!;
    expect(c.name).toBe('Golden Nugget');
    expect(c.games.map((g) => g.id)).toEqual(['g-c1', 'g-x9']);
    expect(c.notes).toBe('here\n\nthere');
    expect(r.log.sessions.map((s) => [s.id, s.casinoId])).toEqual([
      ['s1', 'c1'],
      ['s9', 'c1'],
    ]);
    expect(r.report.casinos).toEqual([{ id: 'c1', name: 'Golden Nugget', outcome: 'updated' }]);
  });

  it('"add" keeps it as a casino of its own', () => {
    const r = mergeImport(local(), inc, { x9: 'add' });
    if (!r.ok) throw new Error(r.error);
    expect(r.report.nameMatches[0]!.choice).toBe('add');
    expect(r.log.casinos.map((c) => c.id)).toEqual(['c1', 'x9']);
    expect(r.log.sessions.find((s) => s.id === 's9')!.casinoId).toBe('x9');
  });

  it('the same id is never a name match, and an export of this log re-imports as unchanged', () => {
    const log = local();
    const r = mergeImport(log, serializeExport(log, Date.parse(LATER), null));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.nameMatches).toEqual([]);
    expect(r.report.casinos).toEqual([{ id: 'c1', name: 'Golden Nugget', outcome: 'unchanged' }]);
    expect(mergeImport(emptyCasinoLog(), serializeExport(log, 0, null)).ok).toBe(true);
  });
});

/*
 * Re-review R2: Jack keeps his casinos in a JSON file (v2, no versions) and
 * pastes it. Pala, two sessions at 6 decks; the file says 8. The change is
 * a rule change on the current version -- never a write into version 1,
 * which would say the two sessions were played at 8 decks.
 */
describe('a versionless file changing a game’s rules', () => {
  const PALA_GAME = { id: 'g-import-pala-1', decks: 6, s17: false, das: true, surrender: true, payout: '3:2', cutDecksLeft: null, minBet: null, maxBet: null, midShoeEntry: 'unknown', csm: false, roundsPerHour: null, doubleOn: 'any2', rsa: false, doubleSplitAces: false, maxSplitHands: 4, commissionPer100: 0 };
  const PALA = { id: 'c-import-pala', name: 'Pala', kind: 'casino', miles: 74, games: [PALA_GAME], driveMinutes: null, location: null, status: 'ok', burnedUntil: null, notes: 'Pit boss Ray. Good pen on T3.', createdAt: '2026-10-21T12:00:00.000Z', updatedAt: '2026-10-21T12:00:00.000Z' };
  const palaSess = (id: string, day: number) => ({ id, casinoId: 'c-import-pala', start: `2026-10-${day}T19:00:00.000Z`, end: `2026-10-${day}T22:00:00.000Z`, buyIns: [500], cashOut: 820, heat: 'none', notes: '', createdAt: `2026-10-${day}T19:00:00.000Z`, updatedAt: `2026-10-${day}T22:00:00.000Z` });
  const SESSIONS = [palaSess('s-pala-1', 22), palaSess('s-pala-2', 24)];
  /** The v2 log migrated: Pala's two sessions at its version 1. */
  const here = () => migrateCasinoLog({ version: 2, casinos: [PALA], sessions: SESSIONS, settings: { startingBankroll: null, updatedAt: null }, lastExportAt: null })!.log;
  const v2file = (game: Record<string, unknown>, updatedAt = '2026-10-28T12:00:00.000Z', sessions: unknown[] = SESSIONS) =>
    JSON.stringify({ app: 'bjtrainer-casino-log', version: 2, casinos: [{ ...PALA, games: [{ ...PALA_GAME, ...game }], updatedAt }], sessions });
  const pala = (log: CasinoLog) => log.casinos[0]!.games[0]!;

  it('lists the change; a game with sessions defaults to a new version, which keeps version 1 and its sessions at 6 decks', () => {
    const log = here();
    expect(pala(log).versions!.map((v) => [v.versionId, v.rules.decks])).toEqual([['g-import-pala-1-v1', 6]]);
    const r = mergeImport(log, v2file({ decks: 8 }));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.ruleChanges).toHaveLength(1);
    const ch = r.report.ruleChanges[0]!;
    expect(ch).toMatchObject({ key: 'c-import-pala/g-import-pala-1', casinoName: 'Pala', sessions: 2, choice: 'new' });
    expect(ch.prev.decks).toBe(6);
    expect(ch.next.decks).toBe(8);
    const g = pala(r.log);
    expect(g.decks).toBe(8);
    expect(g.versions!.map((v) => v.rules.decks)).toEqual([6, 8]);
    expect(g.versions![0]!.versionId).toBe('g-import-pala-1-v1');
    expect(g.versionId).toBe(g.versions![1]!.versionId);
    expect(r.log.sessions.map((s) => s.versionId)).toEqual(['g-import-pala-1-v1', 'g-import-pala-1-v1']);
    // The same file again: nothing more.
    const again = mergeImport(r.log, v2file({ decks: 8 }));
    if (!again.ok) throw new Error(again.error);
    expect(again.report.ruleChanges).toEqual([]);
    expect(pala(again.log)).toEqual(g);
  });

  it('"Fix this version" corrects the current version in place; "Keep" takes none of the file’s rules', () => {
    const fix = mergeImport(here(), v2file({ decks: 8 }), {}, { 'c-import-pala/g-import-pala-1': 'fix' });
    if (!fix.ok) throw new Error(fix.error);
    expect(pala(fix.log).versions!.map((v) => [v.versionId, v.rules.decks])).toEqual([['g-import-pala-1-v1', 8]]);
    const keep = mergeImport(here(), v2file({ decks: 8 }), {}, { 'c-import-pala/g-import-pala-1': 'keep' });
    if (!keep.ok) throw new Error(keep.error);
    expect(pala(keep.log).decks).toBe(6);
    expect(pala(keep.log).versions!.map((v) => v.rules.decks)).toEqual([6]);
    // The casino's own fields still came in (the record is newer).
    expect(keep.log.casinos[0]!.updatedAt).toBe('2026-10-28T12:00:00.000Z');
  });

  it('never writes an earlier version: after a new version here, a file with version 1’s old rules changes only the current one', () => {
    const r = mergeImport(here(), v2file({ decks: 8 }));
    if (!r.ok) throw new Error(r.error);
    // The file now says surrender off (and still 8 decks): one change, on the current version.
    const r2 = mergeImport(r.log, v2file({ decks: 8, surrender: false }, '2026-10-29T12:00:00.000Z'), {}, { 'c-import-pala/g-import-pala-1': 'fix' });
    if (!r2.ok) throw new Error(r2.error);
    const g = pala(r2.log);
    expect(g.versions!.map((v) => [v.rules.decks, v.rules.surrender])).toEqual([
      [6, true],
      [8, false],
    ]);
  });

  it('a game with no sessions defaults to a fix; a file older than the record here defaults to keep', () => {
    const none = migrateCasinoLog({ version: 2, casinos: [PALA], sessions: [], settings: { startingBankroll: null, updatedAt: null }, lastExportAt: null })!.log;
    const r = mergeImport(none, v2file({ decks: 8 }, undefined, []));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.ruleChanges[0]!.choice).toBe('fix');
    expect(pala(r.log).versions!.map((v) => v.rules.decks)).toEqual([8]);
    const old = mergeImport(here(), v2file({ decks: 8 }, '2026-10-01T00:00:00.000Z'));
    if (!old.ok) throw new Error(old.error);
    expect(old.report.ruleChanges[0]!.choice).toBe('keep');
    expect(pala(old.log).decks).toBe(6);
  });

  it('a v3 file (the app’s own export, with versions) asks nothing: its versions merge by id as before', () => {
    const log = here();
    const r = mergeImport(log, serializeExport(log, 0, null));
    if (!r.ok) throw new Error(r.error);
    expect(r.report.ruleChanges).toEqual([]);
  });
});

/*
 * Re-review R4: the owner edits a casino's notes in the app (adds a line,
 * the text re-flowed), then pastes his older file again. The notes here
 * already hold the file's text: it is not appended a second time.
 */
describe('re-import after an in-app notes edit', () => {
  it('the file’s notes, already in the notes here (whitespace aside), are not appended again', () => {
    const fileText = 'Pit boss Ray. Good pen on T3.';
    const local = logOf([casino('c1', 'Pala', { notes: 'Pit boss Ray.\nGood pen on T3.\n\nAsk for Maria on days.', updatedAt: LATER })]);
    for (const updatedAt of [AT, '2026-10-20T00:00:00.000Z']) {
      const r = mergeImport(local, JSON.stringify({ app: 'bjtrainer-casino-log', version: 2, casinos: [casino('c1', 'Pala', { notes: fileText, updatedAt })], sessions: [] }));
      if (!r.ok) throw new Error(r.error);
      expect(r.log.casinos[0]!.notes).toBe('Pit boss Ray.\nGood pen on T3.\n\nAsk for Maria on days.');
    }
  });

  it('a note that only shares letters is still kept beside', () => {
    const local = logOf([casino('c1', 'Pala', { notes: 'Raymond on nights' })]);
    const r = mergeImport(local, file([casino('c1', 'Pala', { notes: 'Ray', updatedAt: LATER })]));
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos[0]!.notes).toBe('Ray\n\nRaymond on nights');
  });
});
