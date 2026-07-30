/**
 * RV4 (docs/BACKLOG.md; spec docs/superpowers/specs/2026-07-30-rv4-spaced-
 * repetition-design.md): a wall-clock Leitner spaced-repetition scheduler that
 * replaces R3's miss-count-only weighting (`weightedDraw.ts`). Each item lives
 * in a box whose interval grows as you get it right and collapses to 0 when you
 * miss, carrying a real `dueAt` timestamp so the drill preferentially resurfaces
 * items that are DUE — training long-term retention rather than only massed
 * in-session accuracy.
 *
 * PURE + DETERMINISTIC: every function takes the current time as an explicit
 * `now` (epoch ms) parameter — nothing reads `Date.now()` here. The calling
 * component supplies `now` (exactly as it already supplies R1's `elapsedMs`),
 * so tests pass an injected/advancing clock and the scheduling math is fully
 * reproducible.
 *
 * STAGE 1 of the staged delivery: this pure module + its tests only. The grade-
 * path/draw-path/persistence/Stats wiring (which includes the schema-migration
 * open question) is deliberately NOT wired here — it awaits operator review of
 * the spec.
 */

/** Keyed by `cellId` (flashcards) or `DeviationId` (deviation quiz). */
export interface SrCard {
  /** Leitner box 0..MAX_BOX; higher = longer interval / more mastered. */
  box: number;
  /** Epoch ms the item is next due for review. */
  dueAt: number;
  /** Epoch ms of the last review (gap detection / telemetry). */
  lastSeenAt: number;
  /** Times missed AFTER being promoted past box 0 — genuine retention failures. */
  lapses: number;
  /** Total reviews (telemetry). */
  reviews: number;
}

export type SrDeck = Record<string, SrCard>;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expanding Leitner ladder (days → ms). Box 0 is due immediately (same session);
 * each higher box waits longer. Documented defaults — tunable in code.
 */
export const BOX_INTERVALS_MS: readonly number[] = [0, 1, 3, 7, 14, 30].map((d) => d * DAY_MS);
export const MAX_BOX = BOX_INTERVALS_MS.length - 1; // 5

/**
 * The box at/above which an item has survived at least one real inter-day gap,
 * so a review of it after its interval elapses counts as a RETENTION test (not
 * massed repetition), and missing it counts as a lapse.
 */
export const LEARNED_BOX = 2;

/** Draw-weight for an unseen item — high, so new material surfaces. */
export const SR_NEW_WEIGHT = 8;
/** Draw-weight for an item scheduled ahead (not yet due) — small but non-zero,
 * so nothing starves when little is due. */
export const SR_NOT_DUE_FLOOR = 0.25;
/** Overdue-ness (days) is capped before it feeds the weight, so a months-stale
 * item can't dominate the entire draw. */
export const OVERDUE_CAP_DAYS = 30;

function freshCard(): SrCard {
  return { box: 0, dueAt: 0, lastSeenAt: 0, lapses: 0, reviews: 0 };
}

/**
 * Apply a graded answer to an item's schedule, returning the next `SrCard`
 * (pure — never mutates the input). A correct answer promotes one box (capped)
 * and pushes `dueAt` out to that box's interval; a miss collapses to box 0 and
 * schedules it due again this session, incrementing `lapses` only if the item
 * had been promoted past box 0 (a real forget, not a still-learning item).
 */
export function reviewCard(card: SrCard | undefined, correct: boolean, now: number): SrCard {
  const prev = card ?? freshCard();
  let box: number;
  let lapses = prev.lapses;
  if (correct) {
    box = Math.min(prev.box + 1, MAX_BOX);
  } else {
    if (prev.box >= LEARNED_BOX) lapses += 1;
    box = 0;
  }
  return {
    box,
    dueAt: now + BOX_INTERVALS_MS[box],
    lastSeenAt: now,
    lapses,
    reviews: prev.reviews + 1,
  };
}

/** True when an item should be drawn now: unseen items are always due; a seen
 * item is due once `now` reaches its `dueAt`. */
export function isDue(card: SrCard | undefined, now: number): boolean {
  if (!card) return true;
  return now >= card.dueAt;
}

/**
 * True when reviewing this item NOW is a genuine RETENTION test: it was promoted
 * past box 0 (learned) AND its scheduled interval has elapsed — i.e. you're
 * recalling it after a real gap, not repeating it seconds later. The retention
 * telemetry (stage 3) records only these.
 */
export function isGapReview(card: SrCard | undefined, now: number): boolean {
  if (!card) return false;
  return card.box >= LEARNED_BOX && now >= card.dueAt;
}

/**
 * Draw weight for an item, feeding the existing `weightedIndex` selection.
 * Ordering by design: unseen (SR_NEW_WEIGHT) ≥ due-and-overdue-low-box >
 * due-just-now-high-box ≥ 1 > not-due (SR_NOT_DUE_FLOOR). More overdue and
 * lower-box (needs more work) ⇒ heavier.
 */
export function srWeight(card: SrCard | undefined, now: number): number {
  if (!card) return SR_NEW_WEIGHT;
  if (now >= card.dueAt) {
    const overdueDays = Math.min((now - card.dueAt) / DAY_MS, OVERDUE_CAP_DAYS);
    return 1 + overdueDays + (MAX_BOX - card.box);
  }
  return SR_NOT_DUE_FLOOR;
}
