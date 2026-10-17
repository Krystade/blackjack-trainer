import { describe, it, expect, afterEach } from 'vitest';
import { _setStorage, saveStats, loadStats } from './persist';
import {
  DIAGNOSTICS_KEY,
  onStorageFailure,
  requestPersistentStorage,
  _resetStorageHealthForTest,
  type StorageFailure,
} from './storageHealth';

/** A localStorage with a quota, counted in characters like the real one. */
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
  };
}

afterEach(() => {
  _setStorage(null);
  _resetStorageHealthForTest();
});

function bigDiagLog(entries: number): string {
  return JSON.stringify(
    Array.from({ length: entries }, (_, i) => ({
      at: '2026-10-16T00:00:00Z',
      ms: i,
      session: 's',
      category: 'nav',
      event: `entry-${i}-${'x'.repeat(80)}`,
    })),
  );
}

describe('a save into a full localStorage', () => {
  it('makes room by shrinking the diagnostic log, then saves', async () => {
    const store = quotaStore(200_000);
    store.map.set(DIAGNOSTICS_KEY, bigDiagLog(1500)); // most of the quota
    _setStorage(store);
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));

    const stats = loadStats();
    stats.sessions = Array.from({ length: 300 }, (_, i) => ({ id: `s${i}` }) as never);
    const ok = saveStats(stats);

    expect(ok, 'the save was dropped although the log could have made room').toBe(true);
    expect(failures).toEqual([]);
    const left = JSON.parse(store.map.get(DIAGNOSTICS_KEY)!) as { ms: number }[];
    expect(left.length).toBeLessThan(1500);
    // The newest entries are the ones kept.
    expect(left[left.length - 1]!.ms).toBe(1499);
  });

  it('reports the failure when there is still no room', () => {
    const store = quotaStore(50);
    _setStorage(store);
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));

    const ok = saveStats(loadStats());

    expect(ok).toBe(false);
    expect(failures.map((f) => f.key)).toEqual(['bjtrainer.stats.v1']);
  });

  it('reports nothing when the save lands', () => {
    _setStorage(quotaStore(1_000_000));
    const failures: StorageFailure[] = [];
    onStorageFailure((f) => failures.push(f));
    expect(saveStats(loadStats())).toBe(true);
    expect(failures).toEqual([]);
  });
});

describe('requestPersistentStorage', () => {
  it('asks once when not yet persisted', async () => {
    let asked = 0;
    const result = await requestPersistentStorage({
      storage: {
        persisted: async () => false,
        persist: async () => {
          asked += 1;
          return true;
        },
      },
    });
    expect(asked).toBe(1);
    expect(result).toBe(true);
  });

  it('does not ask again when already persisted', async () => {
    let asked = 0;
    await requestPersistentStorage({
      storage: { persisted: async () => true, persist: async () => (asked++, true) },
    });
    expect(asked).toBe(0);
  });

  it('is a no-op where the API is missing, and never throws', async () => {
    expect(await requestPersistentStorage(undefined)).toBeNull();
    expect(await requestPersistentStorage({})).toBeNull();
    expect(
      await requestPersistentStorage({
        storage: {
          persist: async () => {
            throw new Error('nope');
          },
        },
      }),
    ).toBeNull();
  });
});
