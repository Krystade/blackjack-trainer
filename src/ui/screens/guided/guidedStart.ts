import type { Profile, Stats } from '../../../store/types';
import { strategyRulesFor } from '../../../store/profiles';
import { rungDone, type Ladder } from '../nextStep';
import { buildHomeLadder } from '../ladderContext';
import { loadFlashSr, loadQuizSr } from '../../../drills/gradeAnswer';
import { dueForReview } from '../ladderRules';
import { weakCells } from '../handProgress';
import { activeIndices } from '../readiness';
import { localDayKey } from '../../../store/practiceDays';
import { srWeight, type SrCard } from '../../../drills/spacedRepetition';
import { planSession, type GuidedPreset, type GuidedRung, type PlanInput } from '../../../guided/plan';
import { newSession, type GuidedSession } from '../../../guided/session';

/**
 * Wave L (lane v): what the plan reads, gathered from the same places Home's
 * ladder reads them -- so "weak" in a guided session means exactly what the
 * ladder on the same screen says it means.
 */
export function planInputFor(stats: Stats, profile: Profile, now: number, built?: Ladder): PlanInput {
  const rules = strategyRulesFor(profile);
  const flashSr = loadFlashSr();
  const quizSr = loadQuizSr();
  const lad = built ?? buildHomeLadder(stats, profile, now);
  const rungsPassed: Partial<Record<GuidedRung, boolean>> = {};
  const rungsReached: Partial<Record<GuidedRung, boolean>> = {};
  const rungsSkipped: Partial<Record<GuidedRung, boolean>> = {};
  lad.rungs.forEach((r, i) => {
    if (r.id === 'play') return;
    rungsPassed[r.id] = r.passed;
    if (r.skipped) rungsSkipped[r.id] = true;
    // D1: reached = passed, skipped, or at or before the current rung.
    rungsReached[r.id] = rungDone(r) || lad.current === null || i <= lad.current;
  });
  const due = dueForReview(flashSr, quizSr, activeIndices(rules).map((d) => d.id), now);
  return {
    rungsPassed,
    rungsReached,
    rungsSkipped,
    currentRung: lad.current === null ? null : lad.rungs[lad.current]!.id,
    dueCells: orderDueCells(due.cells, flashSr, now),
    weakCells: weakCells(stats).map((w) => w.id),
    dueIndexes: due.indexes,
  };
}

/**
 * C7: due cells most-needed first -- heaviest SR weight, then most overdue,
 * then by id so the order is deterministic. dueForReview sorts by id, which
 * made every warm-up start at 'hard-10-…'.
 */
export function orderDueCells(ids: readonly string[], sr: Readonly<Record<string, SrCard | undefined>>, now: number): string[] {
  const overdue = (id: string) => now - (sr[id]?.dueAt ?? now);
  return [...ids].sort(
    (a, b) => srWeight(sr[b], now) - srWeight(sr[a], now) || overdue(b) - overdue(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

export function startGuided(preset: GuidedPreset, drive: boolean, stats: Stats, profile: Profile, now: number, built?: Ladder): GuidedSession {
  const plan = planSession(preset, planInputFor(stats, profile, now, built), { drive });
  return newSession(preset, drive, plan, now, localDayKey(new Date(now)));
}
