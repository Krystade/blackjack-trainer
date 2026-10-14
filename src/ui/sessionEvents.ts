import type { GradedEvent } from '../engine/grade';

/**
 * A Play session's graded events, each dated `at` unless it already carries a
 * date. The engine has no clock, so table events are undated as graded; the
 * session end dates them, which puts Play's priced mistakes (#25) into the
 * cost-of-mistakes history inside a Stats time range, not only under "all".
 */
export function datedSessionEvents(events: readonly GradedEvent[], at: string): GradedEvent[] {
  return events.map((e) => (e.at === undefined ? { ...e, at } : e));
}
