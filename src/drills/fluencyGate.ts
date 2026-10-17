/**
 * V3-4 (docs/BACKLOG.md, red-team v3): SOFT competence gating for the pressure /
 * advanced experiential modes (the Downswing tilt session, the count-drill pace-
 * pressure toggle, the bet/sit/leave decision drill). The pressure-training
 * science says these are effective only once base counting fluency is in place —
 * but the operator wants SOFT gating (an advisory, never a lock), since they're
 * an expert and hard locks add friction. So this only tells the UI whether to
 * show a "build your fluency first" nudge; the modes stay clickable regardless.
 *
 * F15 (Wave A): this is now the ONE counting-fluency rule. Home's Next step
 * ("Practise counting") and the Drills picker's nudge used different rules
 * (4 of the last 5 runs vs 10 runs at 70%), so Home could call counting on
 * target while the picker still said "get fluent first". Both read
 * `countFluency` now. B2: this rule is rung 3 of the ladder, nextStep.ts.
 *
 * The rule: of the last COUNT_RUNS_JUDGED QUALIFYING runs, at least
 * COUNT_RUNS_NEEDED were right. A qualifying run is dealt at a set pace (not a
 * self-paced manual run, which can be taken arbitrarily slowly) and is at least
 * one full deck long -- a 13-card sprint says little about holding a count
 * through a shoe. Pure/deterministic over the count-drill history.
 */

export const COUNT_RUNS_JUDGED = 5;
export const COUNT_RUNS_NEEDED = 4;
/** A run shorter than one deck does not count toward fluency. */
export const FLUENCY_MIN_CARDS = 52;

export interface CountRunLike {
  correct: boolean;
  cards: number;
  /** A self-paced run (#20): absent or false on a paced run. */
  manual?: boolean;
}

/** A paced run of at least one deck. */
export function isQualifyingRun(run: CountRunLike): boolean {
  return run.manual !== true && run.cards >= FLUENCY_MIN_CARDS;
}

export interface CountFluency {
  /** The qualifying runs judged (the last COUNT_RUNS_JUDGED), oldest first. */
  judged: number;
  right: number;
  fluent: boolean;
}

export function countFluency(history: readonly CountRunLike[]): CountFluency {
  const runs = history.filter(isQualifyingRun).slice(-COUNT_RUNS_JUDGED);
  const right = runs.filter((r) => r.correct).length;
  return {
    judged: runs.length,
    right,
    fluent: runs.length >= COUNT_RUNS_JUDGED && right >= COUNT_RUNS_NEEDED,
  };
}

/** True once the shared fluency rule is met. Below that, advanced modes show a soft nudge. */
export function isCountFluent(countDrillHistory: readonly CountRunLike[]): boolean {
  return countFluency(countDrillHistory).fluent;
}
