import { describe, expect, it } from 'vitest';
import { momentLine, streakNumberWord, streakSentence } from './moment';
import { diffSettings, formatChanges } from '../diag/settingsDiff';
import { DEFAULT_SETTINGS } from '../store/types';

describe('goal moment line', () => {
  it('words the streak', () => {
    expect(momentLine(12)).toBe('Daily goal done. Twelve days in a row.');
    expect(momentLine(1)).toBe('Daily goal done. A new streak starts today.');
    expect(streakSentence(21)).toBe('Twenty-one days in a row.');
    expect(streakSentence(40)).toBe('Forty days in a row.');
    expect(streakSentence(99)).toBe('Ninety-nine days in a row.');
    expect(streakSentence(100)).toBe('One hundred days in a row.');
    expect(streakSentence(101)).toBe('Over one hundred days in a row.');
    expect(streakNumberWord(57)).toBe('fifty-seven');
  });

  it('a goal change shows in the diagnostic settings diff', () => {
    const changes = diffSettings(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, habits: { goal: 'hard' } });
    expect(formatChanges(changes)).toContain('habits');
    expect(formatChanges(changes)).toContain('hard');
  });
});
