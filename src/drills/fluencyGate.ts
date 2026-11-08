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
 * self-paced manual run, which can be taken arbitrarily slowly), is at least
 * one full deck long -- a 13-card sprint says little about holding a count
 * through a shoe -- and (T2-2A) is at TABLE PACE: a deck in 30 s or faster,
 * judged on the pace the cards really came at (countRunPerCardMs: per group,
 * an eyes-free run's measured time). The rung is "Running count at table
 * pace"; it used to pass at any speed. Stored runs are re-judged on every
 * read, so a too-slow run on record simply stops counting -- nothing is
 * migrated or deleted. Pure/deterministic over the count-drill history.
 */
import { TABLE_PACE_MS, countRunPerCardMs, isTablePace } from './countSpeed';
import type { CountRunPace } from './countSpeed';

export const COUNT_RUNS_JUDGED = 5;
export const COUNT_RUNS_NEEDED = 4;
/** A run shorter than one deck does not count toward fluency. */
export const FLUENCY_MIN_CARDS = 52;

export interface CountRunLike extends CountRunPace {
  correct: boolean;
  cards: number;
  /** A self-paced run (#20): absent or false on a paced run. */
  manual?: boolean;
  /** C12: no number was given, the operator's own verdict. R7: never qualifies. */
  selfReport?: boolean;
}

/** The rule in words, for any screen that states it (Home's count rung, D9). */
export const FLUENCY_RULE_TEXT = 'a deck or more, at a deck in 30 s or faster';

/**
 * Why a run does not count toward the rung, or null when it does. In the order
 * a user can act on: a self-report and a manual run never count whatever their
 * pace, then length, then pace.
 */
export type RungMissReason = 'selfReport' | 'manual' | 'short' | 'slow';

export function rungMissReason(run: CountRunLike): RungMissReason | null {
  if (run.selfReport === true) return 'selfReport';
  if (run.manual === true) return 'manual';
  if (run.cards < FLUENCY_MIN_CARDS) return 'short';
  if (!isTablePace(countRunPerCardMs(run))) return 'slow';
  return null;
}

/** A paced, graded run of at least one deck, at table pace. */
export function isQualifyingRun(run: CountRunLike): boolean {
  return rungMissReason(run) === null;
}

/**
 * The result screen's line for a run that did not count (selfReport has its
 * own line already, so none here). 500 ms is the fastest step the Time per
 * card stepper reaches at or under TABLE_PACE_MS.
 */
export function rungMissLine(run: CountRunLike): string | null {
  switch (rungMissReason(run)) {
    case 'slow': {
      const perCard = Math.round(countRunPerCardMs(run) ?? 0);
      return `Too slow to count toward the step: ${perCard} ms a card. Table pace is a deck in 30 s (${TABLE_PACE_MS} ms a card): 500 ms or faster on the stepper.`;
    }
    case 'short':
      return `Too short to count toward the step: it takes a deck (${FLUENCY_MIN_CARDS} cards) or more.`;
    case 'manual':
      return 'A run on tap does not count toward the step: it needs a set pace.';
    default:
      return null;
  }
}

/**
 * Eyes-free, the screen is not being read: the one reason a car run misses
 * that the driver can fix is the pace, so only that one is said (T2#6).
 */
export function rungMissSpeech(reason: RungMissReason | null): string | null {
  return reason === 'slow' ? 'Too slow to count toward the table pace step. That needs a deck in 30 seconds.' : null;
}

/**
 * What to say after this run, given the reason last said this visit: the
 * line only when the reason has changed, so twenty slow car runs hear it
 * once, and a slow run after a counted one hears it again.
 */
export function rungMissToSay(lastSaid: RungMissReason | null | undefined, reason: RungMissReason | null): string | null {
  return reason === lastSaid ? null : rungMissSpeech(reason);
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
