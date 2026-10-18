import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DIAG_BASE_KEY, listDiagKeys, segmentSeq } from './diagStore';

/**
 * G5: THE FLUSH APPENDS; IT NO LONGER REWRITES THE LOG.
 *
 * Every flush used to read the whole stored log back, parse it, append, and
 * write the whole thing again -- about 1.2MB each way, once a second, at the
 * cap. These pin the replacement by what it actually does to storage: the
 * characters each flush writes and reads are counted, not inferred.
 */

interface CountingStore {
  data: Record<string, string>;
  /** Characters passed to setItem since the last reset, by key. */
  written: { key: string; chars: number }[];
  /** Characters returned by getItem since the last reset. */
  readChars: number;
  reset(): void;
}

function installCountingStore(opts: { failSetItem?: (key: string) => boolean } = {}): CountingStore {
  const data: Record<string, string> = {};
  const counting: CountingStore = {
    data,
    written: [],
    readChars: 0,
    reset() {
      counting.written = [];
      counting.readChars = 0;
    },
  };
  const store: Storage = {
    getItem: (k) => {
      const v = k in data ? data[k]! : null;
      if (v !== null) counting.readChars += v.length;
      return v;
    },
    setItem: (k, v) => {
      if (opts.failSetItem?.(k)) {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      counting.written.push({ key: k, chars: String(v).length });
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
  };
  (globalThis as { localStorage?: Storage }).localStorage = store;
  return counting;
}

/** The stored log's keys, oldest first, through the app's own lister. */
function diagKeys(data: Record<string, string>): string[] {
  return listDiagKeys({
    getItem: (k: string) => (k in data ? data[k]! : null),
    key: (i: number) => Object.keys(data)[i] ?? null,
    get length() {
      return Object.keys(data).length;
    },
  });
}

function storedEvents(data: Record<string, string>): string[] {
  return diagKeys(data).flatMap((k) => (JSON.parse(data[k]!) as { event: string }[]).map((e) => e.event));
}

function storedChars(data: Record<string, string>): number {
  return diagKeys(data).reduce((n, k) => n + data[k]!.length, 0);
}

function sum(xs: { chars: number }[]): number {
  return xs.reduce((n, x) => n + x.chars, 0);
}

async function fresh(): Promise<typeof import('./diagnosticLog')> {
  vi.resetModules();
  return import('./diagnosticLog');
}

let store: CountingStore;
beforeEach(() => {
  store = installCountingStore();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

/** A realistic line: a heard transcript with a few fields, ~200 chars stored. */
function logLine(log: typeof import('./diagnosticLog'), i: number): void {
  log.diag('heard', `e${i}`, { heard: 'stand on sixteen against a ten', conf: 0.82, n: i });
}

describe('a flush writes only what is new', () => {
  it('writes exactly the new entries and reads nothing back, however big the log already is', async () => {
    const log = await fresh();
    for (let i = 0; i < 2000; i++) logLine(log, i);
    log.flushDiagnostics();
    expect(storedEvents(store.data)).toHaveLength(2000);
    const logBytes = storedChars(store.data);

    store.reset();
    for (let i = 2000; i < 2005; i++) logLine(log, i);
    log.flushDiagnostics();
    const flushRead = store.readChars;

    const fiveNew = log.readDiagnosticLog().slice(-5);
    expect(fiveNew.map((e) => e.event)).toEqual(['e2000', 'e2001', 'e2002', 'e2003', 'e2004']);
    // The whole write is the five entries as one JSON array -- not the log.
    expect(sum(store.written)).toBe(JSON.stringify(fiveNew).length);
    expect(store.written.every((w) => segmentSeq(w.key) !== null)).toBe(true);
    expect(sum(store.written), 'the flush rewrote the stored log').toBeLessThan(logBytes / 100);
    // ...and nothing stored was read back to do it (the old flush parsed it all).
    expect(flushRead, 'the flush read the stored log back').toBe(0);
  });

  it('at the cap, rewrites at most one segment to make room', async () => {
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES; i += 100) {
      for (let j = i; j < i + 100; j++) logLine(log, j);
      log.flushDiagnostics();
    }
    expect(storedEvents(store.data)).toHaveLength(log.MAX_ENTRIES);

    store.reset();
    for (let i = log.MAX_ENTRIES; i < log.MAX_ENTRIES + 5; i++) logLine(log, i);
    log.flushDiagnostics();
    const flushRead = store.readChars;

    const events = storedEvents(store.data);
    expect(events).toHaveLength(log.MAX_ENTRIES);
    expect(events[0]).toBe('e5');
    expect(events[events.length - 1]).toBe(`e${log.MAX_ENTRIES + 4}`);
    const newBytes = JSON.stringify(log.readDiagnosticLog().slice(-5)).length;
    // The new segment, plus the oldest segment cut down by five lines, plus
    // the drop counter. Never the log.
    expect(sum(store.written)).toBeLessThanOrEqual(newBytes + log.SEGMENT_TARGET_BYTES + 32);
    expect(flushRead).toBeLessThanOrEqual(log.SEGMENT_TARGET_BYTES + 32);
  });
});

describe('order', () => {
  it('reads back in logged order across many flushes, merges and a reload', async () => {
    const log = await fresh();
    let n = 0;
    // Far more flushes than MAX_SMALL_SEGMENTS, so small segments get merged.
    for (let f = 0; f < 150; f++) {
      for (let j = 0; j < 1 + (f % 3); j++) logLine(log, n++);
      log.flushDiagnostics();
    }
    const expected = Array.from({ length: n }, (_, i) => `e${i}`);
    expect(log.readDiagnosticLog().map((e) => e.event)).toEqual(expected);
    // The merge really ran: one key per flush would be 150.
    expect(diagKeys(store.data).length).toBeLessThanOrEqual(log.MAX_SMALL_SEGMENTS + 1);

    const reloaded = await fresh();
    expect(reloaded.readDiagnosticLog().map((e) => e.event)).toEqual(expected);
  });

  it('exports exactly what the single-key layout exported for the same entries', async () => {
    const log = await fresh();
    for (let f = 0; f < 60; f++) {
      logLine(log, f);
      log.flushDiagnostics();
    }
    const segmented = log.readDiagnosticLog();
    const segmentedText = log.formatDiagnosticLog(segmented);

    // The same entries, stored the way the previous build stored them.
    store = installCountingStore();
    store.data[DIAG_BASE_KEY] = JSON.stringify(segmented);
    const legacy = await fresh();
    expect(legacy.readDiagnosticLog()).toEqual(segmented);
    expect(legacy.formatDiagnosticLog(legacy.readDiagnosticLog())).toBe(segmentedText);
  });

  it("folds an older build's single key in ahead of the new entries", async () => {
    store.data[DIAG_BASE_KEY] = JSON.stringify(
      ['old0', 'old1', 'old2'].map((event, i) => ({
        at: '2026-10-01T10:00:00.000Z',
        ms: i,
        session: 'old',
        category: 'nav',
        event,
      })),
    );
    const log = await fresh();
    log.diag('nav', 'new0');
    log.flushDiagnostics();
    log.diag('nav', 'new1');
    log.flushDiagnostics();

    expect(store.data[DIAG_BASE_KEY], 'the legacy key was left to be rewritten').toBeUndefined();
    expect(storedEvents(store.data)).toEqual(['old0', 'old1', 'old2', 'new0', 'new1']);
    const reloaded = await fresh();
    expect(reloaded.readDiagnosticLog().map((e) => e.event)).toEqual(['old0', 'old1', 'old2', 'new0', 'new1']);
  });
});

describe('the caps, as before', () => {
  it('keeps exactly the newest MAX_ENTRIES and counts every one it dropped', async () => {
    const log = await fresh();
    const total = log.MAX_ENTRIES + 50;
    for (let i = 0; i < total; i += 37) {
      for (let j = i; j < Math.min(total, i + 37); j++) logLine(log, j);
      log.flushDiagnostics();
    }
    const events = storedEvents(store.data);
    expect(events).toEqual(Array.from({ length: log.MAX_ENTRIES }, (_, i) => `e${i + 50}`));
    expect(log.diagnosticEntriesDropped()).toBe(50);
  });

  it('keeps the stored log inside the byte cap, trimming the oldest first', async () => {
    const log = await fresh();
    const big = 'x'.repeat(1500);
    const total = 1200; // ~1.6KB each, well past MAX_BYTES in all
    for (let i = 0; i < total; i += 25) {
      for (let j = i; j < i + 25; j++) log.diag('heard', `e${j}`, { heard: big });
      log.flushDiagnostics();
      expect(storedChars(store.data), `past the byte cap after the flush ending at e${i + 24}`).toBeLessThanOrEqual(
        log.MAX_BYTES,
      );
    }
    const events = storedEvents(store.data);
    const first = Number(events[0]!.slice(1));
    expect(first, 'nothing was trimmed, so the cap was never exercised').toBeGreaterThan(0);
    // A contiguous newest run: the oldest went, nothing from the middle.
    expect(events).toEqual(Array.from({ length: total - first }, (_, i) => `e${first + i}`));
    expect(log.diagnosticEntriesDropped()).toBe(first);
    // And the trim takes no more than it must: one more line would not fit.
    expect(storedChars(store.data) + 1600).toBeGreaterThan(log.MAX_BYTES);
  });

  it('still cuts a single flush that is over the cap by itself', async () => {
    const log = await fresh();
    logLine(log, -1);
    log.flushDiagnostics();
    for (let i = 0; i < log.MAX_ENTRIES; i++) log.diag('heard', `e${i}`, { heard: 'y'.repeat(5000) });
    log.flushDiagnostics();
    expect(storedChars(store.data)).toBeLessThanOrEqual(log.MAX_BYTES);
    const events = storedEvents(store.data);
    expect(events).not.toContain('e-1');
    expect(events[events.length - 1]).toBe(`e${log.MAX_ENTRIES - 1}`);
    expect(log.diagnosticEntriesDropped()).toBe(log.MAX_ENTRIES + 1 - events.length);
  });
});

describe('a save that fails', () => {
  it('leaves no half-written flush behind, keeps the buffer, and says so', async () => {
    // Two segments' worth in one flush, and the second segment's write refused.
    let segmentWrites = 0;
    store = installCountingStore({
      failSetItem: (k) => segmentSeq(k) !== null && ++segmentWrites === 2,
    });
    const log = await fresh();
    for (let i = 0; i < 200; i++) logLine(log, i);
    log.flushDiagnostics();

    expect(segmentWrites, 'the flush never reached a second segment').toBe(2);
    expect(diagKeys(store.data), 'the first segment of a failed flush was left in storage').toEqual([]);
    const events = log.readDiagnosticLog().map((e) => e.event);
    // Each entry exactly once (not once from storage and again from the buffer).
    expect(events.filter((e) => e === 'e0')).toHaveLength(1);
    expect(events.slice(0, 200)).toEqual(Array.from({ length: 200 }, (_, i) => `e${i}`));
    expect(events).toContain('persist-failed');
  });
});

describe('another tab', () => {
  it('re-measures a segment the other tab rewrote, so the caps stay exact', async () => {
    let onStorage: ((e: Partial<StorageEvent>) => void) | null = null;
    (globalThis as { window?: unknown }).window = {
      addEventListener: (type: string, fn: (e: Partial<StorageEvent>) => void) => {
        if (type === 'storage') onStorage = fn;
      },
    };
    const log = await fresh();
    for (let i = 0; i < log.MAX_ENTRIES; i += 100) {
      for (let j = i; j < i + 100; j++) logLine(log, j);
      log.flushDiagnostics();
    }
    // The other tab trims the oldest segment down to two entries.
    const oldest = diagKeys(store.data)[0]!;
    const cut = (JSON.parse(store.data[oldest]!) as unknown[]).slice(-2);
    const before = (JSON.parse(store.data[oldest]!) as unknown[]).length;
    store.data[oldest] = JSON.stringify(cut);
    expect(onStorage, 'the log never listened for other tabs').not.toBeNull();
    onStorage!({ key: oldest, storageArea: localStorage });

    logLine(log, 99999);
    log.flushDiagnostics();
    // The log is now below the cap by what the other tab removed, so this
    // flush must drop nothing. A stale index would think it was full.
    expect(storedEvents(store.data)).toHaveLength(log.MAX_ENTRIES - (before - 2) + 1);
    expect(log.diagnosticEntriesDropped()).toBe(0);
  });
});
