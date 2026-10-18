import { describe, it, expect, afterEach } from 'vitest';
import { _setStorage, saveStats, loadStats } from './persist';
import { onStorageFailure, shrinkDiagnostics, _resetStorageHealthForTest, type StorageFailure } from './storageHealth';
import { DIAG_BASE_KEY, listDiagKeys, segmentKey } from '../diag/diagStore';

/**
 * F24 AFTER G5: the diagnostic log is a run of segment keys, and a save into a
 * full localStorage still has to be able to make room by shrinking it -- then
 * still has to say so (the toast) when even that is not enough.
 */

/** A localStorage with a quota, counted in characters like the real one, and enumerable. */
function quotaStore(limit: number) {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const before = map.get(k);
      const delta = k.length + v.length - (before === undefined ? 0 : k.length + before.length);
      if (used() + delta > limit) {
        const e = new Error('quota');
        e.name = 'QuotaExceededError';
        throw e;
      }
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** `segments` segments of `per` entries each, numbered from 0, ms counting up. */
function seedSegments(store: ReturnType<typeof quotaStore>, segments: number, per: number): void {
  let ms = 0;
  for (let s = 0; s < segments; s++) {
    const entries = Array.from({ length: per }, () => ({
      at: '2026-10-16T00:00:00Z',
      ms: ms++,
      session: 's',
      category: 'nav',
      event: `entry-${ms}-${'x'.repeat(80)}`,
    }));
    store.map.set(segmentKey(s), JSON.stringify(entries));
  }
}

function remainingMs(store: ReturnType<typeof quotaStore>): number[] {
  return listDiagKeys(store).flatMap((k) => (JSON.parse(store.map.get(k)!) as { ms: number }[]).map((e) => e.ms));
}

afterEach(() => {
  _setStorage(null);
  _resetStorageHealthForTest();
});

describe('a save into a full localStorage, with the log in segments', () => {
  it('makes room by dropping the oldest segments, then saves', () => {
    const store = quotaStore(200_000);
    seedSegments(store, 15, 100); // 1500 entries, most of the quota
    _setStorage(store);
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));

    const stats = loadStats();
    stats.sessions = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}` }) as never);
    const ok = saveStats(stats);

    expect(ok, 'the save was dropped although the log could have made room').toBe(true);
    expect(failures).toEqual([]);
    const left = remainingMs(store);
    expect(left.length).toBeLessThan(1500);
    expect(left.length, 'more than the newest quarter was thrown away').toBeGreaterThanOrEqual(375);
    // The newest entries are the ones kept, as one contiguous run.
    expect(left[left.length - 1]).toBe(1499);
    expect(left).toEqual(Array.from({ length: left.length }, (_, i) => 1500 - left.length + i));
  });

  it('still reports the failure (the toast) when the log gave way and there is still no room', () => {
    const store = quotaStore(20_000);
    seedSegments(store, 2, 50);
    _setStorage(store);
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));

    const stats = loadStats();
    // Bigger than the whole quota: nothing the log frees can make it fit.
    stats.sessions = Array.from({ length: 2000 }, (_, i) => ({ id: `session-${i}` }) as never);
    const ok = saveStats(stats);

    expect(ok).toBe(false);
    expect(failures.map((f) => f.key)).toEqual(['bjtrainer.stats.v1']);
    expect(remainingMs(store).length, 'the log was not asked to give way first').toBeLessThan(100);
  });
});

describe('shrinkDiagnostics', () => {
  it('keeps the newest quarter of a segmented log and frees the rest', () => {
    const store = quotaStore(1_000_000);
    seedSegments(store, 8, 10);
    expect(shrinkDiagnostics(store)).toBe(true);
    expect(remainingMs(store)).toEqual(Array.from({ length: 20 }, (_, i) => 60 + i));
  });

  it('still slices an older build\'s single key', () => {
    const store = quotaStore(1_000_000);
    store.map.set(
      DIAG_BASE_KEY,
      JSON.stringify(Array.from({ length: 40 }, (_, ms) => ({ at: 'x', ms, session: 's', category: 'nav', event: 'e' }))),
    );
    expect(shrinkDiagnostics(store)).toBe(true);
    expect((JSON.parse(store.map.get(DIAG_BASE_KEY)!) as { ms: number }[]).map((e) => e.ms)).toEqual(
      Array.from({ length: 10 }, (_, i) => 30 + i),
    );
  });

  it('reports nothing freed when there is no log', () => {
    expect(shrinkDiagnostics(quotaStore(1000))).toBe(false);
  });
});
