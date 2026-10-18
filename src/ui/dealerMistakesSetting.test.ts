import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEALER_TRAINING_REPORT,
  dealerMistakesModeIn,
  dealerMistakesOn,
  dealerMistakesPatch,
  dealerMistakesSetting,
  sessionDealerErrors,
} from './dealerErrorCopy';
import { sessionRowFor } from './sessionRow';
import { sessionTag } from './sessionFigures';
import { EMPTY_DEALER_ERROR_TALLY } from '../engine/dealerErrors';
import { _setStorage, loadSettings, saveSettings, SETTINGS_KEY } from '../store/persist';
import { DEFAULT_SETTINGS, type Stats } from '../store/types';

/** Wave I: Dealer mistakes Off / Occasional / Training, and the G2 boolean it replaces. */

describe('Wave I: the setting, and the G2 boolean', () => {
  it('a G2 save of true reads as Occasional; false or absent as Off', () => {
    expect(dealerMistakesSetting({ dealerMistakes: true })).toBe('occasional');
    expect(dealerMistakesSetting({ dealerMistakes: false })).toBe('off');
    expect(dealerMistakesSetting({})).toBe('off');
  });

  it('the mode wins over the boolean once written', () => {
    expect(dealerMistakesSetting({ dealerMistakes: true, dealerMistakesMode: 'training' })).toBe('training');
    expect(dealerMistakesSetting({ dealerMistakes: true, dealerMistakesMode: 'off' })).toBe('off');
    expect(dealerMistakesSetting({ dealerMistakes: false, dealerMistakesMode: 'occasional' })).toBe('occasional');
    // A garbled mode falls back to the boolean, never to Training.
    expect(dealerMistakesSetting({ dealerMistakes: true, dealerMistakesMode: 'often' as never })).toBe('occasional');
  });

  it('the sheet writes the mode and keeps the boolean in step', () => {
    expect(dealerMistakesPatch('off')).toEqual({ dealerMistakesMode: 'off', dealerMistakes: false });
    expect(dealerMistakesPatch('occasional')).toEqual({ dealerMistakesMode: 'occasional', dealerMistakes: true });
    expect(dealerMistakesPatch('training')).toEqual({ dealerMistakesMode: 'training', dealerMistakes: true });
  });

  it('eyes-free forces Off whatever the mode', () => {
    expect(dealerMistakesModeIn({ dealerMistakesMode: 'training' }, false)).toBe('training');
    expect(dealerMistakesModeIn({ dealerMistakesMode: 'training' }, true)).toBe('off');
    expect(dealerMistakesOn({ dealerMistakesMode: 'training' }, false)).toBe(true);
    expect(dealerMistakesOn({ dealerMistakesMode: 'off', dealerMistakes: true }, false)).toBe(false);
  });
});

describe('Wave I: a stored G2 setting survives the upgrade', () => {
  let storage: Record<string, string>;
  beforeEach(() => {
    storage = {};
    _setStorage({
      getItem: (key) => storage[key] ?? null,
      setItem: (key, value) => {
        storage[key] = value;
      },
    });
  });

  it('a saved G2 blob with dealerMistakes: true loads as Occasional', () => {
    storage[SETTINGS_KEY] = JSON.stringify({ ...DEFAULT_SETTINGS, dealerMistakes: true });
    const s = loadSettings();
    expect(s.dealerMistakesMode).toBeUndefined();
    expect(dealerMistakesSetting(s)).toBe('occasional');
  });

  it('defaults are Off, and Training round-trips', () => {
    expect(dealerMistakesSetting(loadSettings())).toBe('off');
    saveSettings({ ...loadSettings(), ...dealerMistakesPatch('training') });
    expect(dealerMistakesSetting(loadSettings())).toBe('training');
  });
});

describe('Wave I: Training is labelled', () => {
  type Row = Stats['sessions'][number];
  const base = {
    id: 's1',
    date: '2026-10-18',
    rounds: 5,
    hands: 5,
    events: [],
    bankrollDelta: 0,
    profileId: 'p',
    profileName: 'P',
    peeks: 0,
    hotShoe: false,
    provisional: false,
  };

  it('the session row carries the flag only for a Training session', () => {
    const t = { ...EMPTY_DEALER_ERROR_TALLY, made: 2, caught: 1 };
    const trained = sessionRowFor({ ...base, ...sessionDealerErrors(t, true, true) });
    expect(trained.dealerMistakesTraining).toBe(true);
    expect(trained.dealerErrors).toEqual({ made: 2, caught: 1, falseCalls: 0 });
    const occasional = sessionRowFor({ ...base, ...sessionDealerErrors(t, true, false) });
    expect('dealerMistakesTraining' in occasional).toBe(false);
    const off = sessionRowFor({ ...base, ...sessionDealerErrors(EMPTY_DEALER_ERROR_TALLY, false, false) });
    expect('dealerMistakesTraining' in off).toBe(false);
    expect('dealerErrors' in off).toBe(false);
  });

  it('Stats tags a Training session, beside Hot shoe', () => {
    const row = (extra: Partial<Row>): Row => ({ date: 'd', rounds: 1, graded: 1, correct: 1, bankrollDelta: 0, ...extra });
    expect(sessionTag(row({ dealerMistakesTraining: true }))).toBe('Foul training');
    expect(sessionTag(row({ hotShoe: true, dealerMistakesTraining: true }))).toBe('Hot shoe · Foul training');
    expect(sessionTag(row({}))).toBeNull();
  });

  it('the report label says the rate and that the bankroll is kept', () => {
    expect(DEALER_TRAINING_REPORT).toContain('one round in 5');
    expect(DEALER_TRAINING_REPORT).toContain('stay in your bankroll');
  });
});
