import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import type { Action, DeviationId } from '../engine/deviations';
import { ILLUSTRIOUS_18, ILLUSTRIOUS_18_S17 } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { RuleSet } from '../engine/ruleset';
import { makeHardHand } from './buildHand';

export interface QuizItem {
  cards: [Card, Card] | null; // null for insurance items
  up: Rank;
  tc: number;
  deviationId: DeviationId;
  isDeviationSide: boolean;
  correct: Action | 'take-insurance' | 'decline-insurance';
  label: string; // the index label for feedback
}

/**
 * Helper: construct cards for a pair10 (two ten-value cards).
 */
function makePair10Cards(): [Card, Card] {
  return [
    { rank: '10', suit: 's' },
    { rank: 'J', suit: 's' },
  ];
}

/**
 * Draw a random quiz item from the Illustrious 18.
 *
 * @param seed - Optional seed for reproducibility
 * @param filter - Optional deviation id; when set, always draws that entry
 *   (tc is still randomized within ±2 of its threshold). Additive param —
 *   omitting it preserves the original random-entry behavior exactly.
 * @param rules - Optional ruleset (defaults to DEFAULT_RULES). Selects the
 *   H17 vs S17 Illustrious-18 variant (both the entry pool and the
 *   correctPlay grading) so quiz thresholds/labels and grading stay
 *   consistent with the active profile — additive param, omitting it
 *   preserves v1 (H17) behavior exactly.
 * @returns A quiz item
 */
export function drawQuizItem(seed?: number, filter?: DeviationId, rules: RuleSet = DEFAULT_RULES): QuizItem {
  const rng = mulberry32(seed ?? Date.now());
  const deviationSet = rules.s17 ? ILLUSTRIOUS_18_S17 : ILLUSTRIOUS_18;

  // Pick the filtered entry if given, otherwise a random entry from the active ruleset's set
  let entry: (typeof deviationSet)[number];
  if (filter) {
    const found = deviationSet.find((d) => d.id === filter);
    if (!found) {
      throw new Error(`drawQuizItem: unknown deviation id "${filter}"`);
    }
    entry = found;
  } else {
    const entryIndex = Math.floor(rng() * deviationSet.length);
    entry = deviationSet[entryIndex];
  }

  // Generate tc: integer uniform in [threshold - 2, threshold + 2]
  const tcMin = entry.threshold - 2;
  const tcMax = entry.threshold + 2;
  const tc = tcMin + Math.floor(rng() * (tcMax - tcMin + 1));

  // Determine isDeviationSide
  const isDeviationSide = entry.dir === 'gte' ? tc >= entry.threshold : tc <= entry.threshold;

  // Construct cards and correct action
  let cards: [Card, Card] | null;
  let correct: Action | 'take-insurance' | 'decline-insurance';

  if (entry.kind === 'insurance') {
    // Insurance: no cards, correct is take/decline based on tc
    cards = null;
    correct = insuranceCorrect(tc) ? 'take-insurance' : 'decline-insurance';
  } else if (entry.kind === 'pair10') {
    // pair10: two ten-value cards
    cards = makePair10Cards();
    // canSurrender: false models the standard index-play situation (surrender
    // unavailable, e.g. a multi-card or post-split hand) — see deviationQuiz
    // surrender-masking fix: with surrender on, basic surrender beats the
    // 16v10/15v10/16v9 deviations at every TC, making those thresholds
    // unlearnable and contradicting the displayed index label.
    const advice = correctPlay(
      cards,
      entry.up!,
      tc,
      {
        canDouble: true,
        canSplit: true,
        canSurrender: false,
      },
      rules,
    );
    correct = advice.action;
  } else {
    // hard: construct a truly hard (non-pair, non-ace) hand with the specified total
    const totalCards = makeHardHand(entry.total!);
    if (!totalCards) {
      // Fallback: should not happen for valid entries
      throw new Error(`Cannot construct hard total ${entry.total}`);
    }
    cards = totalCards;
    // canSurrender: false — see note above.
    const advice = correctPlay(
      cards,
      entry.up!,
      tc,
      {
        canDouble: true,
        canSplit: true,
        canSurrender: false,
      },
      rules,
    );
    // Note: no special-casing for 11vA. Under h17 it's inactive, so the engine's
    // basic chart (HARD[11] = Dh) already yields 'double' at every tc; under
    // s17 it's active (vs A the S17 basic chart is H) so correctPlay(rules)
    // applies the index (double at tc >= +1) via the S17 deviations set.
    correct = advice.action;
  }

  return {
    cards,
    up: entry.up || ('A' as Rank), // insurance has no up, use 'A' as placeholder
    tc,
    deviationId: entry.id,
    isDeviationSide,
    correct,
    label: entry.label,
  };
}
