import { describe, it, expect, beforeEach } from 'vitest';
import { _setStorage, importAll } from './persist';

/**
 * R6: an import never overwrites the bytes this phone set aside. They may be
 * the only copy of months of history; the file's copies fill only slots the
 * phone has free.
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
  };
}

let store: ReturnType<typeof memStore>;
beforeEach(() => {
  store = memStore();
  _setStorage(store);
});

const file = (graves: Record<string, string>) => JSON.stringify({ settings: { version: 1 }, stats: { version: 1 }, ...graves });

describe('import and the set-aside copies (R6)', () => {
  it("keeps the phone's newest set-aside copy when the file carries a different one", () => {
    store.setItem('bjtrainer.stats.v1.corrupt', 'X');
    store.setItem('bjtrainer.stats.v1.corrupt.2', 'Y months');
    expect(importAll(file({ 'bjtrainer.stats.v1.corrupt': 'X', 'bjtrainer.stats.v1.corrupt.2': 'Z' })).ok).toBe(true);
    expect(store.getItem('bjtrainer.stats.v1.corrupt')).toBe('X');
    expect(store.getItem('bjtrainer.stats.v1.corrupt.2')).toBe('Y months');
  });

  it("puts the file's copy in a free slot beside the phone's own", () => {
    store.setItem('bjtrainer.progress.v1.corrupt', 'mine');
    expect(importAll(file({ 'bjtrainer.progress.v1.corrupt': 'theirs' })).ok).toBe(true);
    expect(store.getItem('bjtrainer.progress.v1.corrupt')).toBe('mine');
    expect(store.getItem('bjtrainer.progress.v1.corrupt.2')).toBe('theirs');
  });

  it('restores the file copies onto a phone that has none (the wipe-and-restore round trip)', () => {
    expect(importAll(file({ 'bjtrainer.stats.v1.corrupt': 'A', 'bjtrainer.stats.v1.corrupt.2': 'B' })).ok).toBe(true);
    expect(store.getItem('bjtrainer.stats.v1.corrupt')).toBe('A');
    expect(store.getItem('bjtrainer.stats.v1.corrupt.2')).toBe('B');
  });

  it('a copy the phone already holds is not written twice', () => {
    store.setItem('bjtrainer.stats.v1.corrupt', 'A');
    expect(importAll(file({ 'bjtrainer.stats.v1.corrupt.2': 'A' })).ok).toBe(true);
    expect(store.getItem('bjtrainer.stats.v1.corrupt.2')).toBeNull();
  });
});
