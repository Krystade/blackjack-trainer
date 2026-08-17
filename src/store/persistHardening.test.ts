import { describe, it, expect, beforeEach } from 'vitest';
import { _setStorage, loadStats, exportAll, importAll, saveStats } from './persist';
import { EMPTY_STATS } from './types';

function memStore() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
});

describe('mergeStats — nested array hardening', () => {
  it('replaces a null history with an empty array instead of passing it through', () => {
    // A stored `{"history": null}` reached Stats.tsx's `.filter(...)`, which
    // threw during render. With no error boundary React unmounts the root, so
    // the app goes blank -- and the Reset Stats button lives on the very
    // screen that crashes, leaving no in-app way back.
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, countDrill: { history: null } }));
    expect(loadStats().countDrill.history).toEqual([]);
  });

  it('replaces a null category tally with the default', () => {
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, categories: { hard: null } }));
    expect(loadStats().categories.hard).toEqual({ right: 0, wrong: 0 });
  });

  it('replaces a non-array history of the wrong type', () => {
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, pairCancel: { history: 'nope' } }));
    expect(loadStats().pairCancel.history).toEqual([]);
  });

  it('keeps a valid history intact', () => {
    const entry = { date: '1', cards: 52, intervalMs: 800, correct: true };
    store.map.set('bjtrainer.stats.v1', JSON.stringify({ version: 1, countDrill: { history: [entry] } }));
    expect(loadStats().countDrill.history).toEqual([entry]);
  });
});

describe('saveStats — never throws on a full quota', () => {
  it('reports failure rather than throwing into the caller', () => {
    _setStorage({
      getItem: () => null,
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    });
    // The throw used to escape into endSession/persistGrade, skipping the
    // session report and the answer feedback that follow the save.
    expect(() => saveStats(structuredClone(EMPTY_STATS))).not.toThrow();
    expect(saveStats(structuredClone(EMPTY_STATS))).toBe(false);
  });
});

describe('exportAll — is actually a backup', () => {
  it('includes profiles and both spaced-repetition decks', () => {
    // Stats.tsx offers this as a download and warns only that import
    // "overwrites current stats and settings". Restoring onto a wiped browser
    // silently lost every profile and the entire SR schedule -- and elapsed-
    // time scheduling state cannot be reconstructed.
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
    store.map.set('bjtrainer.activeProfile.v1', 'p1');
    store.map.set('bjtrainer.flashsr.v1', JSON.stringify({ '16v10': { box: 3 } }));
    store.map.set('bjtrainer.quizsr.v1', JSON.stringify({ ins: { box: 1 } }));

    const blob = JSON.parse(exportAll());
    expect(blob.profiles).toBeTruthy();
    expect(blob.activeProfile).toBe('p1');
    expect(blob.flashSr).toEqual({ '16v10': { box: 3 } });
    expect(blob.quizSr).toEqual({ ins: { box: 1 } });
  });

  it('round-trips those keys back through importAll', () => {
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ id: 'p1', name: 'Vegas 6D' }]));
    store.map.set('bjtrainer.activeProfile.v1', 'p1');
    store.map.set('bjtrainer.flashsr.v1', JSON.stringify({ '16v10': { box: 3 } }));
    const blob = exportAll();

    const fresh = memStore();
    _setStorage(fresh);
    expect(importAll(blob).ok).toBe(true);
    expect(fresh.map.get('bjtrainer.profiles.v1')).toContain('Vegas 6D');
    expect(fresh.map.get('bjtrainer.activeProfile.v1')).toBe('p1');
    expect(fresh.map.get('bjtrainer.flashsr.v1')).toContain('16v10');
  });

  it('still imports an OLD export that has no profiles or SR keys', () => {
    // Backward compatibility: blobs exported before this change must not be
    // rejected, or users lose the backups they already took.
    const old = JSON.stringify({ settings: { version: 1 }, stats: { version: 1 } });
    expect(importAll(old).ok).toBe(true);
  });
});
