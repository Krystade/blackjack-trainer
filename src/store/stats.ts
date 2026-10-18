import type { Category, GradedEvent } from '../engine/grade';
import type { Stats, TallyRW } from './types';
import { cellAfter, cellIdForEvent, handRecentAfter } from './cellStats';

/**
 * Wave A F4: the chart cell an event is tallied under in `cellStats`, or null.
 *
 * An event that carries a `deviationId` was a question about an INDEX -- every
 * real Deviation-quiz item, and a With-count flashcard or Play decision where
 * the index applied. Its answer is index knowledge, not basic strategy: missing
 * 16v10 at TC +1 says nothing about whether you know hard 16 v 10 at TC 0. It
 * used to land on the basic cell anyway, so Home went back to "Fix weak cells"
 * and Custom Auto painted the cell Focus, and learning an index sent you back to
 * the basic chart. Those events are tallied in `perIndex` only.
 *
 * Used by every writer and the undo, so the three can never disagree.
 */
export function tallyCellIdFor(event: GradedEvent): string | null {
  if (event.deviationId) return null;
  return cellIdForEvent(event);
}

/**
 * R9 (#25): whether an event counts in `stats.categories`. An Index-test or
 * With-count index answer (`indexOnly`) is index knowledge and is tallied in
 * `perIndex` only -- never in the basic-strategy hand categories (hard, soft,
 * pairs, surrender), which the per-cell goal reads beside `cellStats`. R9
 * names those two sources; the Deviation quiz and Play keep counting, as
 * Mixed's graded count and the drill specs rely on.
 * Counting them there showed a fresh profile's Index-test answers as "answers
 * from before per-hand tracking". Insurance has no basic play and keeps its
 * tally. Shared with the undo so the two never disagree.
 */
export function countsInCategory(event: GradedEvent): boolean {
  return !event.indexOnly || !BASIC_CATEGORIES.has(event.category);
}

const BASIC_CATEGORIES: ReadonlySet<Category> = new Set<Category>(['hard', 'soft', 'pairs', 'surrender']);

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
 *
 * `fallbackAt` (B3) dates the per-cell tallies of events that carry no `at`
 * of their own -- table play stamps none -- so the caller's clock is used
 * and this function still has none.
 */
export function applyEvents(stats: Stats, events: GradedEvent[], fallbackAt?: string): Stats {
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
  let cellStatsCopied = false;
  let tableCopied = false;

  for (const event of events) {
    // Update category tallies. The tally object itself is copied, not
    // mutated, so sibling categories stay shared with the input.
    if (countsInCategory(event)) {
      const categoryTally = { ...result.categories[event.category] };
      if (event.correct) {
        categoryTally.right += 1;
      } else {
        categoryTally.wrong += 1;
      }
      result.categories[event.category] = categoryTally;
    }

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

    // B3: the chart cell this hand decision was asked on. Insurance, bets,
    // count checks and anything that names no cell are skipped.
    const cellId = tallyCellIdFor(event);
    if (cellId !== null) {
      if (!cellStatsCopied) {
        result.cellStats = { ...stats.cellStats };
        cellStatsCopied = true;
      }
      result.cellStats![cellId] = cellAfter(result.cellStats![cellId], event, fallbackAt);
      // W3: the per-hand-type recent window Home's category gate reads.
      result.handRecent = handRecentAfter(result.handRecent, cellId, event.correct);
    }

    // Update mistakes tally by classification
    result.mistakes[event.classification] += 1;

    // D-R2: the table's own index and mistake tallies, for Stats > Play.
    if (event.source === 'table') {
      if (!tableCopied) {
        result.tableMistakes = { ...stats.tableMistakes };
        result.tablePerIndex = { ...stats.tablePerIndex };
        tableCopied = true;
      }
      result.tableMistakes![event.classification] = (result.tableMistakes![event.classification] ?? 0) + 1;
      if (event.deviationId) {
        const t = { ...(result.tablePerIndex![event.deviationId] ?? { right: 0, wrong: 0 }) };
        if (event.correct) t.right += 1;
        else t.wrong += 1;
        result.tablePerIndex![event.deviationId] = t;
      }
    }

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
        // s10: lets Stats window hand accuracy by the range picker.
        correct: event.correct,
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
        ...(event.source === undefined ? {} : { source: event.source }),
      });
    }
  }

  return result;
}
