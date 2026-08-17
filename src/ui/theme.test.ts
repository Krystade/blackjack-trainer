import { describe, it, expect } from 'vitest';
import { THEMES, DEFAULT_THEME, normalizeTheme, isThemeId } from './theme';

describe('theme registry', () => {
  it('ships exactly the four themes the operator chose', () => {
    expect(THEMES.map((t) => t.id)).toEqual([
      'midnight-felt',
      'bone-ink',
      'amoled-night',
      'slate-copper',
    ]);
  });

  it('defaults to Midnight Felt', () => {
    // The pre-existing palette. A user who never opens the picker must see no
    // change at all from the theming work.
    expect(DEFAULT_THEME).toBe('midnight-felt');
  });

  it('gives every theme a name and a one-line rationale', () => {
    for (const t of THEMES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.note.length).toBeGreaterThan(0);
    }
  });
});

describe('normalizeTheme', () => {
  it('passes a known id through', () => {
    expect(normalizeTheme('amoled-night')).toBe('amoled-night');
  });

  it('falls back to the default for an unknown id', () => {
    // A theme removed in a later build, or a hand-edited settings blob, must
    // not leave the app with no palette at all.
    expect(normalizeTheme('vegas-neon')).toBe(DEFAULT_THEME);
  });

  it('falls back for null, undefined and non-strings', () => {
    expect(normalizeTheme(null)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
    expect(normalizeTheme(42 as unknown as string)).toBe(DEFAULT_THEME);
  });
});

describe('isThemeId', () => {
  it('accepts every shipped id and rejects others', () => {
    for (const t of THEMES) expect(isThemeId(t.id)).toBe(true);
    expect(isThemeId('phosphor')).toBe(false);
  });
});
