import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The log runs in node here, which is the point: it has to work with no
 * localStorage at all (vitest), with a full one (a real phone at the end of a
 * long session), and with one that throws on access (private-mode Safari).
 * A logger that only works in the easy case is not a logger you can send into
 * a car.
 */

function installStorage(impl?: Partial<Storage>): Record<string, string> {
  const data: Record<string, string> = {};
  const store: Storage = {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    removeItem: (k) => {
      delete data[k];
    },
    clear: () => {
      for (const k of Object.keys(data)) delete data[k];
    },
    key: (i) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
    ...impl,
  };
  (globalThis as { localStorage?: Storage }).localStorage = store;
  return data;
}

function uninstallStorage(): void {
  delete (globalThis as { localStorage?: Storage }).localStorage;
}

// Imported lazily per test: the module captures a page-load id and a boot
// time at import, so a fresh copy is needed whenever a test cares about
// either, or about starting from an empty buffer.
async function fresh(): Promise<typeof import('./diagnosticLog')> {
  vi.resetModules();
  return import('./diagnosticLog');
}

beforeEach(() => {
  installStorage();
});

afterEach(() => {
  uninstallStorage();
});

describe('recording', () => {
  it('records an event and reads it straight back, before any flush', async () => {
    const log = await fresh();
    log.diag('mic', 'session-start', { n: 1 });

    const entries = log.readDiagnosticLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.category).toBe('mic');
    expect(entries[0]!.event).toBe('session-start');
    expect(entries[0]!.detail).toEqual({ n: 1 });
  });

  it('survives the page going away, which is when it matters most', async () => {
    const log = await fresh();
    log.diag('mic', 'session-end');
    log.flushDiagnostics();

    // A second module instance stands in for the next page load.
    const reloaded = await fresh();
    expect(reloaded.readDiagnosticLog().map((e) => e.event)).toContain('session-end');
  });

  it('stamps each page load so a reload is visible in the log', async () => {
    const first = await fresh();
    first.diag('env', 'page-load');
    first.flushDiagnostics();

    const second = await fresh();
    second.diag('env', 'page-load');

    const sessions = new Set(second.readDiagnosticLog().map((e) => e.session));
    expect(sessions.size).toBe(2);
  });

  it('drops undefined detail values rather than logging "undefined"', async () => {
    const log = await fresh();
    log.diag('mic', 'result', { heard: 'stand', said: undefined });
    expect(log.readDiagnosticLog()[0]!.detail).toEqual({ heard: 'stand' });
  });

  it('stringifies anything that is not a scalar, so nothing can be lost to JSON', async () => {
    const log = await fresh();
    log.diag('err', 'window-error', { error: new Error('boom') });
    expect(String(log.readDiagnosticLog()[0]!.detail!.error)).toContain('boom');
  });
});

describe('never getting in the way', () => {
  it('does not throw when there is no storage at all', async () => {
    uninstallStorage();
    const log = await fresh();
    expect(() => log.diag('mic', 'session-start')).not.toThrow();
    expect(() => log.flushDiagnostics()).not.toThrow();
    // Still readable in memory: a private window must not lose the session
    // the operator is having right now, only the one before it.
    expect(log.readDiagnosticLog()).toHaveLength(1);
  });

  it('does not throw when storage refuses the write', async () => {
    installStorage({
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    expect(() => log.flushDiagnostics()).not.toThrow();
  });

  it('does not throw when storage refuses to be read', async () => {
    installStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
    });
    const log = await fresh();
    log.diag('mic', 'session-start');
    expect(() => log.readDiagnosticLog()).not.toThrow();
  });

  it('ignores stored rubbish rather than failing to start', async () => {
    const data = installStorage();
    data['bjtrainer.diagnostics.v1'] = 'not json at all';
    const log = await fresh();
    expect(log.readDiagnosticLog()).toEqual([]);
  });
});

describe('staying small', () => {
  it('keeps the newest entries and drops the oldest', async () => {
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES + 50; i++) log.diag('mic', `e${i}`);
    log.flushDiagnostics();

    const events = log.readDiagnosticLog().map((e) => e.event);
    expect(events.length).toBeLessThanOrEqual(log.MAX_ENTRIES);
    expect(events).toContain(`e${log.MAX_ENTRIES + 49}`);
    expect(events).not.toContain('e0');
  });

  it('stays inside the byte cap even when single entries are huge', async () => {
    const data = installStorage();
    const log = await fresh();
    const big = 'x'.repeat(5000);
    for (let i = 0; i < 300; i++) {
      log.diag('heard', 'utterance', { heard: big });
      log.flushDiagnostics();
    }
    expect((data['bjtrainer.diagnostics.v1'] ?? '').length).toBeLessThanOrEqual(log.MAX_BYTES);
  });
});

describe('the pasteable form', () => {
  it('says so when there is nothing, rather than producing a bare header', async () => {
    const log = await fresh();
    expect(log.formatDiagnosticLog([])).toBe('Diagnostic log is empty.');
  });

  it('puts the elapsed time, the category and the detail on one line', async () => {
    const log = await fresh();
    log.diag('mic', 'session-end', { sessionMs: 45000 });
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());

    expect(text).toContain('session-end');
    expect(text).toContain('sessionMs=45000');
    expect(text).toContain('# Blackjack Trainer diagnostic log');
  });

  it('quotes a value containing spaces, so a transcript stays one field', async () => {
    const log = await fresh();
    log.diag('heard', 'utterance', { heard: 'how was your dad' });
    expect(log.formatDiagnosticLog(log.readDiagnosticLog())).toContain(
      'heard="how was your dad"',
    );
  });

  it('formats elapsed time as minutes and seconds', async () => {
    const log = await fresh();
    expect(log.formatElapsed(0)).toBe('0:00.000');
    expect(log.formatElapsed(83_400)).toBe('1:23.400');
  });
});

describe('the summary the Settings panel shows', () => {
  it('counts sessions, failures and phrases separately', async () => {
    const log = await fresh();
    log.diag('mic', 'session-start');
    log.diag('mic', 'session-start');
    log.diag('mic', 'session-end');
    log.diag('mic', 'session-error', { error: 'audio-capture' });
    log.diag('heard', 'utterance', { heard: 'stand' });

    const s = log.summariseDiagnostics(log.readDiagnosticLog());
    expect(s.micStarts).toBe(2);
    expect(s.micEnds).toBe(1);
    expect(s.micErrors).toBe(1);
    expect(s.heard).toBe(1);
    expect(s.total).toBe(5);
  });
});

describe('subscribers', () => {
  it('is told when something is recorded and when the log is cleared', async () => {
    const log = await fresh();
    let calls = 0;
    const off = log.subscribeDiagnostics(() => calls++);

    log.diag('mic', 'session-start');
    expect(calls).toBe(1);
    log.clearDiagnosticLog();
    expect(calls).toBe(2);

    off();
    log.diag('mic', 'session-start');
    expect(calls).toBe(2);
  });

  it('survives a subscriber that throws', async () => {
    const log = await fresh();
    log.subscribeDiagnostics(() => {
      throw new Error('the panel exploded');
    });
    expect(() => log.diag('mic', 'session-start')).not.toThrow();
    expect(log.readDiagnosticLog()).toHaveLength(1);
  });
});

describe('clearing', () => {
  it('removes both the stored log and anything still buffered', async () => {
    const log = await fresh();
    log.diag('mic', 'a');
    log.flushDiagnostics();
    log.diag('mic', 'b');

    log.clearDiagnosticLog();
    expect(log.readDiagnosticLog()).toEqual([]);
  });
});
