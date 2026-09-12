import type { Category, GradedEvent } from '../engine/grade';
import type { Stats, TallyRW } from './types';

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
  let bySourceCopied = false;
  let evCostCopied = false;
  let shotClockCopied = false;

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

    // Per-source split, so "how am I doing at flashcards" is answerable at
    // all. `categories` above stays the POOLED total -- the existing sections
    // read it and must keep counting everything. An event with no source is
    // left unattributed rather than guessed at: every producer predating this
    // field omits it, and inventing a source would quietly fabricate history.
    if (event.source) {
      if (!bySourceCopied) {
        result.bySource = { ...stats.bySource };
        bySourceCopied = true;
      }
      const existing = result.bySource![event.source];
      // A blob written before this field existed has no branch to copy.
      const bucket: Record<Category, TallyRW> = existing
        ? { ...existing }
        : (Object.fromEntries(
            Object.keys(stats.categories).map((k) => [k, { right: 0, wrong: 0 }]),
          ) as Record<Category, TallyRW>);
      const tally = { ...bucket[event.category] };
      if (event.correct) tally.right += 1;
      else tally.wrong += 1;
      bucket[event.category] = tally;
      result.bySource![event.source] = bucket;
    }

    // V5-2: split by whether a deadline was running. `undefined` means the
    // producer never said, which is NOT the same as "untimed" -- table play
    // and every drill answer predating the field land in neither bucket
    // rather than being guessed into the untimed one and diluting it.
    if (event.underShotClock !== undefined) {
      if (!shotClockCopied) {
        result.shotClockSplit = stats.shotClockSplit
          ? { timed: { ...stats.shotClockSplit.timed }, untimed: { ...stats.shotClockSplit.untimed } }
          : { timed: { right: 0, wrong: 0 }, untimed: { right: 0, wrong: 0 } };
        shotClockCopied = true;
      }
      const bucket = event.underShotClock
        ? result.shotClockSplit!.timed
        : result.shotClockSplit!.untimed;
      if (event.correct) bucket.right += 1;
      else bucket.wrong += 1;
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
      // V3-5: carry the caller's timestamp through when there is one. Absent
      // stays absent -- an undated row is honest about being undated, and
      // inventing a date here would need a clock this pure function must not
      // have.
      result.latencyHistory.push({
        category: event.category,
        elapsedMs: event.elapsedMs,
        ...(event.at === undefined ? {} : { date: event.at }),
      });
    }

    // V3-8 (docs/BACKLOG.md): append to the EV-cost history only when the
    // grader actually priced the mistake. Exactly the latencyHistory rule and
    // for exactly the same reason -- `evCost` is absent for a correct answer,
    // for anything a deviation touches, and for an action the hand could not
    // take (see engine/grade.ts), and coercing any of those to 0 would report
    // an unpriced mistake as a free one and drag every average toward nothing.
    if (event.evCost !== undefined) {
      if (!evCostCopied) {
        result.evCost = { history: [...stats.evCost.history] };
        evCostCopied = true;
      }
      result.evCost.history.push({
        category: event.category,
        ...(event.hand === undefined ? {} : { hand: event.hand }),
        taken: event.taken,
        expected: event.expected,
        units: event.evCost,
        ...(event.at === undefined ? {} : { date: event.at }),
      });
    }
  }

  return result;
}
