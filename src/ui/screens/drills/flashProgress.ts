import type { Stats } from '../../../store/types';
import type { HandScope } from '../../../drills/handScope';
import { CATEGORY_TARGET, MIN_CATEGORY_ANSWERS, goalPct, handCategoryProgress, pctDown } from '../handProgress';

/**
 * B7: Flashcards' one-line progress to the basic-strategy goal, read from
 * handCategoryProgress (the one place Home and Stats read too), so the three
 * screens cannot disagree about whether a hand type is on target.
 */

const SHORT: Record<HandScope, string> = { hard: 'Hard', soft: 'Soft', pairs: 'Pairs' };

const dealt = (stats: Stats, scopes: readonly HandScope[]) =>
  handCategoryProgress(stats).filter((c) => scopes.includes(c.scope));

export function flashProgressLine(stats: Stats, scopes: readonly HandScope[]): string {
  const parts = dealt(stats, scopes).map((c) => {
    const name = SHORT[c.scope];
    if (c.thin) return `${name} ${c.n}/${MIN_CATEGORY_ANSWERS}`;
    return `${name} ${goalPct(c.pct)}${c.onTarget ? ' ✓' : ''}`;
  });
  return `Goal ${pctDown(CATEGORY_TARGET)}%: ${parts.join(' · ')}`;
}

/** Labels of the dealt hand types that went from off target to on target. */
export function goalsCrossed(before: Stats, after: Stats, scopes: readonly HandScope[]): string[] {
  const was = new Map(dealt(before, scopes).map((c) => [c.scope, c.onTarget]));
  return dealt(after, scopes)
    .filter((c) => c.onTarget && !was.get(c.scope))
    .map((c) => c.label);
}

export function goalMetLine(labels: string[], after: Stats): string {
  const parts = handCategoryProgress(after)
    .filter((c) => labels.includes(c.label))
    .map((c) =>
      c.recent ? `${goalPct(c.pct)} over your last ${c.judgedN}` : `${goalPct(c.pct)} over ${c.judgedN} answers`,
    );
  return `${labels.join(' and ')} on target: ${parts.join(', ')}.`;
}
