import { describe, it, expect } from 'vitest';
import {
  GAP_BANDS,
  formatInterval,
  hasCurve,
  retentionByGap,
  wilson,
  type RetentionRow,
} from './retentionCurve';

const DAY = 24 * 60 * 60 * 1000;

function row(gapDays: number, correct: boolean): RetentionRow {
  return { date: '2026-01-01T00:00:00.000Z', key: 'k', box: 3, gapMs: gapDays * DAY, correct };
}

describe('wilson: how far off a reading could be', () => {
  it('has no opinion with no reviews', () => {
    const p = wilson(0, 0);
    expect(p.rate).toBeNull();
    expect(p.low).toBeNull();
    expect(p.high).toBeNull();
  });

  it('brackets the point estimate', () => {
    const p = wilson(7, 10);
    expect(p.rate).toBe(0.7);
    expect(p.low!).toBeLessThan(0.7);
    expect(p.high!).toBeGreaterThan(0.7);
  });

  /**
   * The whole reason this exists. A first reading off a handful of reviews has
   * to LOOK uncertain, or it gets read as a result.
   */
  it('is far wider on three reviews than on three hundred at the same rate', () => {
    const few = wilson(2, 3);
    const many = wilson(200, 300);
    expect(few.rate).toBeCloseTo(many.rate!, 10);
    expect(few.high! - few.low!).toBeGreaterThan(3 * (many.high! - many.low!));
  });

  it('keeps real width at a perfect score, and stays inside 0..1', () => {
    const perfect = wilson(3, 3);
    expect(perfect.high).toBe(1);
    // The normal interval would collapse to zero width here and claim 100%.
    expect(perfect.low!).toBeLessThan(0.5);
    expect(perfect.low!).toBeGreaterThan(0);

    const none = wilson(0, 3);
    expect(none.low).toBe(0);
    expect(none.high!).toBeLessThan(1);
    expect(none.high!).toBeGreaterThan(0);
  });

  it('narrows monotonically as reviews accumulate', () => {
    const widths = [4, 20, 100, 500].map((n) => {
      const p = wilson(Math.round(n * 0.8), n);
      return p.high! - p.low!;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]!).toBeLessThan(widths[i - 1]!);
  });

  /** Against the textbook worked example: 95% Wilson for 0.5 at n=10. */
  it('matches the published interval for a known case', () => {
    const p = wilson(5, 10);
    expect(p.low!).toBeCloseTo(0.2366, 3);
    expect(p.high!).toBeCloseTo(0.7634, 3);
  });
});

describe('retentionByGap: the curve the pooled number hid', () => {
  it('returns every band in schedule order, empty ones included', () => {
    const bands = retentionByGap([]);
    expect(bands.map((b) => b.label)).toEqual(GAP_BANDS.map((b) => b.label));
    expect(bands.every((b) => b.reviews === 0 && b.rate === null)).toBe(true);
  });

  it('files each gap in the band its length belongs to', () => {
    const bands = retentionByGap([
      row(1, true),
      row(4, true),
      row(10, true),
      row(20, true),
      row(60, true),
    ]);
    expect(bands.map((b) => b.reviews)).toEqual([1, 1, 1, 1, 1]);
  });

  /** maxDays is exclusive, so a review exactly on a boundary goes UP. */
  it('puts a gap exactly on a boundary in the longer band', () => {
    const bands = retentionByGap([row(3, true), row(7, true), row(14, true), row(30, true)]);
    expect(bands.map((b) => b.reviews)).toEqual([0, 1, 1, 1, 1]);
  });

  /**
   * The finding this whole change exists to make visible: the same rows that
   * pool to a healthy-looking figure can be a deck that falls apart at a month.
   */
  it('separates a rate that decays with the gap', () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row(4, true)),
      ...Array.from({ length: 10 }, () => row(60, false)),
    ];
    const bands = retentionByGap(rows);
    const short = bands.find((b) => b.label === '3-7 days')!;
    const long = bands.find((b) => b.label === 'over a month')!;
    expect(short.rate).toBe(1);
    expect(long.rate).toBe(0);
    // Pooled, this deck reads 50% and looks merely mediocre rather than gone.
    const pooled = wilson(10, 20);
    expect(pooled.rate).toBe(0.5);
  });

  it('counts correct separately from reviews within a band', () => {
    const bands = retentionByGap([row(4, true), row(4, false), row(4, true)]);
    const band = bands.find((b) => b.label === '3-7 days')!;
    expect(band.reviews).toBe(3);
    expect(band.correct).toBe(2);
    expect(band.rate).toBeCloseTo(2 / 3, 10);
  });

  /** A clock change can hand us a negative gap. It is still a real review. */
  it('keeps a negative gap at the short end rather than dropping the row', () => {
    const bands = retentionByGap([row(-5, false)]);
    expect(bands.reduce((n, b) => n + b.reviews, 0)).toBe(1);
    expect(bands[0]!.reviews).toBe(1);
  });

  /**
   * The one input the band search cannot place. Without the fallback this
   * indexes at -1 and throws, taking the whole Stats screen down over a single
   * bad row -- the exact shape of failure retention.ts's header warns about.
   */
  it('does not throw on a non-finite gap, and keeps the row', () => {
    const rows = [{ ...row(1, true), gapMs: Infinity }];
    const bands = retentionByGap(rows);
    expect(bands.reduce((n, b) => n + b.reviews, 0)).toBe(1);
    expect(bands[bands.length - 1]!.reviews).toBe(1);
  });
});

describe('hasCurve', () => {
  it('is false when everything sits at one gap length', () => {
    expect(hasCurve(retentionByGap([row(4, true), row(5, false), row(6, true)]))).toBe(false);
  });

  it('is false with nothing at all', () => {
    expect(hasCurve(retentionByGap([]))).toBe(false);
  });

  it('is true once a second band has data', () => {
    expect(hasCurve(retentionByGap([row(4, true), row(20, false)]))).toBe(true);
  });
});

describe('formatInterval', () => {
  it('prints the range', () => {
    expect(formatInterval(wilson(5, 10))).toBe('24%-76%');
  });

  it('prints a dash rather than a fake range with no data', () => {
    expect(formatInterval(wilson(0, 0))).toBe('—');
  });
});
