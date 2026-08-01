/**
 * ET5 (docs/BACKLOG.md, experiential training): endurance / fatigue drift.
 * Rather than a new drill, this is ANALYTICS over the drill runs you've already
 * logged (operator's choice): within a practice SESSION (a cluster of runs with
 * no long break), it compares your FRONT-HALF vs BACK-HALF accuracy to surface
 * the vigilance decrement — the real-table risk that your count slips late in a
 * long shoe/session even though your cold-start accuracy looks fine.
 *
 * Pure and deterministic: takes dated {correct} results + a configurable
 * session-gap, groups into sessions by that gap, and aggregates the front/back
 * split across all qualifying sessions. Within-run latency isn't stored, so the
 * drift is measured at run granularity across a session, not within one run.
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
 * Compute front-half vs back-half accuracy across practice sessions. Runs are
 * sorted by time; a break longer than `gapMs` splits sessions. Each session
 * with at least `minPerSession` runs is split in half (odd middle run dropped),
 * and the front/back correct-counts are pooled across all such sessions.
 */
export function fatigueDrift(results: DatedResult[], opts: FatigueOpts = DEFAULT_FATIGUE_OPTS): FatigueDrift {
  const sorted = results
    .map((r) => ({ t: Date.parse(r.date), correct: r.correct }))
    .filter((r) => Number.isFinite(r.t))
    .sort((a, b) => a.t - b.t);

  let frontCorrect = 0;
  let frontTotal = 0;
  let backCorrect = 0;
  let backTotal = 0;
  let sessions = 0;

  let session: { correct: boolean }[] = [];
  const flush = () => {
    if (session.length >= opts.minPerSession) {
      sessions += 1;
      const half = Math.floor(session.length / 2);
      const front = session.slice(0, half);
      const back = session.slice(session.length - half); // drop the odd middle run
      frontCorrect += front.filter((r) => r.correct).length;
      frontTotal += front.length;
      backCorrect += back.filter((r) => r.correct).length;
      backTotal += back.length;
    }
    session = [];
  };

  let prevT: number | null = null;
  for (const r of sorted) {
    if (prevT !== null && r.t - prevT > opts.gapMs) flush();
    session.push({ correct: r.correct });
    prevT = r.t;
  }
  flush();

  return {
    sessions,
    samples: frontTotal + backTotal,
    frontAccuracy: frontTotal > 0 ? frontCorrect / frontTotal : null,
    backAccuracy: backTotal > 0 ? backCorrect / backTotal : null,
    drift: frontTotal > 0 && backTotal > 0 ? backCorrect / backTotal - frontCorrect / frontTotal : null,
  };
}
