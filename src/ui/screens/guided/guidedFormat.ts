import type { PlannedSegment } from '../../../guided/plan';
import type { SegmentProgress } from '../../../guided/session';

/** m:ss, never negative. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** "10 answers", "4 of 10 answers", "3 min", "1:42 left". */
export function segmentProgressText(seg: PlannedSegment, prog: SegmentProgress, activeMs: number): string {
  if (seg.target.kind === 'answers') {
    const n = seg.target.n;
    return prog.answers > 0 ? `${prog.answers} of ${n} answers` : `${n} answers`;
  }
  if (activeMs <= 0) return `${seg.minutes} min`;
  return `${formatClock(Math.max(0, seg.target.ms - activeMs))} left`;
}

/** "83%" or an em dash with nothing answered. */
export function pctText(pct: number | null): string {
  return pct === null ? '—' : `${Math.floor(pct)}%`;
}

/** "+12", "−4", "±0"; null for no comparison. */
export function deltaText(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta === 0) return '±0';
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}
