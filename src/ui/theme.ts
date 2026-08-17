/**
 * The shipped themes (C2).
 *
 * A theme is nothing but the token set in `themes.css` selected by a
 * `data-theme` attribute on <html>. This module is the registry the UI reads:
 * ids, display names, and the one-line rationale shown beside each in
 * Settings, so the choice is made on what the theme is FOR rather than on a
 * colour swatch.
 *
 * Four, not twelve. The operator picked these from a wider gallery; the rest
 * were dropped rather than shipped as clutter.
 */

export type ThemeId = 'midnight-felt' | 'bone-ink' | 'amoled-night' | 'slate-copper';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  /** Why you would pick this one — the deciding factor, not a description. */
  note: string;
}

export const THEMES: readonly ThemeMeta[] = [
  {
    id: 'midnight-felt',
    name: 'Midnight Felt',
    note: 'The table at night. The default.',
  },
  {
    id: 'bone-ink',
    name: 'Bone & Ink',
    note: 'Light, like a printed strategy card. Best for studying charts in daylight.',
  },
  {
    id: 'amoled-night',
    name: 'AMOLED Night',
    note: 'True black. Least glare in a dark car, longest battery on a long session.',
  },
  {
    id: 'slate-copper',
    name: 'Slate & Copper',
    note: 'Neutral grey. Charts read cleanest when the ground has no hue of its own.',
  },
];

/** The pre-existing palette, so an untouched install looks unchanged. */
export const DEFAULT_THEME: ThemeId = 'midnight-felt';

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEMES.some((t) => t.id === value);
}

/**
 * Coerce anything to a usable theme id.
 *
 * A stored id can outlive the theme it names — a build that drops one, or a
 * hand-edited settings blob — and an unknown value on <html> selects no token
 * block at all, leaving the app with no palette. Falling back is the only
 * safe read.
 */
export function normalizeTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

/**
 * Publish the theme to the document. Idempotent, and safe in non-browser
 * environments (unit tests, SSR) where `document` is undefined.
 */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}
