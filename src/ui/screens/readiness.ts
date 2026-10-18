import type { Stats } from '../../store/types';
import { medianLatency } from '../../store/drillStats';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { RuleSet } from '../../engine/ruleset';
import { indexTestSet } from '../../drills/indexTest';
import type { DeviationId } from '../../engine/deviations';
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
  /**
   * Wave B2 #10: indices practised (MIN_INDEX_ANSWERS+ answers), the same
   * figure as the ladder's deviations rung, out of the indices the drills ask.
   */
  indicesPractised: number;
  indicesTotal: number;
  /** Total graded decisions — the credibility of everything above. */
  decisions: number;
  /**
   * H1 fix round: answers on an index (`perIndex`, every source). Index-only
   * answers (the quiz, the Index test, With-count) are not in `decisions`, so
   * a quiz-only profile has decisions 0 and must not read "Nothing answered".
   */
  indexAnswers: number;
}

/**
 * The rule fields the index set depends on (F11). Default: the 6D H17 set.
 * The table rules (DAS, surrender...) decide which indexes the basic chart
 * already plays; absent ones are DEFAULT_RULES'.
 */
export type IndexRules = { decks: number; s17: boolean; surrenderIndices?: boolean; bjaExtras?: boolean } & Partial<RuleSet>;
const DEFAULT_INDEX_RULES: IndexRules = { decks: 6, s17: false };

/**
 * F11: the indices a profile is graded on -- its own set, not always H17's.
 * Wave B2 #22: exactly the set the drills ask (the Index test's: the quiz's
 * set, active entries only), so Home, the ladder and Stats count the same
 * indices and every one of them can be reached. An inactive index (11 v A
 * under H17) and one the profile's chart already plays (9 v 2 at 2 decks)
 * are not in it.
 */
export function activeIndices(rules: IndexRules = DEFAULT_INDEX_RULES) {
  return indexTestSet({ ...DEFAULT_RULES, ...rules });
}

/** An index counts as practised from this many answers (the ladder's rung 5). */
export const MIN_INDEX_ANSWERS = 3;

/** Whether `id` has MIN_INDEX_ANSWERS answers or more, right or wrong. */
export function indexPractised(stats: Stats, id: DeviationId): boolean {
  const t = stats.perIndex?.[id];
  return (t?.right ?? 0) + (t?.wrong ?? 0) >= MIN_INDEX_ANSWERS;
}

export function readiness(stats: Stats, rules?: IndexRules): Readiness {
  const right = Object.values(stats.categories).reduce((n, c) => n + c.right, 0);
  const wrong = Object.values(stats.categories).reduce((n, c) => n + c.wrong, 0);
  const decisions = right + wrong;

  const active = activeIndices(rules);
  const indicesPractised = active.filter((d) => indexPractised(stats, d.id)).length;

  const indexAnswers = Object.values(stats.perIndex ?? {}).reduce(
    (n, t) => n + (t?.right ?? 0) + (t?.wrong ?? 0),
    0,
  );

  return {
    accuracyPct: decisions === 0 ? null : (right / decisions) * 100,
    medianMs: medianLatency(stats.latencyHistory),
    indicesPractised,
    indicesTotal: active.length,
    decisions,
    indexAnswers,
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
