import type { Stats } from '../../store/types';
import { medianLatency } from '../../store/drillStats';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';
import { CATEGORY_TARGET, handCategoryProgress } from './handProgress';

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
 * The categories worth practising next: worst accuracy first, only those with
 * enough attempts to mean anything, and (W13) only those BELOW the target --
 * a category at 94% is not "weak". Hard / soft / pairs use the same judged
 * figure as Next step and Stats (handProgress.ts, W3), so the three screens
 * agree; the other categories (surrender, insurance, betting, wonging, count
 * checks) have no cell breakdown and read their own tally.
 */
export function weakestCategories(stats: Stats, minAttempts = 5, limit = 3): string[] {
  const hands = handCategoryProgress(stats).map((c) => ({
    name: c.scope as string,
    attempts: c.n,
    pct: c.pct,
  }));
  const others = Object.entries(stats.categories)
    .filter(([name]) => !HAND_CATEGORY_KEYS.has(name))
    .map(([name, c]) => ({ name, attempts: c.right + c.wrong, pct: c.right + c.wrong === 0 ? 1 : c.right / (c.right + c.wrong) }));
  return [...hands, ...others]
    .filter((c) => c.attempts >= minAttempts && c.pct < CATEGORY_TARGET)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, limit)
    .map((c) => c.name);
}

/** The categories handProgress judges from cellStats (Category keys). */
const HAND_CATEGORY_KEYS = new Set(['hard', 'soft', 'pairs']);
