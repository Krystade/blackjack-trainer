import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _setStorage as setPersistStorage, loadSettings } from './persist';
import * as profilesMod from './profiles';
import { _setStorage as setProfilesStorage, loadProfiles, makeDefaultProfile } from './profiles';
import { applyBeginnerPlay, MIGRATIONS_KEY } from './beginnerPlay';
import { loadOnboarding } from './onboarding';
import type { Profile } from './types';

class MemStore {
  map = new Map<string, string>();
  writes: string[] = [];
  failOn: string | null = null;
  getItem = (k: string) => this.map.get(k) ?? null;
  setItem = (k: string, v: string) => {
    if (k === this.failOn) throw new Error('quota');
    this.writes.push(k);
    this.map.set(k, v);
  };
  removeItem = (k: string) => {
    this.map.delete(k);
  };
}

let store: MemStore;

function seed(profiles: Profile[], settings: Record<string, unknown>) {
  store.map.set('bjtrainer.profiles.v1', JSON.stringify(profiles));
  store.map.set('bjtrainer.activeProfile.v1', profiles[0]!.id);
  store.map.set('bjtrainer.settings.v1', JSON.stringify({ version: 1, ...settings }));
}

function jackLike(id: string): Profile {
  const { playChecks: _g, ...p } = makeDefaultProfile();
  return {
    ...p,
    id,
    name: `P ${id}`,
    countCheckEvery: 8,
    gradeDeviations: true,
    betSpreadOn: true,
    seats: { ...p.seats, bots: 3, playerPosition: 2 },
  };
}

beforeEach(() => {
  store = new MemStore();
  setPersistStorage(store);
  setProfilesStorage(store);
});

afterEach(() => {
  setPersistStorage(null);
  setProfilesStorage(null);
  vi.restoreAllMocks();
});

describe('applyBeginnerPlay', () => {
  it('closes every gate and sends the bots home, keeping every finer value', () => {
    const a = jackLike('a');
    const b = jackLike('b');
    seed([a, b], { dealerMistakesMode: 'training', losingShoe: true });
    expect(applyBeginnerPlay()).toBe(true);
    const after = loadProfiles();
    for (const [i, before] of [a, b].entries()) {
      const p = after[i]!;
      expect(p.playChecks).toEqual({ count: false, deviations: false, bets: false });
      expect(p.seats.bots).toBe(0);
      expect(p.seats.playerPosition).toBe(0);
      const { playChecks: _x, seats: s1, ...rest1 } = p;
      const { seats: s0, ...rest0 } = before;
      expect(rest1).toEqual(rest0);
      expect(s1.playerHands).toBe(s0.playerHands);
    }
    const s = loadSettings();
    expect(s.dealerMistakesMode).toBe('training');
    expect(s.tableChecks).toEqual({ dealerMistakes: false, distractions: false });
    expect(s.losingShoe).toBe(false);
  });

  it('records what it turned off for the "turn back on" card', () => {
    seed([jackLike('a')], { dealerMistakesMode: 'training' });
    applyBeginnerPlay();
    expect(loadOnboarding().migratedOff).toEqual(['count', 'deviations', 'bets', 'dealerMistakes']);
  });

  it('a first run (no profiles yet) records nothing to turn back on', () => {
    applyBeginnerPlay();
    expect(loadOnboarding().migratedOff).toBeUndefined();
    expect(loadProfiles()[0]!.playChecks).toEqual({ count: false, deviations: false, bets: false });
  });

  it('a cold install writes the marker and nothing else', () => {
    expect(applyBeginnerPlay()).toBe(true);
    expect(store.writes).toEqual([MIGRATIONS_KEY]);
    // And the defaults it relied on are the beginner table.
    expect(loadProfiles()[0]!.seats.bots).toBe(0);
    expect(loadSettings().losingShoe ?? false).toBe(false);
  });

  it('patches a partial stored settings blob in place, never filling in defaults', () => {
    store.map.set('bjtrainer.settings.v1', JSON.stringify({ version: 1, audio: { answerPauseMs: 0 }, dealerMistakesMode: 'occasional' }));
    expect(applyBeginnerPlay()).toBe(true);
    expect(JSON.parse(store.map.get('bjtrainer.settings.v1')!)).toEqual({
      version: 1,
      audio: { answerPauseMs: 0 },
      dealerMistakesMode: 'occasional',
      tableChecks: { dealerMistakes: false, distractions: false },
    });
  });

  it('leaves the distraction frequency and difficulty as stored (owner 2026-11-09)', () => {
    store.map.set(
      'bjtrainer.settings.v1',
      JSON.stringify({
        version: 1,
        playDistractionFreq: 'often',
        playDistractionDifficulty: 'hard',
        playDistractionType: 'table',
        drill: { distractionDifficulty: 'easy' },
      }),
    );
    expect(applyBeginnerPlay()).toBe(true);
    const s = JSON.parse(store.map.get('bjtrainer.settings.v1')!) as Record<string, unknown>;
    expect(s.playDistractionFreq).toBe('often');
    expect(s.playDistractionDifficulty).toBe('hard');
    expect(s.playDistractionType).toBe('table');
    expect(s.drill).toEqual({ distractionDifficulty: 'easy' });
    expect(loadSettings().playDistractionFreq).toBe('often');
  });

  it('a settings-only install (from before profiles) still has its profile migrated', () => {
    store.map.set('bjtrainer.settings.v1', JSON.stringify({ version: 1 }));
    expect(applyBeginnerPlay()).toBe(true);
    const stored = JSON.parse(store.map.get('bjtrainer.profiles.v1')!) as Profile[];
    expect(stored[0]!.playChecks).toEqual({ count: false, deviations: false, bets: false });
  });

  it('blobs that would not change are not written', () => {
    const p: Profile = { ...jackLike('a'), playChecks: { count: false, deviations: false, bets: false }, seats: { ...jackLike('a').seats, bots: 0, playerPosition: 0 } };
    seed([p], { tableChecks: { dealerMistakes: false, distractions: false } });
    store.writes = [];
    expect(applyBeginnerPlay()).toBe(true);
    expect(store.writes).toEqual([MIGRATIONS_KEY]);
  });

  it('writes the marker last', () => {
    seed([jackLike('a')], {});
    store.writes = [];
    applyBeginnerPlay();
    expect(store.writes.at(-1)).toBe(MIGRATIONS_KEY);
    expect(store.writes).toContain('bjtrainer.profiles.v1');
    expect(store.writes).toContain('bjtrainer.settings.v1');
  });

  it('a second run is a no-op', () => {
    seed([jackLike('a')], {});
    applyBeginnerPlay();
    const save = vi.spyOn(profilesMod, 'saveProfiles');
    // Jack turns count checks back on; a reload must not close it again.
    const p = loadProfiles();
    store.map.set('bjtrainer.profiles.v1', JSON.stringify([{ ...p[0]!, playChecks: { count: true } }]));
    expect(applyBeginnerPlay()).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(loadProfiles()[0]!.playChecks).toEqual({ count: true });
  });

  it('a failed profiles write leaves the marker unset', () => {
    seed([jackLike('a')], {});
    store.failOn = 'bjtrainer.profiles.v1';
    expect(applyBeginnerPlay()).toBe(false);
    expect(store.map.has(MIGRATIONS_KEY)).toBe(false);
    store.failOn = null;
    expect(applyBeginnerPlay()).toBe(true);
    expect(store.map.has(MIGRATIONS_KEY)).toBe(true);
  });
});
