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
 * SHIPPED (RV4, all 6 stages, 2026-07-30 — see the spec doc's own status
 * line). The grade path (src/drills/gradeAnswer.ts), the draw path
 * (src/drills/flashcards.ts, src/drills/deviationQuiz.ts), persistence
 * (bjtrainer.flashsr.v1 / bjtrainer.quizsr.v1) and the Stats "Retention" +
 * "Spaced repetition" sections are all wired against this module today.
 * This comment used to say the wiring was deliberately deferred pending
 * operator review, back when stage 1 of 6 was the only piece built; it no
 * longer is, and leaving the old text here would mislead the next reader
 * into thinking the scheduler is inert.
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
  /**
   * Smoothed answer time on CORRECT answers, in ms; absent until this item has
   * been answered correctly once against a measured clock.
   *
   * Correct answers only, deliberately: a miss is frequently a shot-clock
   * timeout or an attempt abandoned halfway, and folding those durations in
   * would measure how long the learner stared rather than how fast they can
   * recall this cell.
   */
  paceMs?: number;
  /**
   * Bitmask of the channels this item has been answered correctly through
   * (see `channelBit`). Absent on decks written before channels were tracked,
   * which reads as "nothing proven yet" -- the safe direction, since the mask
   * only ever caps promotion, never grants it.
   */
  channels?: number;
}

/**
 * HOW AN ANSWER REACHED THE APP -- the difference between knowing a cell and
 * being able to USE it.
 *
 * `eyesFree`: the question did not need looking at.
 * `handsFree`: the answer did not need touching.
 *
 * The two halves are genuinely independent, which is why they are two booleans
 * and not one difficulty rating: the ZonePad's blind five-zone tap is eyes-free
 * but hands-on, voice is both, and an ActionBar click is neither.
 */
export interface AnswerChannel {
  eyesFree: boolean;
  handsFree: boolean;
}

/** Read off the screen and tapped in -- the easiest channel, and the default. */
export const SCREEN_CHANNEL: AnswerChannel = { eyesFree: false, handsFree: false };

/** The blind five-zone pad: the screen is not being looked at, but it is being touched. */
export const BLIND_TAP_CHANNEL: AnswerChannel = { eyesFree: true, handsFree: false };

/** Spoken. The only channel that survives a steering wheel, and the hardest. */
export const VOICE_CHANNEL: AnswerChannel = { eyesFree: true, handsFree: true };

/** A stable bit per channel, so `SrCard.channels` stays one small number. */
export function channelBit(channel: AnswerChannel): number {
  return (channel.eyesFree ? 1 : 0) | (channel.handsFree ? 2 : 0);
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

/**
 * The answer time at or above which a CORRECT answer counts as hesitant.
 *
 * Recall and reconstruction are different skills, and only the first survives a
 * real table: four seconds is long enough to say a play you know and far too
 * short to walk the chart in your head. A hesitant answer therefore holds its
 * box rather than promoting -- it was not wrong, so it is not demoted or
 * counted as a lapse, but it has not earned a longer gap either.
 */
export const FLUENT_MS = 4000;

/**
 * Weight of the newest sample in `SrCard.paceMs`.
 *
 * An EWMA rather than a mean, because the interesting question is "how fast am
 * I on this cell NOW" -- a cell drilled to fluency last month should not be
 * dragged down forever by the first fumbling answers. 0.4 settles within a
 * handful of reviews while still ignoring a single distracted one.
 */
export const PACE_ALPHA = 0.4;

/**
 * The highest box an answer given ON THE SCREEN can push an item to.
 *
 * Each channel the answer did without -- the screen, the touch -- raises the
 * ceiling by one, so screen-and-tap tops out at box 3 (a week), one of the two
 * at box 4 (a fortnight), and a fully blind, hands-free answer reaches MAX_BOX
 * (a month). Naming a play with a chart-shaped screen in front of you and a
 * finger already on the button is real knowledge and earns a real interval; it
 * is not evidence you can do it in a car, which is what the top of the ladder
 * claims. The ceiling never DEMOTES -- an easy correct answer on an item
 * already above it leaves the box alone -- so this can only slow promotion, and
 * a capped item keeps its higher `srWeight` and comes round again.
 */
export const CHANNEL_BASE_CAP = 3;

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
 * The promotion ceiling for an answer given through `channel`.
 *
 * Never below `CHANNEL_BASE_CAP` and never above `MAX_BOX`; see
 * `CHANNEL_BASE_CAP` for why the screen-and-tap channel stops short.
 */
export function channelBoxCap(channel: AnswerChannel): number {
  const earned = (channel.eyesFree ? 1 : 0) + (channel.handsFree ? 1 : 0);
  return Math.min(CHANNEL_BASE_CAP + earned, MAX_BOX);
}

/** What the caller observed about an answer beyond right-or-wrong. */
export interface ReviewContext {
  /**
   * How long the answer took, in ms. Omitted means UNMEASURED, which is
   * treated as fluent -- absent evidence is not evidence of hesitation, and
   * penalising it would quietly freeze every item answered through a path that
   * has no clock.
   */
  elapsedMs?: number;
  /**
   * Which channel the answer came through. Omitted means UNKNOWN, which is
   * treated as uncapped for the same reason.
   */
  channel?: AnswerChannel;
}

/**
 * Apply a graded answer to an item's schedule, returning the next `SrCard`
 * (pure -- never mutates the input).
 *
 * A miss collapses to box 0 and schedules it due again this session,
 * incrementing `lapses` only if the item had been promoted past box 0 (a real
 * forget, not a still-learning item).
 *
 * A correct answer promotes one box, and `ctx` decides whether it actually
 * does. RIGHT IS NOT THE WHOLE STORY: an answer that took eight seconds was
 * reconstructed rather than recalled, and one read off the screen and tapped in
 * says nothing about whether the cell survives a car. So a hesitant answer
 * holds its box (`FLUENT_MS`) and the channel sets a ceiling
 * (`channelBoxCap`). Neither brake can move an item DOWN -- only a miss does
 * that -- so the worst either can do is leave the item coming round again
 * sooner. Both are opt-in through `ctx`: what the caller did not measure is
 * not held against the learner.
 */
export function reviewCard(
  card: SrCard | undefined,
  correct: boolean,
  now: number,
  ctx: ReviewContext = {},
): SrCard {
  const prev = card ?? freshCard();
  let box: number;
  let lapses = prev.lapses;
  let paceMs = prev.paceMs;
  let channels = prev.channels;

  if (correct) {
    // A correct answer promotes ONE box, subject to two brakes -- and neither
    // brake can move the item backwards. Being slow, or answering off a screen
    // you were already looking at, is not a forget; it just does not buy a
    // longer gap.
    const hesitant = ctx.elapsedMs !== undefined && ctx.elapsedMs >= FLUENT_MS;
    const cap = ctx.channel ? channelBoxCap(ctx.channel) : MAX_BOX;
    const target = hesitant ? prev.box : Math.min(prev.box + 1, cap);
    box = Math.max(prev.box, target);

    if (ctx.elapsedMs !== undefined) {
      paceMs =
        prev.paceMs === undefined
          ? ctx.elapsedMs
          : prev.paceMs + PACE_ALPHA * (ctx.elapsedMs - prev.paceMs);
    }
    if (ctx.channel) channels = (channels ?? 0) | channelBit(ctx.channel);
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
    ...(paceMs === undefined ? {} : { paceMs }),
    ...(channels === undefined ? {} : { channels }),
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
