import { describe, expect, it } from 'vitest';
import { homeLayout } from './homeLayout';
import type { RungResult } from './nextStep';

const basic = (passed: boolean, skipped?: true) => ({ rungs: [{ id: 'basic', passed, ...(skipped ? { skipped } : {}) } as RungResult] });

describe('homeLayout (1C)', () => {
  it('no practice, unanswered: the welcome first, no streak, backup, readiness or switch nudge', () => {
    expect(homeLayout(false, basic(false), {})).toEqual(['welcome', 'intro', 'ladder', 'guided', 'play', 'statsLink', 'build']);
  });

  it('no practice, answered: the same without the welcome', () => {
    expect(homeLayout(false, basic(false, true), { welcome: 'basic' })).toEqual(['intro', 'ladder', 'guided', 'play', 'statsLink', 'build']);
  });

  it('with practice, basic not done: today\'s Home with the ladder above guided, and no welcome even if unanswered', () => {
    expect(homeLayout(true, basic(false), {})).toEqual(['streak', 'ladder', 'guided', 'suggest', 'backup', 'readiness', 'play', 'build']);
  });

  it('with practice, basic passed: guided above the ladder', () => {
    expect(homeLayout(true, basic(true), { welcome: 'new' })).toEqual(['streak', 'guided', 'ladder', 'suggest', 'backup', 'readiness', 'play', 'build']);
  });

  it('with practice, basic skipped at the welcome: guided above the ladder too', () => {
    expect(homeLayout(true, basic(false, true), { welcome: 'basic' })).toEqual(['streak', 'guided', 'ladder', 'suggest', 'backup', 'readiness', 'play', 'build']);
  });
});
