import { describe, expect, it } from 'vitest';
import { makeDefaultProfile } from '../store/profiles';
import { DEFAULT_SETTINGS } from '../store/types';
import type { Profile, Settings } from '../store/types';
import {
  betsGateClosed,
  checksShown,
  distractionsOn,
  effectivePlayFields,
  playCheckOffPatch,
  playCheckOnPatch,
  playChecksOf,
  tableCheckOffPatch,
  tableCheckOnPatch,
  tableChecksOf,
  tableMistakesMode,
} from './whatToCheck';

const legacy = (patch: Partial<Profile> = {}): Profile => ({ ...makeDefaultProfile(), playChecks: undefined, ...patch });
const settings = (patch: Partial<Settings> = {}): Settings => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });

describe('whatToCheck: legacy derivation (no gate object)', () => {
  it('count from the cadence, deviations from gradeDeviations (absent = on), bets from the ramp', () => {
    expect(playChecksOf(legacy({ countCheckEvery: 5 }))).toEqual({ count: true, deviations: true, bets: false });
    expect(playChecksOf(legacy({ countCheckEvery: 0, gradeDeviations: false, betSpreadOn: true }))).toEqual({
      count: false,
      deviations: false,
      bets: true,
    });
  });

  it('dealer mistakes from the mode (or the G2 boolean), distractions off', () => {
    expect(tableChecksOf(settings())).toEqual({ dealerMistakes: false, distractions: false });
    expect(tableChecksOf(settings({ dealerMistakesMode: 'training' })).dealerMistakes).toBe(true);
    // From structuredClone(DEFAULT_SETTINGS) with no mode field: the G2 boolean.
    const g2 = settings({ dealerMistakes: true });
    delete g2.dealerMistakesMode;
    expect(tableChecksOf(g2).dealerMistakes).toBe(true);
  });

  it('a present object with a missing key reads false', () => {
    expect(playChecksOf(legacy({ countCheckEvery: 5, playChecks: { deviations: true } }))).toEqual({
      count: false,
      deviations: true,
      bets: false,
    });
    expect(tableChecksOf(settings({ dealerMistakesMode: 'training', tableChecks: {} })).dealerMistakes).toBe(false);
  });
});

describe('whatToCheck: effective = gate AND finer value', () => {
  it('an open gate over an editor at Off shows off', () => {
    const p = legacy({ countCheckEvery: 0, betSpreadOn: false, playChecks: { count: true, deviations: true, bets: true } });
    const s = settings({ dealerMistakesMode: 'off', tableChecks: { dealerMistakes: true, distractions: true } });
    expect(checksShown(p, s)).toEqual({ count: false, deviations: true, bets: false, dealerMistakes: false, distractions: true });
  });

  it('a closed gate over values that are on shows off, and Play gets zeros', () => {
    const p = legacy({ countCheckEvery: 8, gradeDeviations: true, betSpreadOn: true, playChecks: { count: false, deviations: false, bets: false } });
    expect(checksShown(p, settings())).toMatchObject({ count: false, deviations: false, bets: false });
    expect(effectivePlayFields(p)).toEqual({ countCheckEvery: 0, gradeDeviations: false, betSpreadOn: false });
    expect(betsGateClosed(p)).toBe(true);
    expect(betsGateClosed(legacy())).toBe(false);
  });

  it('table mistakes: off behind the gate and eyes-free; distractions never eyes-free', () => {
    const on = settings({ dealerMistakesMode: 'training', tableChecks: { dealerMistakes: true, distractions: true } });
    expect(tableMistakesMode(on, false)).toBe('training');
    expect(tableMistakesMode(on, true)).toBe('off');
    expect(tableMistakesMode({ ...on, tableChecks: { dealerMistakes: false } }, false)).toBe('off');
    expect(distractionsOn(on, false)).toBe(true);
    expect(distractionsOn(on, true)).toBe(false);
  });
});

describe('whatToCheck: patches', () => {
  const closed = legacy({ countCheckEvery: 0, gradeDeviations: false, betSpreadOn: false, playChecks: { count: false, deviations: false, bets: false } });

  it('turning on restores 5 rounds / deviations / the ramp only when the finer value was off', () => {
    expect(playCheckOnPatch('count', closed)).toEqual({ playChecks: { count: true, deviations: false, bets: false }, countCheckEvery: 5 });
    expect(playCheckOnPatch('count', { ...closed, countCheckEvery: 8 })).toEqual({
      playChecks: { count: true, deviations: false, bets: false },
    });
    expect(playCheckOnPatch('deviations', closed)).toMatchObject({ gradeDeviations: true });
    expect(playCheckOnPatch('bets', closed)).toMatchObject({ betSpreadOn: true });
  });

  it('turning on count and then deviations in one draft gives the full object', () => {
    let view: Profile = closed;
    view = { ...view, ...playCheckOnPatch('count', view) };
    view = { ...view, ...playCheckOnPatch('deviations', view) };
    expect(view.playChecks).toEqual({ count: true, deviations: true, bets: false });
  });

  it('turning count on for a migrated profile with the ramp on leaves bets off', () => {
    const migrated = { ...closed, betSpreadOn: true };
    const view = { ...migrated, ...playCheckOnPatch('count', migrated) };
    expect(effectivePlayFields(view).betSpreadOn).toBe(false);
  });

  it('turning off writes the gate only', () => {
    const open = legacy({ countCheckEvery: 8 });
    expect(playCheckOffPatch('count', open)).toEqual({ playChecks: { count: false, deviations: true, bets: false } });
  });

  it('dealer mistakes on: occasional only when the rate was off, via dealerMistakesPatch', () => {
    expect(tableCheckOnPatch('dealerMistakes', settings())).toEqual({
      tableChecks: { dealerMistakes: true, distractions: false },
      dealerMistakesMode: 'occasional',
      dealerMistakes: true,
    });
    expect(tableCheckOnPatch('dealerMistakes', settings({ dealerMistakesMode: 'training', tableChecks: {} }))).toEqual({
      tableChecks: { dealerMistakes: true, distractions: false },
    });
    expect(tableCheckOnPatch('distractions', settings())).toEqual({ tableChecks: { dealerMistakes: false, distractions: true } });
    expect(tableCheckOffPatch('dealerMistakes', settings({ dealerMistakesMode: 'training' }))).toEqual({
      tableChecks: { dealerMistakes: false, distractions: false },
    });
  });
});
