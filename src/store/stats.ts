import type { GradedEvent } from '../engine/grade';
import type { Stats } from './types';

/**
 * Apply graded events to stats, returning a new Stats object (pure function).
 * Does not mutate the input stats.
 *
 * This used to be `JSON.parse(JSON.stringify(stats))` and then mutate the
 * copy. That was correct but paid for purity by copying the ENTIRE blob on
 * every single graded answer -- including the countDrill / trueCount /
 * deckEstimation / timedCount histories, which this function never reads or
 * writes and which retention.ts allows to grow to 2000 entries each. The
 * cost therefore scaled with how much the user had practised: roughly 27ms
 * per answer on a year-old blob, felt worst by the people using the app most.
 *
 * Now it copies only the branches it actually writes and shares the rest by
 * reference. Purity is unchanged -- no object reachable from the input is
 * ever mutated -- but the work is proportional to what changed rather than
 * to the whole history. src/store/statsSharing.test.ts pins both properties,
 * including the sharing itself, so a future refactor cannot quietly
 * reintroduce a deep copy.
 */
export function applyEvents(stats: Stats, events: GradedEvent[]): Stats {
  if (events.length === 0) return { ...stats };

  // Shallow copy of the root, then copy-on-write each branch we touch. Every
  // branch below is replaced wholesale before being written to, so the
  // originals are never observed in a mutated state.
  const result: Stats = { ...stats };
  result.categories = { ...stats.categories };
  result.mistakes = { ...stats.mistakes };

  // perIndex and latencyHistory are only copied if an event actually needs
  // them; an untimed, non-deviation event should touch neither.
  let perIndexCopied = false;
  let latencyCopied = false;

  for (const event of events) {
    // Update category tallies. The tally object itself is copied, not
    // mutated, so sibling categories stay shared with the input.
    const categoryTally = { ...result.categories[event.category] };
    if (event.correct) {
      categoryTally.right += 1;
    } else {
      categoryTally.wrong += 1;
    }
    result.categories[event.category] = categoryTally;

    // Update perIndex if deviationId is present
    if (event.deviationId) {
      const deviationId = event.deviationId;
      if (!perIndexCopied) {
        result.perIndex = { ...stats.perIndex };
        perIndexCopied = true;
      }
      const existing = result.perIndex[deviationId] ?? { right: 0, wrong: 0 };
      const deviationTally = { ...existing };
      if (event.correct) {
        deviationTally.right += 1;
      } else {
        deviationTally.wrong += 1;
      }
      result.perIndex[deviationId] = deviationTally;
    }

    // Update mistakes tally by classification
    result.mistakes[event.classification] += 1;

    // R1 (docs/BACKLOG.md): append to latencyHistory only when the producer
    // actually captured a decision time. A missing elapsedMs (every existing
    // producer, e.g. table play) must stay absent from this history, never
    // be coerced to 0 -- medianLatency would otherwise be dragged toward a
    // false "instant" reading by events that were never timed at all.
    if (event.elapsedMs !== undefined) {
      if (!latencyCopied) {
        result.latencyHistory = [...stats.latencyHistory];
        latencyCopied = true;
      }
      result.latencyHistory.push({ category: event.category, elapsedMs: event.elapsedMs });
    }
  }

  return result;
}
