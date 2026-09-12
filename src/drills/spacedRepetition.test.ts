import { describe, it, expect } from 'vitest';
import {
  reviewCard,
  isDue,
  isGapReview,
  srWeight,
  BOX_INTERVALS_MS,
  MAX_BOX,
  LEARNED_BOX,
  SR_NEW_WEIGHT,
  SR_NOT_DUE_FLOOR,
  OVERDUE_CAP_DAYS,
  FLUENT_MS,
  PACE_ALPHA,
  CHANNEL_BASE_CAP,
  SCREEN_CHANNEL,
  BLIND_TAP_CHANNEL,
  VOICE_CHANNEL,
  channelBit,
  channelBoxCap,
  type AnswerChannel,
  type SrCard,
} from './spacedRepetition';

const DAY = 24 * 60 * 60 * 1000;
const T0 = 1_000_000_000_000; // an arbitrary fixed "now" base

describe('reviewCard (RV4 Leitner scheduling)', () => {
  it('a new item answered correctly enters box 1, due after box-1 interval', () => {
    const c = reviewCard(undefined, true, T0);
    expect(c.box).toBe(1);
    expect(c.dueAt).toBe(T0 + BOX_INTERVALS_MS[1]);
    expect(c.lastSeenAt).toBe(T0);
    expect(c.reviews).toBe(1);
    expect(c.lapses).toBe(0);
  });

  it('a new item answered wrong stays box 0, due immediately, and does NOT count a lapse', () => {
    const c = reviewCard(undefined, false, T0);
    expect(c.box).toBe(0);
    expect(c.dueAt).toBe(T0 + BOX_INTERVALS_MS[0]); // interval 0 -> due now
    expect(c.dueAt).toBe(T0);
    expect(c.lapses).toBe(0); // never promoted, so not a retention failure
    expect(c.reviews).toBe(1);
  });

  it('correct answers promote one box per review and cap at MAX_BOX', () => {
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < MAX_BOX + 3; i++) {
      c = reviewCard(c, true, now);
      now += 1;
    }
    expect(c!.box).toBe(MAX_BOX); // capped, never exceeds
    expect(c!.dueAt).toBe(now - 1 + BOX_INTERVALS_MS[MAX_BOX]);
  });

  it('missing a LEARNED item (box >= LEARNED_BOX) resets to box 0 and counts a lapse', () => {
    // Promote to LEARNED_BOX first.
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < LEARNED_BOX; i++) {
      c = reviewCard(c, true, now);
      now += DAY;
    }
    expect(c!.box).toBe(LEARNED_BOX);
    const before = c!.lapses;
    const missed = reviewCard(c, false, now);
    expect(missed.box).toBe(0);
    expect(missed.lapses).toBe(before + 1); // a real forget
    expect(missed.dueAt).toBe(now); // due again this session
  });

  it('missing a still-learning item (box 1, below LEARNED_BOX) resets to 0 with NO lapse', () => {
    const box1 = reviewCard(undefined, true, T0); // box 1
    expect(box1.box).toBe(1);
    const missed = reviewCard(box1, false, T0 + DAY);
    expect(missed.box).toBe(0);
    expect(missed.lapses).toBe(0); // box 1 < LEARNED_BOX(2), not counted
  });

  it('does not mutate the input card', () => {
    const c: SrCard = { box: 2, dueAt: T0, lastSeenAt: T0, lapses: 1, reviews: 5 };
    const snapshot = { ...c };
    reviewCard(c, true, T0 + DAY);
    expect(c).toEqual(snapshot);
  });
});

describe('isDue / isGapReview', () => {
  it('a new (undefined) item is always due but is never a gap review', () => {
    expect(isDue(undefined, T0)).toBe(true);
    expect(isGapReview(undefined, T0)).toBe(false);
  });

  it('isDue flips exactly at dueAt', () => {
    const c: SrCard = { box: 3, dueAt: T0 + DAY, lastSeenAt: T0, lapses: 0, reviews: 3 };
    expect(isDue(c, T0 + DAY - 1)).toBe(false);
    expect(isDue(c, T0 + DAY)).toBe(true);
    expect(isDue(c, T0 + DAY + 1)).toBe(true);
  });

  it('isGapReview requires BOTH learned box AND elapsed interval', () => {
    const learnedDue: SrCard = { box: LEARNED_BOX, dueAt: T0, lastSeenAt: T0 - DAY, lapses: 0, reviews: 2 };
    expect(isGapReview(learnedDue, T0)).toBe(true); // learned + due
    expect(isGapReview(learnedDue, T0 - 1)).toBe(false); // learned but not yet due

    const learnedNotDue: SrCard = { box: 4, dueAt: T0 + DAY, lastSeenAt: T0, lapses: 0, reviews: 6 };
    expect(isGapReview(learnedNotDue, T0)).toBe(false); // learned but not due

    const dueButNotLearned: SrCard = { box: 1, dueAt: T0, lastSeenAt: T0 - DAY, lapses: 0, reviews: 1 };
    expect(isGapReview(dueButNotLearned, T0)).toBe(false); // due but box 1 < LEARNED_BOX
  });
});

