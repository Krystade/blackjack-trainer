import { describe, it, expect, beforeEach } from 'vitest';
import {
  _setStorage,
  loadProfiles,
  makeDefaultProfile,
  saveProfiles,
  setActiveProfile,
} from '../store/profiles';
import type { Profile } from '../store/types';
import {
  COUNT_CHECK_ASK_OPTIONS,
  countCheckAskOf,
  cutBounds,
  cutDecksOf,
  gradesDeviations,
  patchActiveProfile,
  penetrationForCut,
  playOptionsDiffer,
  syncPenetration,
} from './profileOptions';

let map: Map<string, string>;

function profile(id: string, extra: Partial<Profile> = {}): Profile {
  return { ...makeDefaultProfile(), id, name: id, ...extra };
}

function withDecks(p: Profile, decks: 1 | 2 | 6 | 8): Profile {
  return { ...p, rules: { ...p.rules, decks } };
}

beforeEach(() => {
  map = new Map();
  _setStorage({
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  });
});

describe('defaults for profiles saved before the options existed', () => {
  it('count checks alternate, as they did before #3', () => {
    expect(countCheckAskOf({})).toBe('alternate');
    expect(countCheckAskOf({ countCheckAsk: 'true' })).toBe('true');
  });

  it('grading uses deviations unless switched off (#34)', () => {
    expect(gradesDeviations({})).toBe(true);
    expect(gradesDeviations({ gradeDeviations: true })).toBe(true);
    expect(gradesDeviations({ gradeDeviations: false })).toBe(false);
  });

  it('offers the four count-check choices, alternate meaning today', () => {
    expect(COUNT_CHECK_ASK_OPTIONS.map((o) => o.value)).toEqual(['running', 'true', 'alternate', 'both']);
  });
});

describe('cut card in decks (#39)', () => {
  it('derives the cut from penetration when none is stored', () => {
    // 6 decks at 75% leaves 1.5 decks behind the cut.
    expect(cutDecksOf(withDecks(profile('a', { penetration: 0.75 }), 6))).toBe(1.5);
    // 8 decks at 80%: 1.6, to the nearest quarter deck.
    expect(cutDecksOf(withDecks(profile('a', { penetration: 0.8 }), 8))).toBe(1.5);
  });

  it('prefers a stored cut over penetration', () => {
    expect(cutDecksOf(withDecks(profile('a', { penetration: 0.75, cutDecks: 2.25 }), 6))).toBe(2.25);
  });

  it('keeps the cut within 0.5 decks and half the shoe, capped at 3', () => {
    expect(cutBounds(8)).toEqual({ min: 0.5, max: 3 });
    expect(cutBounds(6)).toEqual({ min: 0.5, max: 3 });
    expect(cutBounds(2)).toEqual({ min: 0.5, max: 1 });
    expect(cutBounds(1)).toEqual({ min: 0.5, max: 0.5 });
    expect(cutDecksOf(withDecks(profile('a', { cutDecks: 9 }), 8))).toBe(3);
    expect(cutDecksOf(withDecks(profile('a', { cutDecks: 0.1 }), 8))).toBe(0.5);
    // 6 decks at 90% derives 0.6 -> 0.5.
    expect(cutDecksOf(withDecks(profile('a', { penetration: 0.9 }), 6))).toBe(0.5);
  });

  it('converts a cut back to the penetration the shoe reads', () => {
    expect(penetrationForCut(6, 1.5)).toBeCloseTo(0.75);
    expect(penetrationForCut(8, 2)).toBeCloseTo(0.75);
  });

  it('syncs penetration to the cut, and leaves a cut-less profile alone', () => {
    const plain = withDecks(profile('a', { penetration: 0.7 }), 6);
    expect(syncPenetration(plain)).toBe(plain);
    const cut = syncPenetration(withDecks(profile('a', { penetration: 0.7, cutDecks: 1 }), 8));
    expect(cut.penetration).toBeCloseTo(0.875);
    expect(cut.cutDecks).toBe(1);
  });
});

describe('patchActiveProfile', () => {
  it('writes the patch to the active profile only, through saveProfiles', () => {
    saveProfiles([profile('a'), profile('b')]);
    setActiveProfile('b');
    patchActiveProfile({ countCheckAsk: 'both', gradeDeviations: false });
    const [a, b] = loadProfiles();
    expect(a!.countCheckAsk).toBeUndefined();
    expect(b!.countCheckAsk).toBe('both');
    expect(b!.gradeDeviations).toBe(false);
  });

  it('keeps the bankroll the table carried in storage', () => {
    saveProfiles([profile('a', { bankrollNow: 140 })]);
    setActiveProfile('a');
    patchActiveProfile({ cutVary: true });
    expect(loadProfiles()[0]!.bankrollNow).toBe(140);
  });

  it('a cut written with a deck change keeps penetration in step', () => {
    saveProfiles([withDecks(profile('a', { penetration: 0.75 }), 6)]);
    setActiveProfile('a');
    const stored = patchActiveProfile({ cutDecks: 2 });
    expect(stored.penetration).toBeCloseTo(1 - 2 / 6);
    patchActiveProfile({ rules: { ...stored.rules, decks: 8 } });
    const after = loadProfiles()[0]!;
    expect(after.cutDecks).toBe(2);
    expect(after.penetration).toBeCloseTo(0.75);
  });
});

describe('playOptionsDiffer: what the Play sheet counts as a change', () => {
  const base = withDecks(profile('a', { penetration: 0.75 }), 6);

  it('a change made and undone is no change', () => {
    // Vary on then off leaves `false` where nothing was stored.
    expect(playOptionsDiffer({ ...base, cutVary: false }, base)).toBe(false);
    // The cut stepped up and back down stores the cut that was only derived.
    expect(playOptionsDiffer({ ...base, cutDecks: 1.5 }, base)).toBe(false);
    expect(playOptionsDiffer({ ...base, countCheckAsk: 'alternate', gradeDeviations: true }, base)).toBe(false);
    expect(playOptionsDiffer({ ...base, wongExitTc: -2 }, base)).toBe(false);
  });

  it('every real change is one', () => {
    expect(playOptionsDiffer({ ...base, cutVary: true }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, cutDecks: 1.75 }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, countCheckAsk: 'true' }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, gradeDeviations: false }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, countCheckEvery: base.countCheckEvery + 1 }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, betSpreadOn: !base.betSpreadOn }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, wongExitTc: -3 }, base)).toBe(true);
  });

  it('Wave J: back-counting and its entry point are changes; their defaults are not', () => {
    expect(playOptionsDiffer({ ...base, backCount: true }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, wongInTc: 3 }, base)).toBe(true);
    expect(playOptionsDiffer({ ...base, backCount: false, wongInTc: 1 }, base)).toBe(false);
  });
});
