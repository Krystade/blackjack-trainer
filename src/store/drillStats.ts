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
  history: { guess?: number; correctTc: number }[],
): SignedErrorBreakdown {
  let tooHigh = 0;
  let tooLow = 0;
  let exact = 0;
  for (const h of history) {
    // An entry with no guess is an eyes-free self-report: the operator said
    // whether they had it, never what they had. Counting it as `exact`
    // because nothing differs from the right answer would turn every
    // admitted miss into a perfect hit -- which is the opposite of what
    // this breakdown is for.
    if (h.guess === undefined) continue;
    if (h.guess > h.correctTc) tooHigh += 1;
    else if (h.guess < h.correctTc) tooLow += 1;
    else exact += 1;
  }
  return { tooHigh, tooLow, exact };
}

/**
 * Median decision latency (R1: docs/BACKLOG.md, decision-latency
 * telemetry). Median, not mean -- latency is right-skewed (a single slow
 * outlier, e.g. a bathroom-break pause mid-drill, would drag a mean far from
 * what a player actually experiences most of the time).
 *
 * Structurally typed like `summarize` above: works over any history array
 * whose entries MAY carry an `elapsedMs` field. Entries without it (either
 * pre-latency-telemetry data, or a drill that doesn't capture timing) are
 * silently ignored rather than treated as zero -- they contribute no
 * information about speed, so counting them would bias the median toward
 * whatever placeholder value was chosen.
 */
export function medianLatency(history: { elapsedMs?: number }[]): number | null {
  const values = history
    .map((h) => h.elapsedMs)
    .filter((ms): ms is number => typeof ms === 'number')
    .sort((a, b) => a - b);

  if (values.length === 0) return null;

  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[mid - 1]! + values[mid]!) / 2;
  }
  return values[mid]!;
}

/**
 * D1 (docs/BACKLOG.md, distraction training): the two failure modes a
 * distraction run can produce are independent -- getting the interruption's
 * own arithmetic wrong, and losing the running count while distracted -- so
 * this reports both percentages separately rather than a single combined
 * score. `countKept` semantics are defined by the caller (part 2 wires it
 * into the count drill); this summary is agnostic to how it was decided.
 */
export interface DistractionSummary {
  attempts: number;
  /** Percentage 0-100 of entries with answerCorrect true, or null when empty. */
  answerAccuracyPct: number | null;
  /** Percentage 0-100 of entries with countKept true, or null when empty. */
  countKeptPct: number | null;
}

export function distractionSummary(
  history: { answerCorrect: boolean; countKept: boolean }[],
): DistractionSummary {
  const attempts = history.length;
  if (attempts === 0) {
    return { attempts: 0, answerAccuracyPct: null, countKeptPct: null };
  }
  const answerCorrectCount = history.filter((h) => h.answerCorrect).length;
  const countKeptCount = history.filter((h) => h.countKept).length;
  return {
    attempts,
    answerAccuracyPct: (answerCorrectCount / attempts) * 100,
    countKeptPct: (countKeptCount / attempts) * 100,
  };
}

/**
 * V3-8 (docs/BACKLOG.md): where the units are actually going.
 *
 * Binary grading can only say which cells were missed. This ranks them by what
 * they COST -- and by total cost, not cost per occurrence, because that is the
 * question a learner is really asking. Standing on soft 18 v 2 is worth four
 * thousandths of a bet; doing it forty times a week costs more than the one
 * spectacular double on a pair of tens that everybody remembers. A per-hand
 * ranking would put the memorable mistake first and the expensive habit nowhere.
 *
 * Only PRICED mistakes appear (see types.ts's `evCost` history): a missed
 * deviation has no honest number, so it is absent here and must be read from the
 * `mistakes` tally instead. `priced` is stated alongside so a caller can say how
 * much of the picture this is rather than implying it is all of it.
 */
export interface EvCostRow {
  /** Group identity: the same hand answered the same wrong way. */
  key: string;
  hand?: string;
  taken: string;
  expected: string;
  /** How many times this exact mistake was made. */
  times: number;
  /** Units of the original bet, per occurrence. */
  unitsEach: number;
  /** times x unitsEach -- what this habit has cost in total. */
  unitsTotal: number;
}

export interface EvCostSummary {
  /** Priced mistakes counted. NOT the total number of mistakes made. */
  priced: number;
  /** Units lost across every priced mistake. */
  unitsTotal: number;
  /** Mean units per priced mistake, or null when none were priced. */
  meanUnits: number | null;
  /** Most expensive habits first, by total units lost. */
  worst: EvCostRow[];
}

export function evCostSummary(
  history: { hand?: string; taken: string; expected: string; units: number }[],
  limit = 5,
): EvCostSummary {
  const groups = new Map<string, EvCostRow>();
  let unitsTotal = 0;

  for (const entry of history) {
    unitsTotal += entry.units;
    const key = `${entry.hand ?? ''}|${entry.expected}|${entry.taken}`;
    const row = groups.get(key);
    if (row) {
      row.times += 1;
      row.unitsTotal += entry.units;
      // Averaged rather than overwritten: two entries under one key should
      // always carry the same price, and if a rules change ever makes them
      // differ, the mean is the honest summary of what actually happened.
      row.unitsEach = row.unitsTotal / row.times;
      continue;
    }
    groups.set(key, {
      key,
      ...(entry.hand === undefined ? {} : { hand: entry.hand }),
      taken: entry.taken,
      expected: entry.expected,
      times: 1,
      unitsEach: entry.units,
      unitsTotal: entry.units,
    });
  }

  const worst = [...groups.values()].sort(
    // Ties broken by frequency then key, so the order is stable rather than
    // dependent on insertion -- a list that reshuffles between renders reads
    // as noise.
    (a, b) => b.unitsTotal - a.unitsTotal || b.times - a.times || a.key.localeCompare(b.key),
  );

  return {
    priced: history.length,
    unitsTotal,
    meanUnits: history.length === 0 ? null : unitsTotal / history.length,
    worst: worst.slice(0, limit),
  };
}
