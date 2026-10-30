import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { casinoLogFileText } from './crashSalvage';
import { blankCasinoDraft, emptyCasinoLog, mergeImport, saveCasino, saveCasinoLog, startSession } from '../store/casinoLog';

/**
 * B12: the crash screen's "Save casino log" writes a file the Casino tab's
 * own Import reads back -- and when the stored log cannot be parsed (the
 * parser may be what crashed), the raw bytes still ride along.
 */

const T0 = Date.parse('2026-10-18T19:00:00Z');
let map: Map<string, string>;

beforeEach(() => {
  map = new Map();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('casinoLogFileText', () => {
  it('round-trips a real log through the Casino Import', () => {
    const withCasino = saveCasino(emptyCasinoLog(), blankCasinoDraft('Wynn'), T0)!;
    const started = startSession(withCasino.log, withCasino.casino.id, T0, 500)!;
    expect(saveCasinoLog(started.log)).toBe(true);
    const text = casinoLogFileText(T0 + 1000);
    const r = mergeImport(emptyCasinoLog(), text);
    if (!r.ok) throw new Error(r.error);
    expect(r.log.casinos.map((c) => c.name)).toEqual(['Wynn']);
    expect(r.log.sessions).toHaveLength(1);
    expect(r.log.sessions[0]!.id).toBe(started.session.id);
  });

  it('carries unreadable stored bytes instead of dropping them', () => {
    map.set('bjtrainer.casinoLog.v3', '{"version":3,"casinos":[{"id":"c1"');
    const text = casinoLogFileText(T0);
    const out = JSON.parse(text) as { unreadable?: string };
    expect(JSON.stringify(out)).toContain('{\\"version\\":3,\\"casinos\\":[{\\"id\\":\\"c1\\"');
  });
});
