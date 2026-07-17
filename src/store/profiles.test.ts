import { expect, test, describe, beforeEach } from 'vitest';
import {
  _setStorage,
  loadProfiles,
  saveProfiles,
  getActiveProfile,
  setActiveProfile,
  makeDefaultProfile,
} from './profiles';
import { DEFAULT_RULES } from '../engine/ruleset';
import { DEFAULT_SPREAD } from '../engine/game';
import type { Profile } from './types';

describe('store/profiles', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    storage = {};
    _setStorage({
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => {
        storage[key] = value;
      },
    });
  });

  describe('makeDefaultProfile', () => {
    test('builds v1-parity default profile', () => {
      const p = makeDefaultProfile();
      expect(p.name).toBe('Default (6D H17)');
      expect(p.rules).toEqual(DEFAULT_RULES);
      expect(p.penetration).toBe(0.75);
      expect(p.spread).toEqual(DEFAULT_SPREAD);
      expect(p.bankrollStart).toBe(100);
      expect(p.countCheckEvery).toBe(5);
      expect(p.betSpreadOn).toBe(false);
      expect(typeof p.id).toBe('string');
      expect(p.id.length).toBeGreaterThan(0);
    });

    test('two calls produce distinct ids and independent spread arrays', () => {
      const a = makeDefaultProfile();
      const b = makeDefaultProfile();
      expect(a.id).not.toBe(b.id);
      expect(a.spread).not.toBe(b.spread);
      expect(a.spread).not.toBe(DEFAULT_SPREAD);
    });
  });

  describe('loadProfiles: no-settings default', () => {
    test('no profiles key and no settings key -> single plain default profile', () => {
      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.name).toBe('Default (6D H17)');
      expect(profiles[0]!.rules).toEqual(DEFAULT_RULES);
      expect(profiles[0]!.spread).toEqual(DEFAULT_SPREAD);
      expect(profiles[0]!.bankrollStart).toBe(100);
      expect(profiles[0]!.penetration).toBe(0.75);
      expect(profiles[0]!.countCheckEvery).toBe(5);
      expect(profiles[0]!.betSpreadOn).toBe(false);
    });

    test('persists the default and sets it active', () => {
      const [profile] = loadProfiles();
      expect(storage['bjtrainer.profiles.v1']).toBeDefined();
      expect(storage['bjtrainer.activeProfile.v1']).toBe(profile!.id);
    });
  });

  describe('loadProfiles: migration from v1 settings blob', () => {
    test('captured realistic v1 settings blob -> exact expected profile', () => {
      const v1Settings = {
        version: 1,
        feedbackMode: 'test',
        betSpreadOn: true,
        spread: [
          { minTc: -99, units: 1 },
          { minTc: 1, units: 3 },
          { minTc: 3, units: 6 },
          { minTc: 5, units: 12 },
        ],
        bankrollStart: 400,
        countCheckEvery: 8,
        penetration: 0.65,
        countPeek: false,
        dealSpeedMs: 500,
        drill: {
          flashCategory: 'hard',
          countGroup: 2,
          countIntervalMs: 900,
          countLengthCards: 104,
          countManual: true,
          quizIndex: '16v10',
        },
      };
      storage['bjtrainer.settings.v1'] = JSON.stringify(v1Settings);

      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      const p = profiles[0]!;

      expect(p.name).toBe('Default (6D H17)');
      expect(p.rules).toEqual(DEFAULT_RULES);
      expect(p.betSpreadOn).toBe(true);
      expect(p.spread).toEqual(v1Settings.spread);
      expect(p.bankrollStart).toBe(400);
      expect(p.countCheckEvery).toBe(8);
      expect(p.penetration).toBe(0.65);
      expect(typeof p.id).toBe('string');
      // Non-game settings fields (feedbackMode, countPeek, dealSpeedMs, drill.*)
      // are not part of Profile and must not leak in.
      expect((p as unknown as Record<string, unknown>).feedbackMode).toBeUndefined();
      expect((p as unknown as Record<string, unknown>).drill).toBeUndefined();
    });

    test('idempotent: second load does not duplicate or change the profile', () => {
      storage['bjtrainer.settings.v1'] = JSON.stringify({
        version: 1,
        betSpreadOn: true,
        spread: [{ minTc: -99, units: 1 }],
        bankrollStart: 250,
        countCheckEvery: 3,
        penetration: 0.6,
      });

      const first = loadProfiles();
      expect(first).toHaveLength(1);
      const firstId = first[0]!.id;

      const second = loadProfiles();
      expect(second).toHaveLength(1);
      expect(second[0]!.id).toBe(firstId);
      expect(second[0]!).toEqual(first[0]!);
    });

    test('missing version field falls back to plain default (not migrated)', () => {
      storage['bjtrainer.settings.v1'] = JSON.stringify({
        betSpreadOn: true,
        bankrollStart: 999,
      });
      const [p] = loadProfiles();
      expect(p!.bankrollStart).toBe(100);
      expect(p!.betSpreadOn).toBe(false);
    });

    test('corrupt settings JSON does not throw and falls back to plain default', () => {
      storage['bjtrainer.settings.v1'] = '{not valid json';
      expect(() => loadProfiles()).not.toThrow();
      const [p] = loadProfiles();
      expect(p!.bankrollStart).toBe(100);
    });
  });

  describe('loadProfiles: corrupt/wrong-shape profiles blob', () => {
    test('corrupt profiles JSON -> default profile, settings left untouched', () => {
      storage['bjtrainer.profiles.v1'] = '{oops not json';
      const settingsBefore = JSON.stringify({ version: 1, bankrollStart: 777 });
      storage['bjtrainer.settings.v1'] = settingsBefore;

      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.name).toBe('Default (6D H17)');

      // Settings blob must be untouched (never written to by profiles.ts).
      expect(storage['bjtrainer.settings.v1']).toBe(settingsBefore);
    });

    test('wrong-shape (empty array) profiles blob -> default profile', () => {
      storage['bjtrainer.profiles.v1'] = JSON.stringify([]);
      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.name).toBe('Default (6D H17)');
    });

    test('wrong-shape (object with missing fields) profiles blob -> default profile', () => {
      storage['bjtrainer.profiles.v1'] = JSON.stringify([{ id: 'x', name: 'broken' }]);
      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      expect(profiles[0]!.name).toBe('Default (6D H17)');
    });
  });

  describe('saveProfiles / loadProfiles round-trip', () => {
    test('round-trips a custom profile list', () => {
      const custom: Profile[] = [
        { ...makeDefaultProfile(), id: 'a', name: 'Alpha' },
        { ...makeDefaultProfile(), id: 'b', name: 'Bravo', bankrollStart: 200 },
      ];
      saveProfiles(custom);
      const loaded = loadProfiles();
      expect(loaded).toEqual(custom);
    });

    test('deep-clone: mutating a loaded profile does not pollute storage or later loads', () => {
      const custom: Profile[] = [{ ...makeDefaultProfile(), id: 'a', name: 'Alpha' }];
      saveProfiles(custom);

      const first = loadProfiles();
      first[0]!.name = 'Mutated';
      first[0]!.spread.push({ minTc: 99, units: 99 });

      const second = loadProfiles();
      expect(second[0]!.name).toBe('Alpha');
      expect(second[0]!.spread).toEqual(custom[0]!.spread);
    });
  });

  describe('getActiveProfile / setActiveProfile', () => {
    test('falls back to the first profile when no active id is stored yet', () => {
      const custom: Profile[] = [
        { ...makeDefaultProfile(), id: 'a', name: 'Alpha' },
        { ...makeDefaultProfile(), id: 'b', name: 'Bravo' },
      ];
      saveProfiles(custom);
      // No active key set.
      const active = getActiveProfile();
      expect(active.id).toBe('a');
      expect(storage['bjtrainer.activeProfile.v1']).toBe('a');
    });

    test('falls back to the first profile and heals a dangling active id', () => {
      const custom: Profile[] = [
        { ...makeDefaultProfile(), id: 'a', name: 'Alpha' },
        { ...makeDefaultProfile(), id: 'b', name: 'Bravo' },
      ];
      saveProfiles(custom);
      setActiveProfile('deleted-id-does-not-exist');

      const active = getActiveProfile();
      expect(active.id).toBe('a');
      expect(storage['bjtrainer.activeProfile.v1']).toBe('a');
    });

    test('setActiveProfile round-trip: getActiveProfile returns the selected profile', () => {
      const custom: Profile[] = [
        { ...makeDefaultProfile(), id: 'a', name: 'Alpha' },
        { ...makeDefaultProfile(), id: 'b', name: 'Bravo' },
      ];
      saveProfiles(custom);
      setActiveProfile('b');

      const active = getActiveProfile();
      expect(active.id).toBe('b');
      expect(active.name).toBe('Bravo');
    });
  });

  describe('missing-localStorage fallback', () => {
    test('save->load round-trips through the persistent in-memory fallback', () => {
      _setStorage(null);

      const custom: Profile[] = [{ ...makeDefaultProfile(), id: 'fallback-1', name: 'Fallback' }];
      saveProfiles(custom);
      expect(loadProfiles()).toEqual(custom);

      _setStorage({
        getItem: (key) => storage[key] ?? null,
        setItem: (key, value) => {
          storage[key] = value;
        },
      });
    });
  });

  describe('seats: config and backfill migration', () => {
    test('makeDefaultProfile includes DEFAULT_SEATS', () => {
      const p = makeDefaultProfile();
      expect(p.seats).toBeDefined();
      expect(p.seats.playerHands).toBe(1);
      expect(p.seats.bots).toBe(0);
      expect(p.seats.botMistakePct).toBe(0);
      expect(p.seats.playerPosition).toBe(0);
    });

    test('two makeDefaultProfile calls produce independent seats objects', () => {
      const a = makeDefaultProfile();
      const b = makeDefaultProfile();
      expect(a.seats).not.toBe(b.seats);
      expect(a.seats).toEqual(b.seats);
    });

    test('loadProfiles: stored profile WITHOUT seats -> loads with DEFAULT_SEATS (deep-equal, not reference-equal)', () => {
      const oldProfile = {
        id: 'old-1',
        name: 'Old Profile',
        rules: DEFAULT_RULES,
        penetration: 0.75,
        spread: DEFAULT_SPREAD,
        bankrollStart: 100,
        countCheckEvery: 5,
        betSpreadOn: false,
        // Omit seats to simulate legacy profile
      } as any;

      storage['bjtrainer.profiles.v1'] = JSON.stringify([oldProfile]);

      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      const loaded = profiles[0]!;

      // Must have seats filled in
      expect(loaded.seats).toBeDefined();
      expect(loaded.seats.playerHands).toBe(1);
      expect(loaded.seats.bots).toBe(0);
      expect(loaded.seats.botMistakePct).toBe(0);
      expect(loaded.seats.playerPosition).toBe(0);

      // Must not be reference-equal to the default
      const defaultSeats = makeDefaultProfile().seats;
      expect(loaded.seats).not.toBe(defaultSeats);
    });

    test('loadProfiles: stored profile with PARTIAL seats -> merged with DEFAULT_SEATS', () => {
      const partialProfile = {
        id: 'partial-1',
        name: 'Partial Profile',
        rules: DEFAULT_RULES,
        penetration: 0.75,
        spread: DEFAULT_SPREAD,
        bankrollStart: 100,
        countCheckEvery: 5,
        betSpreadOn: false,
        seats: {
          playerHands: 1,
          bots: 3,
          // Missing botMistakePct and playerPosition
        },
      } as any;

      storage['bjtrainer.profiles.v1'] = JSON.stringify([partialProfile]);

      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      const loaded = profiles[0]!;

      // Partial seats should be merged with defaults
      expect(loaded.seats.playerHands).toBe(1); // provided
      expect(loaded.seats.bots).toBe(3); // provided
      expect(loaded.seats.botMistakePct).toBe(0); // filled from default
      expect(loaded.seats.playerPosition).toBe(0); // filled from default
    });

    test('loadProfiles: migration from v1 settings WITHOUT seats -> adds DEFAULT_SEATS', () => {
      const v1Settings = {
        version: 1,
        feedbackMode: 'test',
        betSpreadOn: true,
        spread: [{ minTc: -99, units: 1 }],
        bankrollStart: 250,
        countCheckEvery: 3,
        penetration: 0.6,
        countPeek: false,
        dealSpeedMs: 500,
        drill: { flashCategory: 'all', countGroup: 1 },
      };
      storage['bjtrainer.settings.v1'] = JSON.stringify(v1Settings);

      const profiles = loadProfiles();
      expect(profiles).toHaveLength(1);
      const p = profiles[0]!;

      expect(p.seats).toBeDefined();
      expect(p.seats.playerHands).toBe(1);
      expect(p.seats.bots).toBe(0);
      expect(p.seats.botMistakePct).toBe(0);
      expect(p.seats.playerPosition).toBe(0);
    });

    test('new profiles (no legacy data) carry seats in round-trip', () => {
      const fresh = makeDefaultProfile();
      saveProfiles([fresh]);

      const loaded = loadProfiles();
      expect(loaded[0]!.seats).toBeDefined();
      expect(loaded[0]!.seats).toEqual(fresh.seats);
    });
  });
});
