import { describe, expect, it } from 'vitest';
import { launchSettings, setDrillLaunch, takeDrillLaunch } from './drillLaunch';
import { DEFAULT_SETTINGS } from '../store/types';
import type { Settings } from '../store/types';
import { ALL_PAINT_CELL_IDS, autoTiers } from '../drills/cellSelection';
import { customCellsSettings, launchCustomCells } from './drillLaunch';
import { loadSettings } from '../store/persist';

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

describe('customCellsSettings (B6: Drill these hands)', () => {
  const ids = ['pair-8-v-4', 'hard-16-v-10'];
  it('paints exactly those cells Focus and every other cell Off', () => {
    const sel = customCellsSettings(ids, structuredClone(DEFAULT_SETTINGS)).drill.custom!;
    expect(Object.keys(sel.tiers).sort()).toEqual([...ids].sort());
    expect(Object.values(sel.tiers).every((t) => t === 'focus')).toBe(true);
  });
  it('survives the Auto that a Custom launch applies', () => {
    const sel = customCellsSettings(ids, structuredClone(DEFAULT_SETTINGS)).drill.custom!;
    const weak = Object.fromEntries(ALL_PAINT_CELL_IDS.map((id) => [id, { right: 0, wrong: 9, lastAt: '' }]));
    expect(autoTiers(ALL_PAINT_CELL_IDS, weak, sel.painted, sel.tiers)).toEqual(sel.tiers);
  });
  it('keeps the mix and the favour-missed toggle', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.drill.custom = { tiers: {}, painted: {}, mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true };
    expect(customCellsSettings(ids, s).drill.custom).toMatchObject({ mix: { focus: 80, regular: 15, rare: 5 }, favourMissed: true });
  });
  it('launch saves it and hands Custom across once', () => {
    const next = launchCustomCells(ids, structuredClone(DEFAULT_SETTINGS));
    expect(loadSettings().drill.custom).toEqual(next.drill.custom);
    expect(takeDrillLaunch()).toBe('custom');
    expect(takeDrillLaunch()).toBeNull();
  });
});
