import { describe, it, expect, beforeEach, vi } from 'vitest';
import { quarantineRaw, quarantinedKeys } from './quarantine';
import {
  _setStorage,
  exportAll,
  importAll,
  loadStats,
  saveStats,
  quarantinedBackupLabels,
} from './persist';
import { _setStorage as _setProfilesStorage, loadProfiles } from './profiles';
import { loadProgress, noteStatsSaved } from '../habits/progressStore';
import { loadGuided, saveActive } from '../guided/store';
import { loadCustomLists, saveCustomLists } from '../drills/customLists';
import { loadFlashSr, saveFlashSr } from '../drills/gradeAnswer';
import { EMPTY_STATS } from './types';
import * as diagLog from '../diag/diagnosticLog';

/**
 * B5/B13: every store that holds history keeps bytes it cannot read (or a
 * version it does not know) before the next save overwrites them, in two
 * slots, logged -- and the backup carries them.
 */

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    clear: () => map.clear(),
  };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
  _setProfilesStorage(store);
  vi.stubGlobal('window', { localStorage: store });
  return () => {
    vi.unstubAllGlobals();
    _setStorage(null);
    _setProfilesStorage(null);
  };
});

describe('quarantineRaw (B13)', () => {
  it('keeps the first, then the newest different blob, and skips a repeat', () => {
    expect(quarantineRaw(store, 'k', 'bad-1', 'x')).toBe('kept');
    expect(quarantineRaw(store, 'k', 'bad-1', 'x')).toBe('duplicate');
    expect(quarantineRaw(store, 'k', 'bad-2', 'x')).toBe('kept-newest');
    expect(quarantineRaw(store, 'k', 'bad-3', 'x')).toBe('kept-newest');
    expect(quarantineRaw(store, 'k', 'bad-3', 'x')).toBe('duplicate');
    expect(store.getItem('k.corrupt')).toBe('bad-1');
    expect(store.getItem('k.corrupt.2')).toBe('bad-3');
    expect(quarantinedKeys(store, ['k', 'other'])).toEqual(['k']);
  });

  it('logs each quarantine, once per distinct blob', () => {
    const spy = vi.spyOn(diagLog, 'diag');
    quarantineRaw(store, 'logged.key', 'bad-a', 'unparseable');
    quarantineRaw(store, 'logged.key', 'bad-a', 'unparseable');
    const calls = spy.mock.calls.filter((c) => c[1] === 'storage-quarantined');
    expect(calls).toHaveLength(2); // 'kept', then 'duplicate' -- distinct outcomes, each once
    quarantineRaw(store, 'logged.key', 'bad-a', 'unparseable');
    expect(spy.mock.calls.filter((c) => c[1] === 'storage-quarantined')).toHaveLength(2);
    expect(calls[0]![2]).toMatchObject({ key: 'logged.key', bytes: 5, kept: 'kept' });
    spy.mockRestore();
  });

  it('a second stats failure months later is kept too, not overwritten', () => {
    store.setItem('bjtrainer.stats.v1', '{"version":1,"sessions":[trunc');
    loadStats();
    saveStats(structuredClone(EMPTY_STATS));
    store.setItem('bjtrainer.stats.v1', '{"version":2,"months":"of later history"}');
    loadStats();
    expect(store.getItem('bjtrainer.stats.v1.corrupt')).toBe('{"version":1,"sessions":[trunc');
    expect(store.getItem('bjtrainer.stats.v1.corrupt.2')).toBe('{"version":2,"months":"of later history"}');
    expect(quarantinedBackupLabels()).toEqual(['stats']);
  });
});

describe('each history store keeps what it cannot read (B5)', () => {
  it('progress: a newer-version record survives the next answer', () => {
    const newer = JSON.stringify({ version: 2, days: { '2026-10-01': { answers: 40, met: true } } });
    store.setItem('bjtrainer.progress.v1', newer);
    expect(loadProgress().days).toEqual({});
    noteStatsSaved(structuredClone(EMPTY_STATS), true);
    expect(store.getItem('bjtrainer.progress.v1')).not.toBe(newer);
    expect(store.getItem('bjtrainer.progress.v1.corrupt')).toBe(newer);
  });

  it('progress: unparseable bytes too', () => {
    store.setItem('bjtrainer.progress.v1', '{"version":1,"days":{');
    loadProgress();
    expect(store.getItem('bjtrainer.progress.v1.corrupt')).toBe('{"version":1,"days":{');
  });

  it('a readable version-1 record is not quarantined', () => {
    store.setItem('bjtrainer.progress.v1', JSON.stringify({ version: 1, days: {} }));
    loadProgress();
    expect(store.getItem('bjtrainer.progress.v1.corrupt')).toBeNull();
  });

  it('guided sessions', () => {
    store.setItem('bjtrainer.guided.v1', '{"version":7}');
    loadGuided();
    saveActive(null);
    expect(store.getItem('bjtrainer.guided.v1.corrupt')).toBe('{"version":7}');
  });

  it('custom lists', () => {
    store.setItem('bjtrainer.customLists.v1', 'garbage');
    expect(loadCustomLists().lists).toEqual([]);
    saveCustomLists({ version: 1, lists: [] } as unknown as Parameters<typeof saveCustomLists>[0]);
    expect(store.getItem('bjtrainer.customLists.v1.corrupt')).toBe('garbage');
  });

  it('a spaced-repetition deck', () => {
    store.setItem('bjtrainer.flashsr.v1', '{"c1":{"box":3');
    expect(loadFlashSr()).toEqual({});
    saveFlashSr({});
    expect(store.getItem('bjtrainer.flashsr.v1.corrupt')).toBe('{"c1":{"box":3');
  });

  it('profiles: unparseable bytes are kept before the default is written over them', () => {
    store.setItem('bjtrainer.profiles.v1', '[{"id":"mine","name":"2D S17"');
    expect(loadProfiles()).toHaveLength(1);
    expect(store.getItem('bjtrainer.profiles.v1.corrupt')).toBe('[{"id":"mine","name":"2D S17"');
  });

  it('the backup carries a quarantined store, and a restore brings it back', () => {
    store.setItem('bjtrainer.progress.v1', '{"version":9}');
    loadProgress();
    store.setItem('bjtrainer.stats.v1', 'x');
    loadStats();
    store.setItem('bjtrainer.stats.v1', 'y');
    loadStats();
    const blob = exportAll();
    const parsed = JSON.parse(blob) as Record<string, unknown>;
    expect(parsed['bjtrainer.progress.v1.corrupt']).toBe('{"version":9}');
    expect(parsed['bjtrainer.stats.v1.corrupt']).toBe('x');
    expect(parsed['bjtrainer.stats.v1.corrupt.2']).toBe('y');
    store.map.clear();
    expect(importAll(blob).ok).toBe(true);
    expect(store.getItem('bjtrainer.progress.v1.corrupt')).toBe('{"version":9}');
    expect(store.getItem('bjtrainer.stats.v1.corrupt.2')).toBe('y');
  });
});
