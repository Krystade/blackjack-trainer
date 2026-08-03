import { makeCountDrill } from './countDrill';
import type { CountDrillRound } from './countDrill';
import { trueCount } from '../engine/count';
import { mulberry32 } from '../engine/cards';

/**
 * V3-2 (docs/BACKLOG.md, red-team v3): the "produce a true count" drill. The
 * existing true-count drill HANDS you the running count and decks-remaining and
 * asks only for the quotient — so RC-maintenance, depth-estimation, and TC
 * division are never composed. This is the actual live-table operation: you
 * flash a card sequence and MAINTAIN the running count yourself, judge the
 * discard tray to ESTIMATE decks remaining, and PRODUCE the true count from the
 * two. Reuses the count drill's flashing (for RC) and a discard-tray depth (for
 * estimation); grading tolerates the by-eye depth slack.
 *
 * Pure/seeded: same seed -> same cards, depth, and answer.
 */
export interface ProduceTcRound {
  /** Flashed card groups whose Hi-Lo sum is the running count to maintain. */
  round: CountDrillRound;
  /** Decks remaining shown as a discard tray (0.5-deck steps) — to be ESTIMATED. */
  decksRemaining: number;
  /** The (floored) true count the player should produce = trueCount(finalRc, decksRemaining). */
  correctTc: number;
}

const TOTAL_DECKS = 6;

/** How far a produced TC may be off and still count as correct — one true count,
 * absorbing a reasonable ±half-deck error in the by-eye depth estimate. */
export const PRODUCE_TC_TOLERANCE = 1;

/**
 * Build a produce-a-TC round: `cards` flashed cards in `groupSize` groups (the
 * RC to maintain) plus a seeded decks-remaining depth, and the floored true
 * count they combine to.
 */
export function makeProduceTcRound(cards: number, groupSize: 1 | 2 | 3, seed?: number): ProduceTcRound {
  const round = makeCountDrill(cards, groupSize, seed);
  // A second draw for the tray depth (0.5 .. TOTAL_DECKS), seeded off a
  // transformed value so the depth doesn't track the card sequence.
  const rng = mulberry32(((seed ?? Date.now()) ^ 0x9e3779b9) >>> 0);
  const decksRemaining = 0.5 * (1 + Math.floor(rng() * (TOTAL_DECKS * 2)));
  return {
    round,
    decksRemaining,
    correctTc: trueCount(round.finalRc, decksRemaining),
  };
}

/** True when a produced true count is close enough to correct (within the
 * by-eye tolerance). */
export function gradeProducedTc(produced: number, correctTc: number): boolean {
  return Math.abs(produced - correctTc) <= PRODUCE_TC_TOLERANCE;
}
