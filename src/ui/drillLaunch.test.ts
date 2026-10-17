import { describe, expect, it } from 'vitest';
import { launchSettings, setDrillLaunch, takeDrillLaunch } from './drillLaunch';
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
