import { describe, expect, it } from 'vitest';
import { counterPatch } from './WelcomeCard';
import { LADDER_ORDER, normalizeOnboarding, skippedRungs } from '../../store/onboarding';
import { RUNG_LABELS } from './nextStep';
import { makeDefaultProfile } from '../../store/profiles';
import { playChecksOf } from '../whatToCheck';

describe('skippedRungs (1C)', () => {
  it('lists the rungs before the start rung', () => {
    expect(skippedRungs({})).toEqual([]);
    expect(skippedRungs({ startRung: 'basic' })).toEqual([]);
    expect(skippedRungs({ startRung: 'count' })).toEqual(['basic', 'repair']);
    expect(skippedRungs({ startRung: 'deviations' })).toEqual(['basic', 'repair', 'count', 'tc']);
  });

  it('the store\'s ladder order is the ladder\'s', () => {
    expect(LADDER_ORDER).toEqual(Object.keys(RUNG_LABELS));
  });

  it('normalize keeps a known welcome and start rung and drops the rest', () => {
    expect(normalizeOnboarding({ welcome: 'counter', startRung: 'deviations' })).toEqual({ welcome: 'counter', startRung: 'deviations' });
    expect(normalizeOnboarding({ welcome: 'expert', startRung: 'nope' })).toEqual({});
  });
});

describe('counterPatch (1C)', () => {
  it('turns Count checks, Deviations and Bet checks on from a default profile', () => {
    const p = makeDefaultProfile();
    expect(playChecksOf(p)).toEqual({ count: false, deviations: false, bets: false });
    expect(playChecksOf({ ...p, ...counterPatch(p) })).toEqual({ count: true, deviations: true, bets: true });
  });
});
