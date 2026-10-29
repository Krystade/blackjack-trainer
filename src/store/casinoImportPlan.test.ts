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
