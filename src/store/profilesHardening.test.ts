import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _setStorage, loadProfiles, getActiveProfile, saveProfiles } from './profiles';
import type { Profile } from './types';

/**
 * The profile store is the one place a read WRITES.
 *
 * `loadProfiles` persists a first-run migration and persists a reset, and
 * `getActiveProfile` heals a dangling pointer -- and `App.tsx` calls
 * `getActiveProfile()` from the root component's `useState` initialiser. The
 * ErrorBoundary is mounted inside App's own JSX, so it cannot catch a throw
 * from App's own initialiser: a refused write there renders nothing at all,
 * with no "Download backup" button and no way back.
 */

const VALID = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
  penetration: 0.75,
  spread: [{ minTc: -99, units: 1 }],
  bankrollStart: 100,
  countCheckEvery: 0,
  betSpreadOn: false,
});

function memStore(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

afterEach(() => _setStorage(null));

describe('one unreadable profile', () => {
  beforeEach(() => {
    const good = ['Vegas 6D', 'AC 8D', 'Reno', 'Single'].map((n, i) => VALID(`p${i}`, n));
    const bad = { ...VALID('p4', 'Broken'), bankrollStart: undefined };
    _setStorage(memStore({ 'bjtrainer.profiles.v1': JSON.stringify([...good, bad]) }));
  });

  it('does not take the other four with it', () => {
    // `.every(isValidProfile)` discarded the whole array, and the reset was
    // written to disk before the operator was told anything.
    expect(loadProfiles().map((p: Profile) => p.name)).toEqual([
      'Vegas 6D',
      'AC 8D',
      'Reno',
      'Single',
    ]);
  });

  it('still falls back to a default when nothing is readable', () => {
    _setStorage(memStore({ 'bjtrainer.profiles.v1': JSON.stringify([{ nope: true }]) }));
    const profiles = loadProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.rules.decks).toBe(6);
  });
});

describe('a storage that refuses to be written', () => {
  const refusing = () => {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
    };
  };

  it('does not take the app down on a read', () => {
    _setStorage(refusing());
    expect(() => loadProfiles(), 'a read that writes threw out of App\u2019s useState').not.toThrow();
    expect(() => getActiveProfile()).not.toThrow();
    expect(getActiveProfile().name).toBeTruthy();
  });

  it('does not take the app down on a write either', () => {
    _setStorage(refusing());
    const profile = loadProfiles()[0]!;
    expect(() => saveProfiles([profile])).not.toThrow();
  });
});
