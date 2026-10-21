/**
 * Wave L: what the Variant hands drill says.
 *
 * Built from the flashcard prompt and correction sentences (narrate.ts), so
 * almost every line is already clip-covered; the only new sentences are the
 * item-kind openers below, which scripts/spokenPhrases.ts lists for the clip
 * generator. The correction drops the flashcard's "True count was" sentence:
 * the variant charts are basic strategy only, no count.
 */

import type { Action } from '../engine/deviations';
import type { VariantItem } from '../drills/variantDrill';
import { handValue } from '../engine/hand';
import { narrateAction, narrateDealerUp, narrateFlashcardPrompt, narrateReason, narrateTotal } from './narrate';

/** Said before the hand, when the hand is not a plain fresh two-card hand. */
export const VARIANT_OPENERS = {
  free: 'Free hand.',
  afterDouble: 'Doubled.',
  3: 'Three cards.',
  4: 'Four cards.',
  5: 'Five cards.',
} as const;

export function variantOpener(item: Pick<VariantItem, 'kind' | 'cards'>): string | null {
  if (item.kind === 'free') return VARIANT_OPENERS.free;
  if (item.kind === 'afterDouble') return VARIANT_OPENERS.afterDouble;
  if (item.kind === 'multi') {
    const n = item.cards.length as 3 | 4 | 5;
    return VARIANT_OPENERS[n] ?? null;
  }
  return null;
}

/**
 * A hand of three or more cards is said as its total ("Four cards. You have
 * soft seventeen."): the count is in the opener, and a five-card comma list
 * is both slow and not a sentence the clip library can hold.
 */
export function narrateVariantPrompt(item: Pick<VariantItem, 'kind' | 'cards' | 'up'>): string {
  const opener = variantOpener(item);
  const { total, soft } = handValue([...item.cards]);
  const prompt =
    item.cards.length > 2
      ? `${narrateVariantTotal(total, soft)} ${narrateDealerUp(item.up)}`
      : narrateFlashcardPrompt(item.cards, item.up);
  return opener ? `${opener} ${prompt}` : prompt;
}

/** "You have soft seventeen." -- the multi-card hand's sentence. */
export function narrateVariantTotal(total: number, soft: boolean): string {
  return `You have ${narrateTotal(total, soft)}.`;
}

export function narrateVariantCorrection(correct: boolean, expected: Action, reason: string): string {
  if (correct) return 'Correct.';
  return `Wrong. ${narrateReason(reason)} Correct play was ${narrateAction(expected)}.`;
}
