import type { Profile, Stats } from '../../store/types';
import { strategyRulesFor } from '../../store/profiles';
import { loadMasteryRun } from '../../drills/masteryChallenge';
import { loadFlashSr, loadQuizSr } from '../../drills/gradeAnswer';
import { ladder, masterySweepDone, type Ladder, type LadderContext } from './nextStep';
import { loadOnboarding, skippedRungs } from '../../store/onboarding';
import { advanceRust, loadRust } from '../../drills/rust';
import { activeIndices } from './readiness';

/**
 * Track 1 (2026-11-07, D3): THE one place the ladder's context is gathered.
 *
 * Home, the guided session, the Drills picker's labels and every drill's
 * result line ("Running count at table pace: 3/5 ...") all judge where the
 * user is from `ladder()`, and each used to assemble its own context. Every
 * later addition to that context (skipped rungs from the welcome, rust from
 * re-tests) is made here, so no reader can be left on an older judgement.
 */
export function homeLadderContext(stats: Stats, profile?: Profile, now: number = Date.now()): LadderContext {
  const base: LadderContext = {
    sweepDone: (stats.masterySweepsCompleted ?? 0) > 0 || masterySweepDone(loadMasteryRun()),
    rules: profile ? strategyRulesFor(profile) : undefined,
    flashSr: loadFlashSr(),
    quizSr: loadQuizSr(),
    now,
    // 1C: the welcome's skips, so Home, guided, Drills and the result lines all see them.
    skipped: skippedRungs(loadOnboarding()),
  };
  // 3B: rust, advanced in memory against the ladder each rung's own rule
  // gives (Home saves what it shows; every other reader computes the same).
  const live = ladder(stats, base);
  const activeIds = activeIndices(base.rules).map((d) => d.id);
  return { ...base, rust: advanceRust(loadRust(), live.rungs, stats, { activeIds, quizSr: base.quizSr }, now) };
}

/** The ladder exactly as Home shows it. */
export function buildHomeLadder(stats: Stats, profile?: Profile, now: number = Date.now()): Ladder {
  return ladder(stats, homeLadderContext(stats, profile, now));
}
