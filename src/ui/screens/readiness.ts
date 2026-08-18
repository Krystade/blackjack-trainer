import type { Stats } from '../../store/types';
import { medianLatency } from '../../store/drillStats';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';

/**
 * The numbers the Home dashboard answers "am I ready?" with (C4).
 *
 * Pure and separately tested: the dashboard is the first thing seen on every
 * launch, so a divide-by-zero or a stray NaN here is the most visible bug the
 * app could have. Every figure is nullable — a fresh install has no history,
 * and "—" is the honest answer, not 0%.
 */

export interface Readiness {
  /** Overall decision accuracy across every graded play, 0..100. */
  accuracyPct: number | null;
  /** Median time to decide, ms. The variable that predicts table survival. */
  medianMs: number | null;
  /** Indices answered correctly at least once, out of the active set. */
  indicesKnown: number;
  indicesTotal: number;
  /** Total graded decisions — the credibility of everything above. */
  decisions: number;
}

export function readiness(stats: Stats): Readiness {
  const right = Object.values(stats.categories).reduce((n, c) => n + c.right, 0);
  const wrong = Object.values(stats.categories).reduce((n, c) => n + c.wrong, 0);
  const decisions = right + wrong;

  const active = ILLUSTRIOUS_18.filter((d) => d.active);
  const indicesKnown = active.filter((d) => (stats.perIndex[d.id]?.right ?? 0) > 0).length;

  return {
    accuracyPct: decisions === 0 ? null : (right / decisions) * 100,
    medianMs: medianLatency(stats.latencyHistory),
    indicesKnown,
    indicesTotal: active.length,
    decisions,
  };
}

/**
 * The categories worth practising next: worst accuracy first, and only those
 * with enough attempts to mean anything. A dashboard that names your weakest
 * hand is worth more than one that reports a single blended percentage.
 */
export function weakestCategories(stats: Stats, minAttempts = 5, limit = 3): string[] {
  return Object.entries(stats.categories)
    .map(([name, c]) => ({ name, attempts: c.right + c.wrong, pct: c.right + c.wrong === 0 ? 1 : c.right / (c.right + c.wrong) }))
    .filter((c) => c.attempts >= minAttempts && c.pct < 1)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, limit)
    .map((c) => c.name);
}
