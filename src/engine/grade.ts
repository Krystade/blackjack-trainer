import type { Card, Rank } from './cards';
import type { Action, DeviationId } from './deviations';
import type { Advice } from './strategy';
import { ILLUSTRIOUS_18 } from './deviations';
import { handValue, isPair, pairRank } from './hand';
import { upIndex } from './basicStrategy';

export type MistakeClass = 'correct' | 'basic-error' | 'missed-deviation' | 'phantom-deviation' | 'wrong-anyway';
export type EventKind = 'action' | 'insurance' | 'bet' | 'countCheck';
export type Category = 'hard' | 'soft' | 'pairs' | 'surrender' | 'insurance' | 'bet' | 'countCheck';

export interface GradedEvent {
  kind: EventKind;
  category: Category;
  correct: boolean;
  classification: MistakeClass;
  taken: string; // action taken / value entered
  expected: string; // correct action / value
  reason: string; // Advice.reason or index label
  deviationId?: DeviationId;
  tc: number;
  hand?: string; // e.g. "10,6 v 9"
}

/**
 * Classify the correctness of an action taken during play.
 *
 * @param taken The action the player took
 * @param withCount The correct advice at the given true count (from correctPlay)
 * @param basicOnly The basic strategy advice (from basicPlay)
 * @param cards The player's hand
 * @param up The dealer's up-card
 * @param tc The true count
 * @returns An object with classification and correct flag
 */
export function classifyAction(
  taken: Action,
  withCount: Advice,
  basicOnly: Advice,
  cards: Card[],
  up: Rank,
  // Unused: the tc is already baked into withCount/basicOnly by the caller.
  _tc: number,
): { classification: MistakeClass; correct: boolean } {
  // Step 1: taken === withCount.action -> correct
  if (taken === withCount.action) {
    return { classification: 'correct', correct: true };
  }

  // Step 2-5: Classification of errors
  if (withCount.source === 'illustrious18') {
    // withCount came from a deviation
    if (taken === basicOnly.action) {
      // Took basic instead of the deviation
      return { classification: 'missed-deviation', correct: false };
    } else {
      // Took something other than both withCount and basicOnly
      return { classification: 'wrong-anyway', correct: false };
    }
  } else {
    // withCount.source === 'basic' (no deviation applied at this count)
    // Check for phantom-deviation: an ACTIVE I18 entry exists for this (hand,up) with action === taken
    if (isPhantomDeviation(taken, cards, up)) {
      return { classification: 'phantom-deviation', correct: false };
    } else {
      return { classification: 'basic-error', correct: false };
    }
  }
}

/**
 * Check if there's an active deviation entry that the player guessed.
 * The player took an action that's offered by the Illustrious 18 for this hand/up,
 * but the count didn't justify it.
 */
function isPhantomDeviation(taken: Action, cards: Card[], up: Rank): boolean {
  const hv = handValue(cards);
  const upIdx = upIndex(up);
  const isTenPair = pairRank(cards) === '10'; // pairRank normalizes 10/J/Q/K to '10'

  for (const dev of ILLUSTRIOUS_18) {
    if (!dev.active) continue;
    if (dev.action !== taken) continue;

    // Match by kind
    if (dev.kind === 'hard') {
      // Hard deviations only match hard hands with the same total
      if (hv.soft) continue; // Not a hard hand
      if (dev.total !== hv.total) continue; // Different total
      if (dev.up === undefined) continue; // Should not happen
      if (upIndex(dev.up) !== upIdx) continue; // Different upcard
      return true; // Found a matching active hard deviation with the same action
    } else if (dev.kind === 'pair10') {
      // Pair10 deviations only match ten-value pairs
      if (!isTenPair) continue;
      if (dev.up === undefined) continue;
      if (upIndex(dev.up) !== upIdx) continue;
      return true; // Found a matching active pair10 deviation with the same action
    }
    // insurance deviations are not checked here (different context)
  }

  return false;
}

/**
 * Classify an insurance decision using the finer deviation-aware taxonomy.
 * The Illustrious 18 insurance index is tc >= 3 (see insuranceCorrect in strategy.ts).
 *
 * @param take Whether the player took insurance
 * @param tc The true count at the time of the offer
 * @returns An object with classification and correct flag
 */
export function classifyInsurance(take: boolean, tc: number): { classification: MistakeClass; correct: boolean } {
  const shouldTake = tc >= 3;
  if (take === shouldTake) {
    return { classification: 'correct', correct: true };
  }
  // take === false, shouldTake === true: declined when the count justified taking
  if (shouldTake) {
    return { classification: 'missed-deviation', correct: false };
  }
  // take === true, shouldTake === false: took when the count did not justify it
  return { classification: 'phantom-deviation', correct: false };
}

/**
 * Determine the category of action for a hand.
 *
 * @param cards The player's hand
 * @param correct The correct action
 * @returns The category: 'surrender', 'pairs', 'soft', 'hard', or other event kinds
 */
export function actionCategory(cards: Card[], correct: Action): Category {
  // 'surrender' if correct==='surrender'
  if (correct === 'surrender') {
    return 'surrender';
  }

  // 'pairs' if isPair
  if (isPair(cards)) {
    return 'pairs';
  }

  // 'soft'/'hard' by handValue
  const hv = handValue(cards);
  return hv.soft ? 'soft' : 'hard';
}
