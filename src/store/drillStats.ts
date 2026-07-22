/**
 * Pure per-drill telemetry aggregation (see
 * docs/research/2026-07-21-priority-list.md item 8). These helpers turn a
 * persisted Stats history array (src/store/types.ts) into the small summary
 * shapes the Stats screen renders. Deliberately zero dependency on the
 * clock or any other ambient state -- callers pass in already-persisted
 * history entries (each already carries its own `date`, written by the
 * component at the moment of the attempt), so every function here is a
 * trivially unit-testable pure function of its argument.
 */

/** Accuracy summary for any drill history whose entries carry a `correct` flag. */
export interface AccuracySummary {
  attempts: number;
  correct: number;
  /** Percentage 0-100, or null when there are no attempts (nothing to divide). */
  accuracyPct: number | null;
}

/**
 * Summarizes attempts/correct/accuracy for any history array of entries
 * that each have at least a `correct: boolean` field. Generic over the
 * entry shape (via structural typing) so it works unmodified for the
 * count-drill, true-count, deck-estimation, and timed-count histories
 * alike -- none of their extra fields matter here.
 */
export function summarize(history: { correct: boolean }[]): AccuracySummary {
  const attempts = history.length;
  const correct = history.filter((h) => h.correct).length;
  const accuracyPct = attempts === 0 ? null : (correct / attempts) * 100;
  return { attempts, correct, accuracyPct };
}

/**
 * Best (fastest, i.e. lowest) seconds-per-deck among CORRECT runs only --
 * mirrors the existing count-drill "best clean run" semantics in
 * Stats.tsx/CountDrillView.tsx (a fast wrong answer is still wrong, so it
 * can never be "best"). Returns null when there is no correct run to
 * report (empty history, or every run was wrong).
 */
export function bestSecondsPerDeck(
  history: { secondsPerDeck: number; correct: boolean }[],
): number | null {
  const correctRuns = history.filter((h) => h.correct);
  if (correctRuns.length === 0) return null;
  return correctRuns.reduce((best, cur) => Math.min(best, cur.secondsPerDeck), Infinity);
}

/** Signed-error distribution for the true-count conversion drill: which way
 * a wrong (or right) guess missed, not just how often it missed. */
export interface SignedErrorBreakdown {
  /** guess > correctTc */
  tooHigh: number;
  /** guess < correctTc */
  tooLow: number;
  /** guess === correctTc */
  exact: number;
}

/**
 * Tallies the direction of every guess against its correct true count --
 * an actionable pattern for a counter (e.g. "I consistently round down"),
 * distinct from plain right/wrong accuracy. Every entry lands in exactly
 * one of the three buckets.
 */
export function signedErrorBreakdown(
  history: { guess: number; correctTc: number }[],
): SignedErrorBreakdown {
  let tooHigh = 0;
  let tooLow = 0;
  let exact = 0;
  for (const h of history) {
    if (h.guess > h.correctTc) tooHigh += 1;
    else if (h.guess < h.correctTc) tooLow += 1;
    else exact += 1;
  }
  return { tooHigh, tooLow, exact };
}
