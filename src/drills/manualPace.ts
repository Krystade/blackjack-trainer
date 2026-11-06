import { IDLE_CAP_MS } from './idleCap';

/**
 * Owner 2026-11-06: the numbers a manual (self-paced) count run reports, from
 * the gaps between taps. Gap i is the time card i+1 was up.
 *
 * Gaps over the idle cap (a phone call, a pocketed phone) are left out of the
 * averages, as `meanTapGapMs` leaves them out -- but the longest pause is the
 * raw longest, because finding it is the point.
 */
export interface ManualPace {
  meanMs: number;
  medianMs: number;
  /** The pace of your slowest tenth of cards: the 90th-percentile gap. */
  p90Ms: number;
  /** How much the pace varies: the standard deviation of the gaps. */
  sdMs: number;
  maxMs: number;
  /** 1-based: the card the longest pause was on. */
  maxAtCard: number;
  firstHalfMs: number;
  secondHalfMs: number;
  secondsPerDeck: number;
}

const avg = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function manualPace(gaps: readonly number[], capMs: number = IDLE_CAP_MS): ManualPace | undefined {
  const kept = gaps.filter((g) => g <= capMs);
  if (kept.length === 0) return undefined;
  const sorted = [...kept].sort((a, b) => a - b);
  const mean = avg(kept);
  const sd = Math.sqrt(avg(kept.map((g) => (g - mean) ** 2)));
  let maxAt = 0;
  for (let i = 1; i < gaps.length; i++) if (gaps[i]! > gaps[maxAt]!) maxAt = i;
  const half = Math.floor(gaps.length / 2);
  const firstHalf = gaps.slice(0, half).filter((g) => g <= capMs);
  const secondHalf = gaps.slice(half).filter((g) => g <= capMs);
  const r = Math.round;
  return {
    meanMs: r(mean),
    medianMs: r(quantile(sorted, 0.5)),
    p90Ms: r(quantile(sorted, 0.9)),
    sdMs: r(sd),
    maxMs: r(gaps[maxAt]!),
    maxAtCard: maxAt + 1,
    firstHalfMs: r(avg(firstHalf.length > 0 ? firstHalf : kept)),
    secondHalfMs: r(avg(secondHalf.length > 0 ? secondHalf : kept)),
    secondsPerDeck: Math.round((mean * 52) / 100) / 10,
  };
}

/** The metrics compared with a personal best; lower is better for every one. */
export const PACE_BEST_KEYS = ['meanMs', 'secondsPerDeck', 'maxMs', 'p90Ms', 'sdMs'] as const;
export type PaceBestKey = (typeof PACE_BEST_KEYS)[number];

/**
 * Your best (lowest) of each metric over earlier correct manual runs of the
 * same length. A metric no earlier run measured is absent.
 */
export function paceBests(
  history: readonly { cards: number; correct: boolean; manual?: boolean; pace?: ManualPace; selfReport?: true }[],
  cards: number,
): Partial<Record<PaceBestKey, number>> {
  const out: Partial<Record<PaceBestKey, number>> = {};
  for (const row of history) {
    if (!row.manual || !row.correct || row.selfReport || row.cards !== cards || !row.pace) continue;
    for (const k of PACE_BEST_KEYS) {
      const v = row.pace[k];
      if (typeof v === 'number' && (out[k] === undefined || v < out[k]!)) out[k] = v;
    }
  }
  return out;
}

/** "0:12.3" -- the on-screen run clock. */
export function formatClock(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${tenths % 10}`;
}
