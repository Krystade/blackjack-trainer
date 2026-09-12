/**
 * ET5 (docs/BACKLOG.md, experiential training): endurance / fatigue drift.
 * Rather than a new drill, this is ANALYTICS over the drill runs you've already
 * logged (operator's choice): within a practice SESSION (a cluster of runs with
 * no long break), it compares your FRONT-HALF vs BACK-HALF accuracy to surface
 * the vigilance decrement — the real-table risk that your count slips late in a
 * long shoe/session even though your cold-start accuracy looks fine.
 *
 * Pure and deterministic: takes dated results + a configurable session-gap,
 * groups into sessions by that gap, and aggregates the front/back split across
 * all qualifying sessions. Within-run latency isn't stored, so the drift is
 * measured at run granularity across a session, not within one run.
 *
 * V3-5 adds the other half of the decrement. Accuracy is a LATE signal: the
 * first thing that goes when you tire is not whether you get there but how long
 * it takes, and a session where you stayed perfect and got two seconds slower
 * is a session that was already starting to cost you. `latencyDrift` measures
 * that over the same sessions, from the same grouping.
 */

export interface DatedResult {
  /** ISO timestamp of the run. */
  date: string;
  correct: boolean;
}

export interface FatigueDrift {
  /** Qualifying sessions analyzed (>= minPerSession runs). */
  sessions: number;
  /** Total runs contributing to the front/back split. */
  samples: number;
  /** Front-half accuracy 0..1 (null if no qualifying data). */
  frontAccuracy: number | null;
  /** Back-half accuracy 0..1 (null if no qualifying data). */
  backAccuracy: number | null;
  /** back − front: negative = accuracy DECLINED late in sessions (fatigue). */
  drift: number | null;
}

export interface FatigueOpts {
  /** A gap longer than this between consecutive runs starts a new session. */
  gapMs: number;
  /** Minimum runs in a session for it to be split front/back (need >= this). */
  minPerSession: number;
}

export const DEFAULT_FATIGUE_OPTS: FatigueOpts = {
  gapMs: 30 * 60 * 1000, // 30 min
  minPerSession: 6, // >= 3 front + 3 back
};

/**
 * Split dated rows into the front and back halves of each qualifying practice
 * session. Rows are sorted by time; a break longer than `gapMs` starts a new
 * session; a session shorter than `minPerSession` contributes nothing.
 *
 * Shared by both analyses on purpose. Two copies of this loop could drift apart
 * and report a different number of sessions off the same runs, which would have
 * the two readouts on the screen quietly disagreeing about what a session is.
 */
export function sessionHalves<T extends { date: string }>(
  rows: readonly T[],
  opts: FatigueOpts,
): { front: T[]; back: T[] }[] {
  const sorted = rows
    .map((r) => ({ t: Date.parse(r.date), row: r }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  const halves: { front: T[]; back: T[] }[] = [];
  let session: T[] = [];
  const flush = () => {
    if (session.length >= opts.minPerSession) {
      const half = Math.floor(session.length / 2);
      halves.push({
        front: session.slice(0, half),
        back: session.slice(session.length - half), // drop the odd middle run
      });
    }
    session = [];
  };

  let prevT: number | null = null;
  for (const r of sorted) {
    if (prevT !== null && r.t - prevT > opts.gapMs) flush();
    session.push(r.row);
    prevT = r.t;
  }
  flush();
  return halves;
}

/**
 * Compute front-half vs back-half accuracy across practice sessions. Each
 * qualifying session is split in half and the front/back correct-counts are
 * pooled across all of them.
 */
export function fatigueDrift(results: DatedResult[], opts: FatigueOpts = DEFAULT_FATIGUE_OPTS): FatigueDrift {
  const halves = sessionHalves(results, opts);

  let frontCorrect = 0;
  let frontTotal = 0;
  let backCorrect = 0;
  let backTotal = 0;
  for (const { front, back } of halves) {
    frontCorrect += front.filter((r) => r.correct).length;
    frontTotal += front.length;
    backCorrect += back.filter((r) => r.correct).length;
    backTotal += back.length;
  }

  return {
    sessions: halves.length,
    samples: frontTotal + backTotal,
    frontAccuracy: frontTotal > 0 ? frontCorrect / frontTotal : null,
    backAccuracy: backTotal > 0 ? backCorrect / backTotal : null,
    drift: frontTotal > 0 && backTotal > 0 ? backCorrect / backTotal - frontCorrect / frontTotal : null,
  };
}

/** One timed answer, dated. */
export interface DatedLatency {
  date: string;
  elapsedMs: number;
}

export interface LatencyDrift {
  /** Qualifying sessions analyzed (>= minPerSession answers). */
  sessions: number;
  /** Total answers contributing to the front/back split. */
  samples: number;
  /** Median answer time in the front halves, ms (null if no qualifying data). */
  frontMedianMs: number | null;
  /** Median answer time in the back halves, ms. */
  backMedianMs: number | null;
  /** back - front, ms. POSITIVE = you SLOWED DOWN late in sessions. */
  driftMs: number | null;
}

/** Median of a non-empty list; the mean of the middle two on an even count. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Front-half vs back-half MEDIAN answer time across practice sessions.
 *
 * Median, not mean. One answer where the phone went down for thirty seconds
 * would move a mean further than a genuine two-second slowdown does, and the
 * question here is what a TYPICAL answer late in a session costs -- an outlier
 * is not the answer to that.
 *
 * Note the sign runs the opposite way from `fatigueDrift`: there, negative is
 * the bad direction (accuracy fell); here, positive is (you got slower). Both
 * are stated on their own fields, because one shared convention that fits one
 * of them backwards is worse than two clearly-labelled ones.
 */
export function latencyDrift(
  rows: DatedLatency[],
  opts: FatigueOpts = DEFAULT_FATIGUE_OPTS,
): LatencyDrift {
  const halves = sessionHalves(rows, opts);
  const front: number[] = [];
  const back: number[] = [];
  for (const half of halves) {
    for (const r of half.front) front.push(r.elapsedMs);
    for (const r of half.back) back.push(r.elapsedMs);
  }
  const frontMedianMs = front.length > 0 ? median(front) : null;
  const backMedianMs = back.length > 0 ? median(back) : null;
  return {
    sessions: halves.length,
    samples: front.length + back.length,
    frontMedianMs,
    backMedianMs,
    driftMs: frontMedianMs !== null && backMedianMs !== null ? backMedianMs - frontMedianMs : null,
  };
}
