import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isDue, isGapReview, reviewCard, scheduleDueAt, srWeight, SR_NOT_DUE_FLOOR, type SrCard } from './spacedRepetition';
import { formatReviewPlain } from './srStatus';

/**
 * B17: a learned card comes due at the start of a LOCAL day (4am turnover),
 * not N*24h to the minute after it was answered, so the morning commute sees
 * what the evening drive promoted.
 */
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let saved: string | undefined;
beforeAll(() => {
  saved = env.TZ;
  env.TZ = 'America/Los_Angeles';
});
afterAll(() => {
  if (saved === undefined) delete env.TZ;
  else env.TZ = saved;
});

/** Local wall-clock time in Los Angeles. */
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();

describe('spaced repetition due by local day (B17)', () => {
  it('a cell promoted to box 2 on the Monday drive home is due on the Thursday morning commute', () => {
    const mon = at(2026, 10, 26, 17, 45);
    const box1: SrCard = { box: 1, dueAt: mon - 1, lastSeenAt: mon - 86_400_000, lapses: 0, reviews: 3 };
    const c = reviewCard(box1, true, mon);
    expect(c.box).toBe(2);
    expect(c.dueAt).toBe(at(2026, 10, 29, 4));
    const thuCommute = at(2026, 10, 29, 7, 30);
    expect(isDue(c, thuCommute)).toBe(true);
    expect(isGapReview(c, thuCommute)).toBe(true);
    expect(srWeight(c, thuCommute)).toBeGreaterThan(SR_NOT_DUE_FLOOR);
    // ...and still not on Wednesday evening.
    expect(isDue(c, at(2026, 10, 28, 20))).toBe(false);
  });

  it('box 0 is still due at once', () => {
    const t = at(2026, 10, 26, 17, 45);
    expect(scheduleDueAt(t, 0)).toBe(t);
    expect(reviewCard(undefined, false, t).dueAt).toBe(t);
  });

  it('an answer at 1am belongs to the evening before', () => {
    expect(scheduleDueAt(at(2026, 10, 27, 1), 1)).toBe(at(2026, 10, 27, 4));
    expect(scheduleDueAt(at(2026, 10, 27, 5), 1)).toBe(at(2026, 10, 28, 4));
  });

  it('the end of daylight saving (1 Nov 2026) does not move the due hour', () => {
    expect(scheduleDueAt(at(2026, 10, 29, 18), 3)).toBe(at(2026, 11, 5, 4));
    expect(new Date(scheduleDueAt(at(2026, 10, 29, 18), 3)).getHours()).toBe(4);
  });

  it('says "tomorrow" for a card answered on the evening drive', () => {
    const t = at(2026, 10, 26, 17, 45);
    const c = reviewCard({ box: 0, dueAt: t, lastSeenAt: t, lapses: 0, reviews: 1 }, true, t);
    expect(c.box).toBe(1);
    expect(formatReviewPlain(c, t)).toBe("You'll see this again tomorrow");
    const c2 = reviewCard({ box: 1, dueAt: t, lastSeenAt: t, lapses: 0, reviews: 2 }, true, t);
    expect(formatReviewPlain(c2, t)).toBe("You'll see this again in 3 days");
  });
});
