import type { Settings } from '../store/types';

/**
 * #13: which kinds of hand the hand drills (flashcards, mastery, Mixed) deal.
 *
 * Used to be one of All / Hard / Soft / Pairs (`settings.drill.flashCategory`);
 * it is now any non-empty subset of the three, stored as
 * `settings.drill.scopes`. "All" is not a fourth value but all three chosen.
 */
export type HandScope = 'hard' | 'soft' | 'pairs';
export type LegacyCategory = Settings['drill']['flashCategory'];

/** Canonical order, which is also the order the chips are drawn in. */
export const ALL_SCOPES: readonly HandScope[] = ['hard', 'soft', 'pairs'];

function canonical(scopes: Iterable<string>): HandScope[] {
  const set = new Set(scopes);
  return ALL_SCOPES.filter((s) => set.has(s));
}

/**
 * The scopes a drill should use. `scopes` wins when it names at least one
 * real scope; otherwise (absent, empty, or junk from an old or hand-edited
 * blob) the legacy `flashCategory` decides, 'all' meaning all three. Never
 * empty.
 */
export function scopesFrom(drill: Pick<Settings['drill'], 'scopes' | 'flashCategory'>): HandScope[] {
  const stored = Array.isArray(drill.scopes) ? canonical(drill.scopes) : [];
  if (stored.length > 0) return stored;
  const legacy = drill.flashCategory;
  return legacy === 'hard' || legacy === 'soft' || legacy === 'pairs' ? [legacy] : [...ALL_SCOPES];
}

export function isAllScopes(scopes: readonly HandScope[]): boolean {
  return ALL_SCOPES.every((s) => scopes.includes(s));
}

/**
 * The selection after tapping a chip.
 *
 * - "All" selects all three.
 * - With all three selected, a chip narrows to just that one (the "All" chip
 *   is what is lit, so this is the tap the screen invites).
 * - Otherwise a chip toggles, except that the last one left cannot be
 *   removed: an empty scope would leave the drill nothing to deal.
 */
export function tapScope(current: readonly HandScope[], tapped: HandScope | 'all'): HandScope[] {
  if (tapped === 'all') return [...ALL_SCOPES];
  if (isAllScopes(current)) return [tapped];
  if (current.includes(tapped)) {
    const rest = current.filter((s) => s !== tapped);
    return rest.length > 0 ? canonical(rest) : canonical(current);
  }
  return canonical([...current, tapped]);
}

/** The single-category value older code (and older blobs) understand. */
export function legacyCategory(scopes: readonly HandScope[]): LegacyCategory {
  return scopes.length === 1 ? scopes[0]! : 'all';
}

/** Settings with `scopes` written, and `flashCategory` kept in step. */
export function withScopes(settings: Settings, scopes: readonly HandScope[]): Settings {
  const next = canonical(scopes);
  const safe = next.length > 0 ? next : scopesFrom(settings.drill);
  return {
    ...settings,
    drill: { ...settings.drill, scopes: safe, flashCategory: legacyCategory(safe) },
  };
}

/** The scope a cell id belongs to ("pair-8-v-A" is pairs). */
export function scopeOfCell(cellId: string): HandScope | null {
  if (cellId.startsWith('hard-')) return 'hard';
  if (cellId.startsWith('soft-')) return 'soft';
  if (cellId.startsWith('pair-')) return 'pairs';
  return null;
}

export function filterCellsByScopes<T extends { id: string }>(cells: readonly T[], scopes: readonly HandScope[]): T[] {
  return cells.filter((c) => {
    const scope = scopeOfCell(c.id);
    return scope !== null && scopes.includes(scope);
  });
}

const LABEL: Record<HandScope, string> = { hard: 'Hard', soft: 'Soft', pairs: 'Pairs' };

/** "All", "Pairs", "Hard + Soft". */
export function scopesLabel(scopes: readonly HandScope[]): string {
  if (isAllScopes(scopes)) return 'All';
  return canonical(scopes).map((s) => LABEL[s]).join(' + ');
}
