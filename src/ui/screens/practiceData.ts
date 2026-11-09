import type { Stats } from '../../store/types';
import type { ProgressState } from '../../habits/progress';

/**
 * Track 1 (1C): whether there is any practice on record. Home shows its
 * first-launch shape (welcome card, no streak, no backup nudge, no readiness)
 * until this turns true, and it does on the first graded answer anywhere.
 *
 * A GENERIC scan past the named fields: any top-level array with a row, and
 * any section whose `history` has a row, so a drill section added later
 * counts without anyone remembering this file. The habit record counts too:
 * a day with answers or active time is practice even where the stats blob
 * was reset or imported without it.
 */
export function hasPracticeData(stats: Stats, progress?: Pick<ProgressState, 'days' | 'answersTotal'>): boolean {
  if (progress && (progress.answersTotal > 0 || Object.values(progress.days).some((d) => d.answers > 0 || d.activeMs > 0 || d.met === true))) return true;
  const s = stats as unknown as Record<string, unknown>;
  const cats = s.categories as Record<string, { right?: number; wrong?: number }> | undefined;
  if (cats && Object.values(cats).some((c) => (c?.right ?? 0) + (c?.wrong ?? 0) > 0)) return true;
  for (const key of ['perIndex', 'cellStats'] as const) {
    const v = s[key];
    if (v && typeof v === 'object' && Object.keys(v).length > 0) return true;
  }
  for (const v of Object.values(s)) {
    if (Array.isArray(v) && v.length > 0) return true;
    if (v && typeof v === 'object') {
      const h = (v as { history?: unknown }).history;
      if (Array.isArray(h) && h.length > 0) return true;
    }
  }
  return false;
}
