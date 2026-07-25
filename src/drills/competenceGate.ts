/**
 * Reusable accuracy-gated competence gate (docs/BACKLOG.md R2 -- "fix the
 * timed ramp; gate distraction/speed/interleave"). A controlled study
 * (docs/research/2026-07-23-training-science.md #2/#3) found that advancing
 * difficulty on a fixed SCHEDULE inflates in-drill scores without improving
 * retained skill; the fix is to unlock a harder pace only once measured
 * accuracy holds at the current one. This module is intentionally generic
 * (over any per-attempt `{ tier, correct }` record) so the queued
 * distraction feature (D1) can reuse the exact same gate rather than each
 * hard mode growing its own bespoke progression logic.
 *
 * Deliberately zero dependency on the clock or any persisted state -- like
 * drills/countSpeed.ts, this is a pure function of the history array a
 * caller passes in (e.g. `stats.timedCount.history`, mapped to this
 * module's minimal shape).
 */
import type { SpeedTier } from './countSpeed';

/** Tier progression order, slowest/least-skilled first. Also used to look up
 * "the next tier up" / "the tier below" by index. */
export const SPEED_TIER_ORDER: SpeedTier[] = ['learning', 'table-ready', 'pro', 'expert'];

export interface GateResult {
  /** The tier the user has earned the right to practice at right now. */
  unlockedTier: SpeedTier;
  /** Accuracy (0-100) over the most recent `windowSize` attempts AT
   * `unlockedTier` specifically. 0 when there is no attempt at that tier yet
   * (e.g. immediately after a fresh promotion). */
  recentAccuracyPct: number;
  /** True when this computation reflects a promotion: the previous tier was
   * held well enough (recent accuracy >= threshold over >= minAttempts) that
   * `unlockedTier` now names the tier ABOVE it. Always false at the top tier
   * ('expert') and false whenever the current tier hasn't (yet) been held. */
  canAdvance: boolean;
}

export interface GateOptions {
  /** How many of the most recent attempts AT A GIVEN TIER to consider when
   * judging "recent" accuracy. Default 10. */
  windowSize?: number;
  /** Accuracy percentage (0-100) a tier's recent window must clear to count
   * as "held". Default 80. */
  advanceThresholdPct?: number;
  /** Minimum number of recent attempts at a tier required before it can be
   * considered held at all -- guards against a lucky short streak advancing
   * the user off a tier they haven't really practiced. Default 5. */
  minAttempts?: number;
}

const DEFAULT_WINDOW_SIZE = 10;
const DEFAULT_ADVANCE_THRESHOLD_PCT = 80;
const DEFAULT_MIN_ATTEMPTS = 5;

/** Consecutive wrong attempts AT THE CURRENT TIER that trigger an ease back
 * down a tier. Deliberately independent of `minAttempts`/`advanceThresholdPct`
 * above -- a short, sharp miss streak is a different signal ("you've clearly
 * lost the pace") from "you simply haven't accumulated enough good reps to
 * advance yet". Not exposed via GateOptions: it's a fixed tripwire, not a
 * tunable mastery bar. */
const MISS_STREAK_TO_EASE = 3;

/**
 * Given recent per-attempt results tagged with the tier they were attempted
 * at, returns the tier the user is currently entitled to practice at.
 *
 * Rules:
 * - Everyone starts at (and can never drop below) 'learning'.
 * - "Current tier" is read off the MOST RECENT entry in `history` (the tier
 *   the caller was actually pacing runs at, last) -- 'learning' if `history`
 *   is empty.
 * - A tier is "held" when its most recent `windowSize` attempts number at
 *   least `minAttempts` AND their accuracy is >= `advanceThresholdPct`.
 * - Advancing to the next tier up REQUIRES holding the current tier (per the
 *   rule above) -- there is no way to skip a tier, and insufficient attempts
 *   (below `minAttempts`) never advances even at 100% accuracy so far.
 * - A recent miss streak (the last `MISS_STREAK_TO_EASE` attempts at the
 *   current tier all wrong) eases the user back down one tier, overriding
 *   any older "held" history -- this check is evaluated BEFORE the advance
 *   check, so a streak always wins over a stale hold.
 * - There is nothing above 'expert' to advance to, and nothing below
 *   'learning' to ease down to.
 */
export function computeUnlockedTier(
  history: { tier: SpeedTier; correct: boolean }[],
  opts?: GateOptions,
): GateResult {
  const windowSize = opts?.windowSize ?? DEFAULT_WINDOW_SIZE;
  const advanceThresholdPct = opts?.advanceThresholdPct ?? DEFAULT_ADVANCE_THRESHOLD_PCT;
  const minAttempts = opts?.minAttempts ?? DEFAULT_MIN_ATTEMPTS;

  const attemptsAt = (tier: SpeedTier) => history.filter((h) => h.tier === tier);
  const recentWindowAt = (tier: SpeedTier) => attemptsAt(tier).slice(-windowSize);
  const accuracyOf = (attemptsList: { correct: boolean }[]): number =>
    attemptsList.length === 0
      ? 0
      : (attemptsList.filter((a) => a.correct).length / attemptsList.length) * 100;
  const isHeld = (tier: SpeedTier): boolean => {
    const window = recentWindowAt(tier);
    return window.length >= minAttempts && accuracyOf(window) >= advanceThresholdPct;
  };
  const hasMissStreak = (tier: SpeedTier): boolean => {
    const all = attemptsAt(tier);
    if (all.length < MISS_STREAK_TO_EASE) return false;
    return all.slice(-MISS_STREAK_TO_EASE).every((a) => !a.correct);
  };

  const currentTier: SpeedTier = history.length > 0 ? history[history.length - 1]!.tier : 'learning';
  const currentIdx = SPEED_TIER_ORDER.indexOf(currentTier);

  let unlockedTier = currentTier;
  let canAdvance = false;

  if (hasMissStreak(currentTier) && currentIdx > 0) {
    unlockedTier = SPEED_TIER_ORDER[currentIdx - 1]!;
  } else if (isHeld(currentTier) && currentIdx < SPEED_TIER_ORDER.length - 1) {
    unlockedTier = SPEED_TIER_ORDER[currentIdx + 1]!;
    canAdvance = true;
  }

  return {
    unlockedTier,
    recentAccuracyPct: accuracyOf(recentWindowAt(unlockedTier)),
    canAdvance,
  };
}

/** The tier one step above `tier` in SPEED_TIER_ORDER, or null at the top
 * ('expert' has nothing above it). Small UI-facing helper -- e.g. the timed
 * drill's result screen uses it to render "hold accuracy to reach <next>". */
export function tierAbove(tier: SpeedTier): SpeedTier | null {
  const idx = SPEED_TIER_ORDER.indexOf(tier);
  return idx >= 0 && idx < SPEED_TIER_ORDER.length - 1 ? SPEED_TIER_ORDER[idx + 1]! : null;
}
