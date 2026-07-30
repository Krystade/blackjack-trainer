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
