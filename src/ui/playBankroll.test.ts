import { describe, it, expect, beforeEach } from 'vitest';
import { _setStorage, loadProfiles, makeDefaultProfile, saveProfiles } from '../store/profiles';
import type { Profile } from '../store/types';
import { resumeBankroll, storeBankrollNow } from './playBankroll';

let map: Map<string, string>;

function profile(id: string, extra: Partial<Profile> = {}): Profile {
  return { ...makeDefaultProfile(), id, name: id, bankrollStart: 100, ...extra };
}

beforeEach(() => {
  map = new Map();
  _setStorage({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  });
});

describe('resumeBankroll (#42)', () => {
  it('starts from bankrollStart when nothing has been carried', () => {
    const p = profile('a');
    saveProfiles([p]);
    expect(resumeBankroll(p)).toBe(100);
  });

  it('resumes from the stored bankrollNow', () => {
    const p = profile('a');
    saveProfiles([{ ...p, bankrollNow: 137 }]);
    expect(resumeBankroll(p)).toBe(137);
  });

  it('trusts storage over a stale profile copy, both ways', () => {
    // The app's copy of the profile is not refreshed by the write (that would
    // remount the table), so the copy handed in can lag storage.
    const stale = profile('a', { bankrollNow: 90 });
    saveProfiles([{ ...stale, bankrollNow: 150 }]);
    expect(resumeBankroll(stale)).toBe(150);
    // ...including a reset that cleared it in storage.
    saveProfiles([profile('a')]);
    expect(resumeBankroll(stale)).toBe(100);
  });

  it('falls back to the copy it was given when the profile is not stored', () => {
    saveProfiles([profile('other')]);
    expect(resumeBankroll(profile('a', { bankrollNow: 42 }))).toBe(42);
    expect(resumeBankroll(profile('a'))).toBe(100);
  });

  it('a carried zero or negative bankroll is a real bankroll, not "unset"', () => {
    saveProfiles([profile('a', { bankrollNow: 0 })]);
    expect(resumeBankroll(profile('a'))).toBe(0);
    saveProfiles([profile('a', { bankrollNow: -12.5 })]);
    expect(resumeBankroll(profile('a'))).toBe(-12.5);
  });
});

describe('storeBankrollNow (#42)', () => {
  it('writes one profile and leaves every other field and profile alone', () => {
    saveProfiles([profile('a'), profile('b', { bankrollNow: 7 })]);
    const before = loadProfiles();
    storeBankrollNow('a', 120);
    const after = loadProfiles();
    expect(after[0]).toEqual({ ...before[0], bankrollNow: 120 });
    expect(after[1]).toEqual(before[1]);
  });

  it('clears the field with undefined (Reset bankroll), dropping the key', () => {
    saveProfiles([profile('a', { bankrollNow: 55 })]);
    storeBankrollNow('a', undefined);
    const stored = loadProfiles()[0]!;
    expect('bankrollNow' in stored).toBe(false);
    expect(resumeBankroll(stored)).toBe(100);
  });

  it('does not write at all when the value is unchanged', () => {
    saveProfiles([profile('a', { bankrollNow: 55 })]);
    let writes = 0;
    const inner = map;
    _setStorage({
      getItem: (k) => inner.get(k) ?? null,
      setItem: (k, v) => {
        writes += 1;
        inner.set(k, v);
      },
    });
    storeBankrollNow('a', 55);
    storeBankrollNow('missing', 10);
    expect(writes).toBe(0);
  });
});
