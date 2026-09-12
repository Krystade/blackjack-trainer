import { makeCountDrill } from './countDrill';
import type { CountDrillRound } from './countDrill';
import { trueCount, tcBand, tcWithinEye, EYE_DECK_ERROR } from '../engine/count';
import type { TcRounding } from '../engine/count';
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

/**
 * V4-3 (docs/BACKLOG.md): the shoe size comes from the ACTIVE PROFILE.
 *
 * This was a hardcoded 6, in the module AND separately in its view, while the
 * app happily runs 1-, 2-, 6- and 8-deck profiles. A double-deck player was
 * being drilled on 6-deck conversions: the divisor range they actually face is
 * 0.5-2, and every question they ever saw ran to 6. Defaulted rather than
 * required, so existing callers and tests are unchanged.
 */
const DEFAULT_TOTAL_DECKS = 6;

/**
 * The slack is no longer a flat number, and that is the point.
 *
 * This used to accept anything within one true count, which is the right idea
 * with the wrong shape: the same half-deck misread is worth several true
 * counts with a deck left in the shoe and almost nothing with five, so a
 * constant is far too tight where it matters and a free pass where it does
 * not. Grading now runs the real division at both ends of a plausible depth
 * read (`tcBand` in engine/count.ts) and accepts anything in between --
 * looser than one true count late in the shoe, tighter than it early, and for
 * the same reason in both directions.
 */

/**
 * Build a produce-a-TC round: `cards` flashed cards in `groupSize` groups (the
 * RC to maintain) plus a seeded decks-remaining depth, and the floored true
 * count they combine to.
 */
export function makeProduceTcRound(
  cards: number,
  groupSize: 1 | 2 | 3,
  seed?: number,
  totalDecks: number = DEFAULT_TOTAL_DECKS,
  rounding?: TcRounding,
): ProduceTcRound {
  const round = makeCountDrill(cards, groupSize, seed);
  // A second draw for the tray depth (0.5 .. totalDecks), seeded off a
  // transformed value so the depth doesn't track the card sequence.
  const rng = mulberry32(((seed ?? Date.now()) ^ 0x9e3779b9) >>> 0);
  const decksRemaining = 0.5 * (1 + Math.floor(rng() * (totalDecks * 2)));
  return {
    round,
    decksRemaining,
    // V5-4: stated in the player's own convention; see trueCountDrill.ts.
    correctTc: trueCount(round.finalRc, decksRemaining, rounding),
  };
}

/**
 * True when a produced true count is one the round's depth could honestly give.
 *
 * Takes the whole round rather than just `correctTc`: the acceptable range
 * depends on the running count and the depth, which the single graded integer
 * has already thrown away.
 */
export function gradeProducedTc(
  produced: number,
  round: ProduceTcRound,
  eyeError: number = EYE_DECK_ERROR,
): boolean {
  return tcWithinEye(produced, round.round.finalRc, round.decksRemaining, eyeError);
}

/**
 * The accepted range, for a result screen that has to explain itself.
 *
 * V5-5: `eyeError` defaults to half a deck, which is what this was hardcoded to
 * -- so every existing caller and test is unchanged -- but the view now passes
 * the resolution the player chose. The band and the grade MUST be computed from
 * the same slack; a result screen that states a wider range than the grader used
 * is worse than one that says nothing.
 */
export function producedTcBand(round: ProduceTcRound, eyeError: number = EYE_DECK_ERROR) {
  return tcBand(round.round.finalRc, round.decksRemaining, eyeError);
}
