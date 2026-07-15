import type { GradedEvent } from '../engine/grade';
import type { Stats } from './types';

/**
 * Apply graded events to stats, returning a new Stats object (pure function).
 * Does not mutate the input stats.
 */
export function applyEvents(stats: Stats, events: GradedEvent[]): Stats {
  // Deep copy the stats to avoid mutation
  const result: Stats = JSON.parse(JSON.stringify(stats));

  for (const event of events) {
    // Update category tallies
    const categoryTally = result.categories[event.category];
    if (event.correct) {
      categoryTally.right += 1;
    } else {
      categoryTally.wrong += 1;
    }

    // Update perIndex if deviationId is present
    if (event.deviationId) {
      const deviationId = event.deviationId;
      if (!result.perIndex[deviationId]) {
        result.perIndex[deviationId] = { right: 0, wrong: 0 };
      }
      const deviationTally = result.perIndex[deviationId];
      if (deviationTally) {
        if (event.correct) {
          deviationTally.right += 1;
        } else {
          deviationTally.wrong += 1;
        }
      }
    }

    // Update mistakes tally by classification
    result.mistakes[event.classification] += 1;
  }

  return result;
}