describe('srWeight ordering', () => {
  it('an unseen item weighs SR_NEW_WEIGHT', () => {
    expect(srWeight(undefined, T0)).toBe(SR_NEW_WEIGHT);
  });

  it('a not-due item weighs the small floor', () => {
    const c: SrCard = { box: 3, dueAt: T0 + DAY, lastSeenAt: T0, lapses: 0, reviews: 3 };
    expect(srWeight(c, T0)).toBe(SR_NOT_DUE_FLOOR);
  });

  it('a due item weighs 1 + overdueDays + (MAX_BOX - box); more overdue and lower box weigh more', () => {
    const box0JustDue: SrCard = { box: 0, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    expect(srWeight(box0JustDue, T0)).toBe(1 + 0 + MAX_BOX); // 1 + 0 + 5

    const box0Overdue3: SrCard = { box: 0, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    expect(srWeight(box0Overdue3, T0 + 3 * DAY)).toBe(1 + 3 + MAX_BOX);

    const box5JustDue: SrCard = { box: MAX_BOX, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 8 };
    expect(srWeight(box5JustDue, T0)).toBe(1 + 0 + 0); // mastered, low weight but still drawable
  });

  it('overdue-ness is capped at OVERDUE_CAP_DAYS so a stale item cannot dominate', () => {
    const stale: SrCard = { box: 0, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    const wayOverdue = srWeight(stale, T0 + 999 * DAY);
    expect(wayOverdue).toBe(1 + OVERDUE_CAP_DAYS + MAX_BOX);
  });

  it('the weight ordering holds: new >= due-low-box > due-high-box > not-due', () => {
    const dueLowBox: SrCard = { box: 0, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    const dueHighBox: SrCard = { box: MAX_BOX, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 8 };
    const notDue: SrCard = { box: 3, dueAt: T0 + DAY, lastSeenAt: T0, lapses: 0, reviews: 3 };
    const wNew = srWeight(undefined, T0);
    const wLow = srWeight(dueLowBox, T0);
    const wHigh = srWeight(dueHighBox, T0);
    const wNotDue = srWeight(notDue, T0);
    expect(wNew).toBeGreaterThanOrEqual(wLow);
    expect(wLow).toBeGreaterThan(wHigh);
    expect(wHigh).toBeGreaterThan(wNotDue);
  });
});

describe('a full review journey with an advancing clock', () => {
  it('promotes an item box-by-box, each review due after the matching interval', () => {
    let c: SrCard | undefined;
    let now = T0;
    for (let box = 1; box <= MAX_BOX; box++) {
      c = reviewCard(c, true, now);
      expect(c.box).toBe(box);
      expect(c.dueAt).toBe(now + BOX_INTERVALS_MS[box]);
      // Advance the clock to exactly when it comes due, then review again.
      now = c.dueAt;
      expect(isDue(c, now)).toBe(true);
    }
    // Now mastered (box MAX_BOX); after LEARNED it counts gap reviews.
    expect(isGapReview(c, now)).toBe(true);
    expect(c!.lapses).toBe(0); // never missed across the whole journey
  });
});

/* ================================================================== */
/* RIGHT IS NOT THE WHOLE STORY.                                      */
/*                                                                    */
/* Two things the operator asked to be weighed alongside correctness: */
/* how fast the answer came, and which channel it came through. Both  */
/* only ever SLOW promotion -- neither demotes, neither counts a      */
/* lapse -- so the worst either can do is bring an item round again.  */
/* ================================================================== */

describe('reviewCard: how fast the answer came', () => {
  it('a fluent correct answer promotes; a hesitant one holds its box', () => {
    const start: SrCard = { box: 2, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 4 };

    const fluent = reviewCard(start, true, T0, { elapsedMs: FLUENT_MS - 1 });
    expect(fluent.box).toBe(3);

    const hesitant = reviewCard(start, true, T0, { elapsedMs: FLUENT_MS });
    expect(hesitant.box).toBe(2);
    // Held at box 2 means due after the BOX-2 interval -- the gap it already
    // earned, not the longer one it did not.
    expect(hesitant.dueAt).toBe(T0 + BOX_INTERVALS_MS[2]);
  });

  it('the boundary is inclusive on the slow side, so FLUENT_MS exactly is hesitant', () => {
    const start: SrCard = { box: 1, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    expect(reviewCard(start, true, T0, { elapsedMs: FLUENT_MS - 1 }).box).toBe(2);
    expect(reviewCard(start, true, T0, { elapsedMs: FLUENT_MS }).box).toBe(1);
  });

  it('hesitating is not forgetting: no demotion, no lapse', () => {
    const learned: SrCard = { box: 4, dueAt: T0, lastSeenAt: T0, lapses: 1, reviews: 9 };
    const slow = reviewCard(learned, true, T0, { elapsedMs: 30_000 });
    expect(slow.box).toBe(4); // exactly where it was
    expect(slow.lapses).toBe(1); // unchanged -- a lapse is for a MISS
  });

  it('an unmeasured answer promotes: absence of a clock is not evidence of hesitation', () => {
    const start: SrCard = { box: 1, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 1 };
    expect(reviewCard(start, true, T0, {}).box).toBe(2);
    expect(reviewCard(start, true, T0).box).toBe(2);
  });

  it('paceMs starts at the first measured answer and eases toward later ones', () => {
    const first = reviewCard(undefined, true, T0, { elapsedMs: 1000 });
    expect(first.paceMs).toBe(1000);

    // EWMA, not a mean: the newest answer moves it by PACE_ALPHA of the gap.
    const second = reviewCard(first, true, T0 + DAY, { elapsedMs: 2000 });
    expect(second.paceMs).toBeCloseTo(1000 + PACE_ALPHA * 1000, 6);

    // Which is NOT the arithmetic mean of the two samples -- that would be
    // 1500, and would drag a long-since-fluent cell back for ever.
    expect(second.paceMs).not.toBeCloseTo(1500, 6);
  });

  it('a miss leaves paceMs alone -- a timeout measures staring, not recall', () => {
    const fast = reviewCard(undefined, true, T0, { elapsedMs: 800 });
    const missed = reviewCard(fast, false, T0 + DAY, { elapsedMs: 60_000 });
    expect(missed.box).toBe(0);
    expect(missed.paceMs).toBe(800);
  });

  it('an item answered slowly for ever never leaves box 0', () => {
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < 10; i++) {
      c = reviewCard(c, true, now, { elapsedMs: 9000 });
      now += DAY;
    }
    expect(c!.box).toBe(0);
    expect(c!.reviews).toBe(10); // it was RIGHT ten times -- just never fluent
    expect(c!.lapses).toBe(0);
  });
});

describe('reviewCard: which channel the answer came through', () => {
  /** Grind an item with the same channel until it stops moving. */
  const grind = (channel: AnswerChannel, elapsedMs = 500): SrCard => {
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < 12; i++) {
      c = reviewCard(c, true, now, { elapsedMs, channel });
      now += 30 * DAY;
    }
    return c!;
  };

  it('channelBit is one stable bit per half, so the mask is one small number', () => {
    expect(channelBit(SCREEN_CHANNEL)).toBe(0);
    expect(channelBit(BLIND_TAP_CHANNEL)).toBe(1);
    expect(channelBit({ eyesFree: false, handsFree: true })).toBe(2);
    expect(channelBit(VOICE_CHANNEL)).toBe(3);
  });

  it('each channel done without raises the ceiling by one, never past MAX_BOX', () => {
    expect(channelBoxCap(SCREEN_CHANNEL)).toBe(CHANNEL_BASE_CAP);
    expect(channelBoxCap(BLIND_TAP_CHANNEL)).toBe(CHANNEL_BASE_CAP + 1);
    expect(channelBoxCap({ eyesFree: false, handsFree: true })).toBe(CHANNEL_BASE_CAP + 1);
    expect(channelBoxCap(VOICE_CHANNEL)).toBe(MAX_BOX);
  });

  /**
   * THE POINT OF THE WHOLE MECHANISM. A cell only ever answered by reading the
   * screen and tapping a button is real knowledge, and it earns a real
   * interval -- but not the month at the top of the ladder, which claims you
   * can produce it with neither the screen nor the pause.
   */
  it('screen-and-tap tops out at CHANNEL_BASE_CAP however often it is right', () => {
    expect(grind(SCREEN_CHANNEL).box).toBe(CHANNEL_BASE_CAP);
    expect(CHANNEL_BASE_CAP).toBeLessThan(MAX_BOX); // there is a ceiling to hit
  });

  it('blind tapping reaches one box higher; speaking reaches the top', () => {
    expect(grind(BLIND_TAP_CHANNEL).box).toBe(CHANNEL_BASE_CAP + 1);
    expect(grind(VOICE_CHANNEL).box).toBe(MAX_BOX);
    expect(grind(SCREEN_CHANNEL).box).toBeLessThan(grind(BLIND_TAP_CHANNEL).box);
  });

  it('the ceiling never demotes an item that is already above it', () => {
    const mastered: SrCard = { box: MAX_BOX, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 20 };
    const tapped = reviewCard(mastered, true, T0, { elapsedMs: 500, channel: SCREEN_CHANNEL });
    expect(tapped.box).toBe(MAX_BOX);
    expect(tapped.dueAt).toBe(T0 + BOX_INTERVALS_MS[MAX_BOX]);
  });

  it('an omitted channel is uncapped: unknown provenance is not held against you', () => {
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < 12; i++) {
      c = reviewCard(c, true, now, { elapsedMs: 500 });
      now += 30 * DAY;
    }
    expect(c!.box).toBe(MAX_BOX);
    expect(c!.channels).toBeUndefined();
  });

  it('the mask accumulates every channel passed, and a miss adds none', () => {
    const tapped = reviewCard(undefined, true, T0, { channel: SCREEN_CHANNEL });
    expect(tapped.channels).toBe(0);

    // Deliberately the HARD channel first and the easy one second: the other
    // order cannot tell accumulation from overwriting, because voice's bits
    // are a superset of every other channel's.
    const spoken = reviewCard(tapped, true, T0 + DAY, { channel: VOICE_CHANNEL });
    expect(spoken.channels).toBe(channelBit(VOICE_CHANNEL));

    const thenBlind = reviewCard(spoken, true, T0 + 2 * DAY, { channel: BLIND_TAP_CHANNEL });
    expect(thenBlind.channels).toBe(channelBit(VOICE_CHANNEL) | channelBit(BLIND_TAP_CHANNEL));
  });

  it('a miss proves nothing, so it adds no channel to the mask', () => {
    // From a screen-only pass (mask 0), so a mistakenly-credited voice miss
    // would show up as bits appearing out of nowhere.
    const tapped = reviewCard(undefined, true, T0, { channel: SCREEN_CHANNEL });
    expect(tapped.channels).toBe(0);

    const spokenMiss = reviewCard(tapped, false, T0 + DAY, { channel: VOICE_CHANNEL });
    expect(spokenMiss.channels).toBe(0);
  });

  /**
   * The capped item is not merely stuck -- it comes ROUND AGAIN. `srWeight`
   * already leans on (MAX_BOX - box), so holding an item below the ceiling
   * automatically keeps it heavier in the draw than one proven blind. That is
   * the whole reason no separate draw-side weighting was added.
   */
  it('a screen-only item outweighs a spoken-proof one in the draw', () => {
    const screenOnly = grind(SCREEN_CHANNEL);
    const spokenProof = grind(VOICE_CHANNEL);
    // Compared at the same point in each one's cycle: the moment it comes due.
    expect(srWeight(screenOnly, screenOnly.dueAt)).toBeGreaterThan(
      srWeight(spokenProof, spokenProof.dueAt),
    );
  });
});

describe('the two brakes together', () => {
  it('a slow blind answer holds where a fast one promoted', () => {
    let c: SrCard | undefined;
    let now = T0;
    for (let i = 0; i < 8; i++) {
      c = reviewCard(c, true, now, { elapsedMs: 900, channel: BLIND_TAP_CHANNEL });
      now += 30 * DAY;
    }
    expect(c!.box).toBe(CHANNEL_BASE_CAP + 1);

    const slow = reviewCard(c, true, now, { elapsedMs: 12_000, channel: BLIND_TAP_CHANNEL });
    expect(slow.box).toBe(CHANNEL_BASE_CAP + 1);
    expect(slow.lapses).toBe(0);
  });

  it('a miss beats both brakes to the punch: box 0, lapse counted', () => {
    const learned: SrCard = { box: 4, dueAt: T0, lastSeenAt: T0, lapses: 0, reviews: 8 };
    const missed = reviewCard(learned, false, T0, { elapsedMs: 100, channel: VOICE_CHANNEL });
    expect(missed.box).toBe(0);
    expect(missed.lapses).toBe(1);
  });
});
