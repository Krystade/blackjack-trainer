import { describe, it, expect } from 'vitest';
import { EMPTY_STATS } from '../store/types';
import { chartIntroDue, hasHandHistory } from './chartIntro';

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
