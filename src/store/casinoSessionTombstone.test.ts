import { describe, it, expect } from 'vitest';
import {
  blankCasinoDraft,
  deleteSession,
  emptyCasinoLog,
  endSession,
  mergeImport,
  migrateCasinoLog,
  saveCasino,
  serializeExport,
  startSession,
} from './casinoLog';

/**
 * B15: a session deleted on the phone does not come back on every Import or
 * Paste of an older file that still holds it -- unless asked for.
 */
const T0 = Date.parse('2026-10-18T19:00:00Z');

function twoSessions() {
  const c = saveCasino(emptyCasinoLog(), blankCasinoDraft('Wynn'), T0)!;
  const a = startSession(c.log, c.casino.id, T0, 500)!;
  const aEnd = endSession(a.log, a.session.id, { cashOut: 700 } as Parameters<typeof endSession>[2], T0 + 3_600_000);
  const b = startSession(aEnd, c.casino.id, T0 + 7_200_000, 500)!;
  return { log: b.log, keep: a.session.id, dup: b.session.id };
}

describe('deleted sessions (B15)', () => {
  it('an older file does not bring a deleted session back, and says it left it out', () => {
    const { log, keep, dup } = twoSessions();
    const file = serializeExport(log, T0 + 8_000_000, null);
    const after = deleteSession(log, dup, T0 + 9_000_000);
    expect(after.sessions.map((s) => s.id)).toEqual([keep]);

    const r = mergeImport(after, file);
    if (!r.ok) throw new Error(r.error);
    expect(r.log.sessions.map((s) => s.id)).toEqual([keep]);
    expect(r.report.sessionsAdded).toBe(0);
    expect(r.report.deleted).toEqual([{ id: dup, name: expect.stringMatching(/^Wynn, 2026-10-1\d, buy-in \$500$/), restore: false, kind: 'session' }]);
    // Still remembered for the next import.
    expect(r.log.deletedSessions?.map((d) => d.id)).toEqual([dup]);
  });

  it('comes back when ticked, and is then forgotten as deleted', () => {
    const { log, dup } = twoSessions();
    const file = serializeExport(log, T0, null);
    const after = deleteSession(log, dup, T0 + 9_000_000);
    const r = mergeImport(after, file, {}, {}, { [dup]: true });
    if (!r.ok) throw new Error(r.error);
    expect(r.log.sessions.map((s) => s.id)).toContain(dup);
    expect(r.log.deletedSessions).toBeUndefined();
  });

  it('survives a save and read, and never goes into an export', () => {
    const { log, dup } = twoSessions();
    const after = deleteSession(log, dup, T0);
    expect(migrateCasinoLog(JSON.parse(JSON.stringify(after)))!.log.deletedSessions).toEqual(after.deletedSessions);
    expect(serializeExport(after, 0, null)).not.toContain('deletedSessions');
  });
});
