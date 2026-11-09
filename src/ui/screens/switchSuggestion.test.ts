import { describe, expect, it } from 'vitest';
import { migratedStillOff, pendingSuggestion } from './SwitchSuggestion';
import type { RungResult } from './nextStep';
import type { CheckKey } from '../whatToCheck';
import { normalizeOnboarding } from '../../store/onboarding';
import { makeDefaultProfile } from '../../store/profiles';

const rung = (id: RungResult['id'], passed: boolean): RungResult => ({ id, passed }) as RungResult;
const ladder = (passed: RungResult['id'][]) => ({
  rungs: (['basic', 'repair', 'count', 'tc', 'deviations', 'betramp', 'play'] as const).map((id) => rung(id, passed.includes(id))),
});
const off: Record<CheckKey, boolean> = { count: false, deviations: false, bets: false, dealerMistakes: false, distractions: false };

describe('pendingSuggestion', () => {
  it('a passed rung with its switch off suggests it', () => {
    expect(pendingSuggestion(ladder(['basic', 'repair', 'count']), off, {})).toEqual({ rung: 'count', check: 'count' });
  });

  it('nothing for an unpassed rung, a dismissed one, or a switch already on', () => {
    expect(pendingSuggestion(ladder(['basic']), off, {})).toBeNull();
    expect(pendingSuggestion(ladder(['count']), off, { suggestions: { count: 'dismissed' } })).toBeNull();
    expect(pendingSuggestion(ladder(['count']), { ...off, count: true }, {})).toBeNull();
  });

  it('in ladder order: count, then deviations, then betramp', () => {
    const all = ladder(['count', 'deviations', 'betramp']);
    expect(pendingSuggestion(all, off, {})!.rung).toBe('count');
    expect(pendingSuggestion(all, off, { suggestions: { count: 'on' } })!.rung).toBe('deviations');
    expect(pendingSuggestion(all, off, { suggestions: { count: 'on', deviations: 'dismissed' } })!.check).toBe('bets');
  });

  it('a skipped rung counts as passed', () => {
    const l = { rungs: [{ ...rung('count', false), skipped: true }] };
    expect(pendingSuggestion(l, off, {})!.rung).toBe('count');
  });

  it('after the migration the "turn back on" card stands in for them', () => {
    expect(pendingSuggestion(ladder(['count']), off, { migratedOff: [] })).toBeNull();
  });
});

describe('migratedStillOff', () => {
  it('lists the migrated switches still off, none once dismissed', () => {
    expect(migratedStillOff({ ...off, count: true }, { migratedOff: ['count', 'bets'] })).toEqual(['bets']);
    expect(migratedStillOff(off, { migratedOff: ['count'], migratedOffDismissed: true })).toEqual([]);
  });
});

describe('onboarding store shape', () => {
  it('keeps only known values', () => {
    expect(normalizeOnboarding({ suggestions: { count: 'on', tc: 'on', deviations: 'maybe' }, migratedOff: ['bets', 'x'] })).toEqual({
      suggestions: { count: 'on' },
      migratedOff: ['bets'],
    });
    expect(normalizeOnboarding('junk')).toEqual({});
  });
});

describe('new profiles', () => {
  it('start with every Play gate explicitly closed', () => {
    expect(makeDefaultProfile().playChecks).toEqual({ count: false, deviations: false, bets: false });
  });
});
