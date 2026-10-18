import type { Settings, Stats } from '../../../store/types';
import type { RuleSet } from '../../../engine/ruleset';
import { scopesFrom } from '../../../drills/handScope';
import { deckLabel, deckOf } from '../../../drills/deckSource';
import { MIN_CATEGORY_ANSWERS, goalPct, handCategoryProgress } from '../handProgress';

/**
 * W2-7: the one line the hand drills' "what to deal" controls fold into once
 * the first answer of a session is in -- "Hard + Soft · 6D H17 · 12/40".
 * The controls are set once and then only read, and on a 375x812 phone the
 * height they hold is the hand's and the answer bar's.
 */

/** "6D H17": the two rules that change most cells, as short as a chip. */
export function rulesShort(rules: Pick<RuleSet, 'decks' | 's17'>): string {
  return `${rules.decks}D ${rules.s17 ? 'S17' : 'H17'}`;
}

/**
 * Progress to the basic-strategy goal for the dealt hand types, in one
 * figure. While any of them is still too thin to judge: the answers counted
 * toward judging all of them ("12/40" for two types, each needing 20). Once
 * every one is judged: one type reads its figure ("87%", "92% ✓"), several
 * read how many are on target ("1/2 on target"). The full per-type line is
 * one tap away.
 */
export function goalProgressShort(stats: Stats, drill: Settings['drill']): string {
  const scopes = scopesFrom(drill);
  const dealt = handCategoryProgress(stats).filter((c) => scopes.includes(c.scope));
  if (dealt.length === 0) return '';
  if (dealt.some((c) => c.thin)) {
    const counted = dealt.reduce((sum, c) => sum + Math.min(c.n, MIN_CATEGORY_ANSWERS), 0);
    return `${counted}/${MIN_CATEGORY_ANSWERS * dealt.length}`;
  }
  if (dealt.length === 1) {
    const c = dealt[0]!;
    return `${goalPct(c.pct)}${c.onTarget ? ' ✓' : ''}`;
  }
  return `${dealt.filter((c) => c.onTarget).length}/${dealt.length} on target`;
}

/** The deck the controls describe: "Hard + Soft", "Custom · All". */
function deckPart(drill: Settings['drill']): string {
  return deckLabel({ source: deckOf(drill), scopes: scopesFrom(drill) });
}

/** Flashcards: deck, rules, goal progress. */
export function flashSummaryLine(drill: Settings['drill'], rules: RuleSet, stats: Stats): string {
  return [deckPart(drill), rulesShort(rules), goalProgressShort(stats, drill)].filter(Boolean).join(' · ');
}

/** Mixed: deck and rules (Mixed has no progress line to fold). */
export function mixedSummaryLine(drill: Settings['drill'], rules: RuleSet): string {
  return [deckPart(drill), rulesShort(rules)].join(' · ');
}

/** Deviation quiz: the index asked ("All indices", "16 v 10 (stand)") and rules. */
export function quizSummaryLine(indexName: string, rules: RuleSet): string {
  return [indexName, rulesShort(rules)].join(' · ');
}
