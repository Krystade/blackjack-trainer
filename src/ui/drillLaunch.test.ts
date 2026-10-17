import { describe, expect, it } from 'vitest';
import { launchSettings, weakCellsLaunch, reviewIndexesLaunch, reviewLaunch, setDrillLaunch, setReviewDeck, takeDrillLaunch, takeFlashHandOver, takeReviewDeck, takeReviewIndexes } from './drillLaunch';
import { DEFAULT_SETTINGS } from '../store/types';
import type { Settings } from '../store/types';

describe('drillLaunch (#28)', () => {
  it('hands one launch across, once', () => {
    expect(takeDrillLaunch()).toBeNull();
    setDrillLaunch('count');
    expect(takeDrillLaunch()).toBe('count');
    expect(takeDrillLaunch()).toBeNull();
  });
});

describe('launchSettings (F21, s07)', () => {
  const base = (): Settings => ({
    ...structuredClone(DEFAULT_SETTINGS),
    drill: { ...structuredClone(DEFAULT_SETTINGS.drill), deck: 'custom', scopes: ['hard'], flashCategory: 'hard' },
  });
  it('Flashcards opens on the named hand type, on the chart deck', () => {
    const d = launchSettings('flash', 'pairs', base()).drill;
    expect(d).toMatchObject({ deck: 'chart', scopes: ['pairs'], flashCategory: 'pairs' });
  });
  it('no named hand type means the whole chart', () => {
    expect(launchSettings('flash', undefined, base()).drill).toMatchObject({ deck: 'chart', scopes: ['hard', 'soft', 'pairs'] });
  });
  it('Mastery always sweeps the whole chart', () => {
    expect(launchSettings('mastery', 'soft', base()).drill).toMatchObject({ deck: 'chart', scopes: ['hard', 'soft', 'pairs'] });
  });
  it('other drills leave the settings alone', () => {
    const s = base();
    expect(launchSettings('custom', undefined, s)).toBe(s);
    expect(launchSettings('quiz', undefined, s)).toBe(s);
  });
});

describe('weakCellsLaunch (Wave B2 #43)', () => {
  const weak = { 'soft-17-v-3': { right: 0, wrong: 4, lastAt: '' }, 'soft-18-v-9': { right: 30, wrong: 0, lastAt: '' } };
  it('runs Flashcards on the Custom deck, every hand type, with Auto tiers', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.drill = { ...s.drill, deck: 'chart', scopes: ['pairs'], flashCategory: 'pairs' };
    const d = weakCellsLaunch(s, weak).drill;
    expect(d).toMatchObject({ deck: 'custom', scopes: ['hard', 'soft', 'pairs'], flashCategory: 'all' });
    expect(d.custom!.tiers['soft-17-v-3']).toBe('focus');
    expect(d.custom!.tiers['soft-18-v-9']).toBe('rare');
  });
  it('keeps hand-painted cells, the mix and favour-missed, as the editor Auto does', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.drill.custom = { tiers: { 'soft-17-v-3': 'rare' }, painted: { 'soft-17-v-3': true, 'hard-9-v-3': true }, mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true };
    const c = weakCellsLaunch(s, weak).drill.custom!;
    expect(c.tiers['soft-17-v-3']).toBe('rare');
    expect(c.tiers['hard-9-v-3']).toBeUndefined();
    expect(c).toMatchObject({ mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true, painted: s.drill.custom.painted });
  });
});

describe('B2 review hand-over (controller ruling)', () => {
  it('hands the due cells across once, in memory', () => {
    expect(takeReviewDeck()).toBeNull();
    const ids = ['hard-16-v-10', 'pair-8-v-A'];
    setReviewDeck(ids);
    ids.push('soft-18-v-9'); // a copy is handed over, not the caller's array
    expect(takeReviewDeck()).toEqual(['hard-16-v-10', 'pair-8-v-A']);
    expect(takeReviewDeck()).toBeNull();
  });

  it('R5 (#46): a session deck says it is one', () => {
    setReviewDeck(['pair-8-v-4'], 'session');
    expect(takeFlashHandOver()).toEqual({ ids: ['pair-8-v-4'], source: 'session' });
    expect(takeFlashHandOver()).toBeNull();
    setReviewDeck(['pair-8-v-4']);
    expect(takeFlashHandOver()?.source).toBe('review');
  });

  it('reviewLaunch leaves the Custom deck and the saved settings byte-identical', () => {
    const saved: Settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      drill: {
        ...structuredClone(DEFAULT_SETTINGS.drill),
        deck: 'custom',
        scopes: ['hard'],
        custom: { tiers: { 'soft-18-v-9': 'focus' }, painted: { 'soft-18-v-9': true }, mix: { focus: 60, regular: 30, rare: 10 }, favourMissed: true },
      },
    } as Settings;
    const before = JSON.stringify(saved);
    const out = reviewLaunch(saved, ['hard-16-v-10', 'pair-8-v-A']);
    expect(JSON.stringify(out)).toBe(before);
    expect(JSON.stringify(saved)).toBe(before);
    expect(takeReviewDeck()).toEqual(['hard-16-v-10', 'pair-8-v-A']);
  });
});

describe('Wave B2 #38: index review hand-over', () => {
  it('hands the due indexes across once, in memory, and leaves the settings alone', () => {
    expect(takeReviewIndexes()).toBeNull();
    const saved = structuredClone(DEFAULT_SETTINGS);
    const before = JSON.stringify(saved);
    const ids = ['16v10', '12v3'];
    expect(reviewIndexesLaunch(saved, ids)).toBe(saved);
    ids.push('ins');
    expect(takeReviewIndexes()).toEqual(['16v10', '12v3']);
    expect(takeReviewIndexes()).toBeNull();
    expect(JSON.stringify(saved)).toBe(before);
  });
  it('a cell review is marked as a review', () => {
    reviewLaunch(structuredClone(DEFAULT_SETTINGS), ['hard-16-v-10']);
    expect(takeFlashHandOver()).toEqual({ ids: ['hard-16-v-10'], source: 'review' });
    expect(takeFlashHandOver()).toBeNull();
  });
});
