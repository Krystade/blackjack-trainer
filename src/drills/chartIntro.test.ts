import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../store/types';
import {
  CHART_INTRO_KEY,
  chartIntroDue,
  hasHandHistory,
  introAllowed,
  loadChartIntroSeen,
  loadIntroSeen,
  saveChartIntroSeen,
  saveIntroSeen,
} from './chartIntro';

const base = { stats: EMPTY_STATS, seen: false, eyesFree: false, voiceOn: false, search: '', e2e: false };

describe('chartIntroDue', () => {
  it('shows once, to someone with no hands answered', () => {
    expect(chartIntroDue(base)).toBe(true);
    expect(chartIntroDue({ ...base, seen: true })).toBe(false);
  });
  it('not after any hand history', () => {
    const stats = { ...EMPTY_STATS, cellStats: { 'hard-16-v-10': { right: 1, wrong: 0, lastAt: '' } } };
    expect(hasHandHistory(stats)).toBe(true);
    expect(chartIntroDue({ ...base, stats })).toBe(false);
    expect(chartIntroDue({ ...base, stats: { ...EMPTY_STATS, handRecent: { soft: '1' } } })).toBe(false);
  });
  it('never in a car session', () => {
    expect(chartIntroDue({ ...base, eyesFree: true })).toBe(false);
    expect(chartIntroDue({ ...base, voiceOn: true })).toBe(false);
  });
  it('under the e2e harness only when the URL asks for it', () => {
    expect(chartIntroDue({ ...base, e2e: true, search: '?e2e=1' })).toBe(false);
    expect(chartIntroDue({ ...base, e2e: true, search: '?e2e=1&intro=1' })).toBe(true);
  });
});

describe('T2-2B: the shared intro pieces', () => {
  it('D6: no intro on an autoStart (guided or Drive)', () => {
    expect(chartIntroDue({ ...base, autoStart: true })).toBe(false);
    expect(chartIntroDue({ ...base, autoStart: false })).toBe(true);
  });

  it('introAllowed: each condition alone turns it off', () => {
    const ok = { eyesFree: false, voiceOn: false, autoStart: false, search: '', e2e: false };
    expect(introAllowed(ok)).toBe(true);
    expect(introAllowed({ ...ok, eyesFree: true })).toBe(false);
    expect(introAllowed({ ...ok, voiceOn: true })).toBe(false);
    expect(introAllowed({ ...ok, autoStart: true })).toBe(false);
    expect(introAllowed({ ...ok, e2e: true, search: '?e2e=1' })).toBe(false);
    expect(introAllowed({ ...ok, e2e: true, search: '?e2e=1&intro=1' })).toBe(true);
  });

  it('seen flags are per key, and blocked storage reads as seen', () => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = { localStorage: ls };
    try {
      expect(loadIntroSeen('a')).toBe(false);
      saveIntroSeen('a');
      expect(loadIntroSeen('a')).toBe(true);
      expect(loadIntroSeen('b')).toBe(false);
      expect(store.get(CHART_INTRO_KEY)).toBeUndefined();
      saveChartIntroSeen();
      expect(store.get(CHART_INTRO_KEY)).toBe('1');
      expect(loadChartIntroSeen()).toBe(true);
      g.window = {
        get localStorage(): never {
          throw new Error('blocked');
        },
      };
      expect(loadIntroSeen('a')).toBe(true);
      expect(() => saveIntroSeen('a')).not.toThrow();
    } finally {
      g.window = prev;
    }
  });
});
