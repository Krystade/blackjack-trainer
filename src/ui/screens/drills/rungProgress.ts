import type { Profile, Stats } from '../../../store/types';
import type { RungId } from '../nextStep';
import { buildHomeLadder } from '../ladderContext';

/**
 * L-3: a drill's step progress on its result screen -- the Home ladder rung
 * the drill feeds, read from the very function Home builds the ladder with
 * (`ladder`, nextStep.ts), with the context Home gives it. So the result
 * screen and Home cannot disagree about how far along a rung is.
 */

/** Which rung each drill's answers count toward; null where none does. */
export const DRILL_RUNG = {
  count: 'count',
  truecount: 'tc',
  // Produce the true count keeps its own history (`produceTc`); no rung reads it.
  producetc: null,
  betsizing: 'betramp',
  indextest: 'deviations',
} as const satisfies Record<string, RungId | null>;

/**
 * Speed writes a miss under the index that decided it, else under its chart
 * cell (drills/speedGrade.ts), so a question feeds Deviations or Basic
 * strategy by whether an index decides it.
 */
export function speedRung(q: { deviationId?: string }): RungId {
  return q.deviationId ? 'deviations' : 'basic';
}

/**
 * The ladder exactly as Home builds it. D3 (2026-11-07): through the one
 * context builder (ladderContext.ts), so skipped and rusty rungs read the
 * same on a result screen as on Home.
 */
export function homeLadder(stats: Stats, profile?: Profile, now: number = Date.now()) {
  return buildHomeLadder(stats, profile, now);
}

/** "Running count at table pace: 3/5 table-pace deck runs", ticked once passed. */
export function rungLine(rung: { label: string; progress: string; passed: boolean }): string {
  return `${rung.label}: ${rung.progress}${rung.passed ? ' ✓' : ''}`;
}

/** The line for `rungId`, from `stats` as Home would read them. */
export function rungProgressLine(stats: Stats, rungId: RungId, profile?: Profile): string {
  const rung = homeLadder(stats, profile).rungs.find((r) => r.id === rungId);
  return rung ? rungLine(rung) : '';
}
