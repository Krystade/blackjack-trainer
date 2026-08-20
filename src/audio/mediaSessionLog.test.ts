import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendLog, readLog, clearLog, formatLog } from './mediaSessionLog';

/**
 * This log exists because the person who can answer "what does the car send?"
 * is driving. It therefore has to survive a mid-drive reload (the update
 * check can navigate the app), tolerate a hostile storage layer, and never
 * throw into the audio path it is instrumenting.
 */

const store = new Map<string, string>();
const originalLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

function setStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  store.clear();
  setStorage({
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});

afterEach(() => {
  setStorage(originalLocalStorage);
});

describe('appendLog / readLog', () => {
  it('persists entries so they survive a reload mid-drive', () => {
    appendLog({ kind: 'register', action: 'play', ok: true });
    appendLog({ kind: 'invoke', action: 'play', ok: true });

    // A fresh read goes back through storage, exactly as a reloaded app would.
    const entries = readLog();
    expect(entries.map((e) => `${e.kind}:${e.action}`)).toEqual(['register:play', 'invoke:play']);
    expect(entries[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records a refusal with its reason', () => {
    appendLog({ kind: 'register', action: 'seekto', ok: false, detail: 'NotSupportedError' });
    expect(readLog()[0]).toMatchObject({ ok: false, detail: 'NotSupportedError' });
  });

  it('keeps the newest entries once capped', () => {
    for (let i = 0; i < 250; i += 1) {
      appendLog({ kind: 'invoke', action: `a${i}`, ok: true });
    }
    const entries = readLog();
    expect(entries).toHaveLength(200);
    expect(entries.at(-1)!.action).toBe('a249');
  });
});

describe('resilience', () => {
  it('returns nothing rather than throwing on a corrupt log', () => {
    store.set('bjtrainer.mediaSessionLog.v1', 'not json{');
    expect(readLog()).toEqual([]);
  });

  it('drops malformed entries but keeps good ones', () => {
    store.set(
      'bjtrainer.mediaSessionLog.v1',
      JSON.stringify([{ at: '2026-01-01T00:00:00Z', kind: 'invoke', action: 'play', ok: true }, null, 42, {}]),
    );
    expect(readLog()).toHaveLength(1);
  });

  // A full quota must not throw into an utterance that is mid-playback.
  it('swallows a storage write failure', () => {
    setStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    });
    expect(() => appendLog({ kind: 'invoke', action: 'play', ok: true })).not.toThrow();
  });

  it('is inert with no storage at all', () => {
    setStorage(undefined);
    expect(() => appendLog({ kind: 'invoke', action: 'play', ok: true })).not.toThrow();
    expect(readLog()).toEqual([]);
  });
});

describe('formatLog', () => {
  it('separates what was accepted from what the car actually sent', () => {
    appendLog({ kind: 'register', action: 'play', ok: true });
    appendLog({ kind: 'register', action: 'seekto', ok: false, detail: 'NotSupportedError' });
    appendLog({ kind: 'invoke', action: 'nexttrack', ok: true });

    const text = formatLog();
    expect(text).toContain('accepted by this browser: play');
    expect(text).toContain('refused: seekto');
    // The headline finding: a real car emitted this, which no desk test shows.
    expect(text).toContain('ACTUALLY SENT BY THE CAR: nexttrack');
  });

  it('says so plainly when the car has sent nothing yet', () => {
    appendLog({ kind: 'register', action: 'play', ok: true });
    expect(formatLog()).toContain('ACTUALLY SENT BY THE CAR: (nothing yet)');
  });

  it('deduplicates repeated presses in the summary', () => {
    appendLog({ kind: 'invoke', action: 'play', ok: true });
    appendLog({ kind: 'invoke', action: 'play', ok: true });
    const summaryLine = formatLog()
      .split('\n')
      .find((l) => l.startsWith('ACTUALLY SENT'))!;
    expect(summaryLine).toBe('ACTUALLY SENT BY THE CAR: play');
  });
});

describe('clearLog', () => {
  it('empties the log', () => {
    appendLog({ kind: 'invoke', action: 'play', ok: true });
    clearLog();
    expect(readLog()).toEqual([]);
  });
});
