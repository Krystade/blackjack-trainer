import { mulberry32 } from '../engine/cards';

/**
 * ET3 (docs/BACKLOG.md, experiential training): the bet / sit-out / leave
 * decision drill. R5 already drills the binary wong-out (bet vs sit); this adds
 * the missing third axis — LEAVING the table entirely — which real counters
 * face every negative shoe. The grading rule is the researched practitioner
 * CONSENSUS, not invented: see docs/research/2026-08-01-bet-sit-leave-consensus.md.
 *
 * A scenario is a snapshot: the (floored) true count, decks remaining in the
 * shoe (a depth/penetration proxy), and whether a fresh already-shuffled table
 * is available to move to — the last is decisive, since LEAVE is only ever
 * correct when there's somewhere better to go. Pure/seeded so it's reproducible
 * and unit-testable.
 */

export type TableAction = 'bet' | 'sit' | 'leave';

export interface BetSitLeaveScenario {
  /** Floored true count (matches the app's TC convention). */
  trueCount: number;
  /** Decks remaining in the shoe (0.5-deck increments) — the recovery-chance proxy. */
  decksRemaining: number;
  /** Is an already-shuffled shoe/table available to move to? LEAVE requires it. */
  freshShoe: boolean;
}

/* Consensus thresholds (docs/research/2026-08-01-bet-sit-leave-consensus.md §7).
 * T_BET/D_LEAVE are [convention]; T_LEAVE_COUNT/the −1 wong line are [math-backed]. */
export const T_BET = 0; // TC >= 0 -> play the ramp
export const T_LEAVE_COUNT = -2; // this negative won't recover before the cut card
export const D_LEAVE = 2.0; // decks remaining at/below which a negative shoe is "too late"

/**
 * The consensus-correct action for a scenario (evaluated top-down):
 *  - TC >= 0 -> BET.
 *  - negative -> wong-out region: LEAVE if recovery is unlikely (deep-negative
 *    count OR late in the shoe) AND a fresh shoe awaits; otherwise SIT OUT
 *    (early negative may still turn, or nothing better is open).
 */
export function correctAction(s: BetSitLeaveScenario): TableAction {
  if (s.trueCount >= T_BET) return 'bet';
  const leaveWarranted = s.trueCount <= T_LEAVE_COUNT || s.decksRemaining <= D_LEAVE;
  return leaveWarranted && s.freshShoe ? 'leave' : 'sit';
}

/** Short reason for the correct action, for post-answer feedback. */
export function explainAction(s: BetSitLeaveScenario): string {
  if (s.trueCount >= T_BET) return 'Count is neutral-or-positive — play your ramp.';
  const deepNeg = s.trueCount <= T_LEAVE_COUNT;
  const lateShoe = s.decksRemaining <= D_LEAVE;
  if ((deepNeg || lateShoe) && s.freshShoe) {
    return deepNeg
      ? 'Deep-negative count with a fresh table open — leave; it won’t recover.'
      : 'Late in a negative shoe with a fresh table open — leave; too few cards to turn.';
  }
  if (deepNeg || lateShoe) return 'Unfavorable, but no fresh table is open — sit out and wait.';
  return 'Early, mild negative — sit out; the shoe can still turn positive.';
}

const TOTAL_DECKS = 6;
const TC_CLAMP = 6; // realistic true-count bound

/**
 * Generate a seeded, PHYSICALLY-CONSISTENT decision scenario (V3-3 fix): the
 * true count is derived from a plausible running count bounded by how much of
 * the shoe has been dealt, so a big |TC| only occurs deep in the shoe — never
 * an impossible "TC -4 with a near-full shoe". Decks-remaining in 0.5-deck steps
 * over a 6-deck shoe; a fresh table 50/50. This naturally puts the sit/leave
 * decisions where they really happen (deeper, negative shoes) and keeps early
 * shoes near neutral (bet), while still surfacing all three correct actions.
 */
export function makeBetSitLeaveScenario(seed?: number): BetSitLeaveScenario {
  const rng = mulberry32(seed ?? Date.now());
  const decksRemaining = 0.5 * (1 + Math.floor(rng() * 12)); // 0.5..6.0
  const decksDealt = TOTAL_DECKS - decksRemaining;
  // Running count can only have swung as far as the dealt cards allow; ~±2 per
  // dealt deck is already an extreme, so it bounds the plausible spread.
  const rcMax = Math.round(2 * decksDealt) + 1;
  const runningCount = -rcMax + Math.floor(rng() * (2 * rcMax + 1));
  // App convention: floored true count. Clamp to a realistic band.
  const rawTc = Math.floor(runningCount / decksRemaining);
  const trueCount = Math.max(-TC_CLAMP, Math.min(TC_CLAMP, rawTc));
  const freshShoe = rng() < 0.5;
  return { trueCount, decksRemaining, freshShoe };
}
