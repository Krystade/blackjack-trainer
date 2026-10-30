import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { listDiagKeys, segmentKey } from './diagStore';

/**
 * B30: words heard in the car and audio device names are replaced once they
 * are past REDACT_AFTER_DAYS -- in storage, not only in the export -- and the
 * entries themselves (what happened, when) stay.
 */
let data: Record<string, string>;
beforeEach(() => {
  data = {};
  (globalThis as { localStorage?: Storage }).localStorage = {
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
  };
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

const DAY = 86_400_000;
const entry = (daysAgo: number, event: string, detail: Record<string, unknown>) => ({
  at: new Date(Date.now() - daysAgo * DAY).toISOString(),
  ms: 1,
  session: 'old',
  category: 'mic',
  event,
  detail,
});

function seed(): void {
  data[segmentKey(1)] = JSON.stringify([
    entry(45, 'heard', { heard: 'did you see her text', verdict: 'unmatched' }),
    entry(45, 'route', { labels: "Jack's AirPods", count: 1 }),
  ]);
  data[segmentKey(2)] = JSON.stringify([entry(2, 'heard', { heard: 'hit', verdict: 'action' })]);
}

function stored(): { event: string; detail?: Record<string, unknown> }[] {
  return listDiagKeys(localStorage).flatMap((k) => JSON.parse(data[k]!) as { event: string; detail?: Record<string, unknown> }[]);
}

describe('aged redaction of the diagnostic log (B30)', () => {
  it('rewrites old speech and device names in storage, keeps the entries and the recent words', async () => {
    seed();
    vi.resetModules();
    const log = await import('./diagnosticLog');
    log.diag('mic', 'session-start', { n: 1 });
    log.flushDiagnostics();
    const all = stored();
    expect(all.map((e) => e.event)).toEqual(['heard', 'route', 'heard', 'session-start']);
    expect(all[0]!.detail).toEqual({ heard: '[removed after 30 days]', verdict: 'unmatched' });
    expect(all[1]!.detail).toEqual({ labels: '[removed after 30 days]', count: 1 });
    expect(all[2]!.detail).toEqual({ heard: 'hit', verdict: 'action' });
    expect(JSON.stringify(data)).not.toContain('did you see her text');
    expect(JSON.stringify(data)).not.toContain('AirPods');
  });

  it('an export before the first flush already leaves them out', async () => {
    seed();
    vi.resetModules();
    const log = await import('./diagnosticLog');
    const text = log.formatDiagnosticLog(log.readDiagnosticLog());
    expect(text).not.toContain('did you see her text');
    expect(text).not.toContain('AirPods');
    expect(text).toContain('hit');
  });
});
