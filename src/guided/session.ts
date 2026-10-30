import { segmentDef, type GuidedPreset, type PlannedSegment, type SegmentId } from './plan';
import type { Tally } from './tally';

/**
 * Wave L (lane v): the guided session as data, and every rule that moves it
 * on. Pure: the clock is passed in, so the advancement rules are unit-tested
 * without a drill in sight (session.test.ts).
 */

export interface SegmentProgress {
  answers: number;
  right: number;
  /** Time spent in the segment while it was running (not paused, not in a transition). */
  activeMs: number;
  skipped?: true;
  /** Finished (target, cap or skip). */
  done?: true;
  /**
   * Where the cap and idle clocks start: `activeMs` and `answers` as they
   * stood at the last resume (absent = the segment's start). A resume is a
   * fresh window -- judged from the segment's start, a segment that idled
   * past its cap was past it again the moment it came back, and paused itself
   * on the next tick, every time.
   */
  windowMs?: number;
  windowAnswers?: number;
}

/**
 * 'intro': the transition before segment `index` (spoken in Drive);
 * 'running': its drill is up; 'paused'; 'done': the summary.
 */
export type GuidedPhase = 'intro' | 'running' | 'paused' | 'done';

export interface GuidedSession {
  version: 1;
  /** Epoch ms the session started; also its id. */
  startedAt: number;
  /** Local day key ('YYYY-MM-DD') it started on: resumable only that day. */
  day: string;
  preset: GuidedPreset;
  /** Eyes-free + voice (Drive) rather than tapped. */
  drive: boolean;
  plan: PlannedSegment[];
  index: number;
  progress: SegmentProgress[];
  phase: GuidedPhase;
  /** 'completed' ran to the end of the plan; 'ended' was stopped early. */
  outcome?: 'completed' | 'ended';
}

export function newSession(preset: GuidedPreset, drive: boolean, plan: PlannedSegment[], now: number, day: string): GuidedSession {
  return {
    version: 1,
    startedAt: now,
    day,
    preset,
    drive,
    plan,
    index: 0,
    progress: plan.map(() => ({ answers: 0, right: 0, activeMs: 0 })),
    phase: 'intro',
  };
}

export function current(s: GuidedSession): PlannedSegment | null {
  return s.plan[s.index] ?? null;
}

/** Answer segments end at 2.5x their planned minutes even short of the target. */
export const ANSWER_CAP_FACTOR = 2.5;
/** A time segment waits this long past its time for the answer that ends it. */
export const TIME_GRACE_MS = 60_000;

export function capMs(seg: PlannedSegment): number {
  return seg.target.kind === 'time' ? seg.target.ms + TIME_GRACE_MS : seg.minutes * 60_000 * ANSWER_CAP_FACTOR;
}

/**
 * After an answer lands: does it end the segment? An answer target ends on
 * reaching it; a time target on the first answer once the time is up -- never
 * mid-run, since a count run is ONE answer that arrives when it ends.
 */
export function endsOnAnswer(seg: PlannedSegment, prog: SegmentProgress, activeMs: number): boolean {
  if (seg.target.kind === 'answers') return prog.answers >= seg.target.n;
  return prog.answers > 0 && activeMs >= seg.target.ms;
}

/**
 * On the clock, within the window since the last resume (or the segment's
 * start): 'end' past the cap with something answered in it; 'idle' past the
 * cap with nothing answered in it (nobody is there: pause rather than talk to
 * an empty car); else 'continue'.
 */
export function verdictOnTick(seg: PlannedSegment, prog: SegmentProgress, activeMs: number): 'continue' | 'end' | 'idle' {
  if (activeMs - (prog.windowMs ?? 0) < capMs(seg)) return 'continue';
  return prog.answers - (prog.windowAnswers ?? 0) > 0 ? 'end' : 'idle';
}

/** Credit a save's answers to the running segment. */
export function addTally(s: GuidedSession, t: Tally): GuidedSession {
  if (s.phase !== 'running' && s.phase !== 'intro') return s;
  const progress = s.progress.map((p, i) =>
    i === s.index ? { ...p, answers: Math.max(0, p.answers + t.answers), right: Math.max(0, Math.min(p.answers + t.answers, p.right + t.right)) } : p,
  );
  return { ...s, progress };
}

export function withActiveMs(s: GuidedSession, activeMs: number): GuidedSession {
  const progress = s.progress.map((p, i) => (i === s.index ? { ...p, activeMs } : p));
  return { ...s, progress };
}

/** Close the current segment and move to the next one's transition, or to the summary. */
export function finishSegment(s: GuidedSession, skipped = false): GuidedSession {
  if (s.phase === 'done') return s;
  const progress = s.progress.map((p, i) => (i === s.index ? { ...p, done: true as const, ...(skipped ? { skipped: true as const } : {}) } : p));
  const index = s.index + 1;
  if (index >= s.plan.length) return { ...s, progress, index: s.plan.length - 1, phase: 'done', outcome: 'completed' };
  return { ...s, progress, index, phase: 'intro' };
}

export function pause(s: GuidedSession): GuidedSession {
  return s.phase === 'running' || s.phase === 'intro' ? { ...s, phase: 'paused' } : s;
}

/**
 * Back from a pause into the segment's transition (it is said again in Drive),
 * with fresh cap and idle clocks for the segment.
 */
export function resume(s: GuidedSession): GuidedSession {
  if (s.phase !== 'paused') return s;
  const progress = s.progress.map((p, i) => (i === s.index ? { ...p, windowMs: p.activeMs, windowAnswers: p.answers } : p));
  return { ...s, progress, phase: 'intro' };
}

export function begin(s: GuidedSession): GuidedSession {
  return s.phase === 'intro' ? { ...s, phase: 'running' } : s;
}

export function endEarly(s: GuidedSession): GuidedSession {
  if (s.phase === 'done') return s;
  return { ...s, phase: 'done', outcome: 'ended' };
}

/** Resumable: unfinished, and started on `today` (local day key). */
export function isResumable(s: GuidedSession | null, today: string): s is GuidedSession {
  return s !== null && s.phase !== 'done' && s.day === today && s.index < s.plan.length;
}

/**
 * Counts toward the guided achievements: ran to the end of its plan with
 * answers in at least half of its segments (skipping everything earns nothing).
 */
export function countsAsCompleted(s: GuidedSession): boolean {
  if (s.outcome !== 'completed') return false;
  const answered = s.progress.filter((p) => p.answers > 0).length;
  return answered >= Math.ceil(s.plan.length / 2);
}

/* ------------------------------------------------------------- summary -- */

/** One finished session's per-segment tallies, kept to compare the next one against. */
export interface GuidedRecord {
  at: number;
  preset: GuidedPreset;
  drive: boolean;
  rows: { id: SegmentId; answers: number; right: number }[];
}

export interface SummaryRow {
  id: SegmentId;
  label: string;
  answers: number;
  right: number;
  /** 0..100, null with no answers. */
  pct: number | null;
  /** Points against the last session that ran this segment, null when either side is too thin. */
  delta: number | null;
  skipped: boolean;
}

export interface GuidedSummary {
  rows: SummaryRow[];
  answers: number;
  right: number;
  pct: number | null;
  best: SegmentId | null;
  improved: SegmentId | null;
}

/** A segment's accuracy is judged (best, improved) on at least this many answers. */
export const SUMMARY_MIN_ANSWERS = 3;
/** "Most improved" needs at least this many points. */
export const IMPROVED_MIN_POINTS = 5;

function pctOf(right: number, answers: number): number | null {
  return answers > 0 ? (100 * right) / answers : null;
}

export function toRecord(s: GuidedSession): GuidedRecord {
  return {
    at: s.startedAt,
    preset: s.preset,
    drive: s.drive,
    rows: s.plan.map((seg, i) => ({ id: seg.id, answers: s.progress[i]!.answers, right: s.progress[i]!.right })),
  };
}

/**
 * The summary, against `history` (newest first): each segment compares with
 * the most recent earlier session that answered it enough to judge.
 */
export function summarize(s: GuidedSession, history: readonly GuidedRecord[]): GuidedSummary {
  let answers = 0;
  let right = 0;
  const rows: SummaryRow[] = s.plan.map((seg, i) => {
    const p = s.progress[i]!;
    answers += p.answers;
    right += p.right;
    const pct = pctOf(p.right, p.answers);
    let delta: number | null = null;
    if (pct !== null && p.answers >= SUMMARY_MIN_ANSWERS) {
      for (const rec of history) {
        if (rec.at >= s.startedAt) continue;
        const r = rec.rows.find((x) => x.id === seg.id);
        if (r && r.answers >= SUMMARY_MIN_ANSWERS) {
          delta = Math.round(pct - (100 * r.right) / r.answers);
          break;
        }
      }
    }
    return { id: seg.id, label: segmentDef(seg.id).label, answers: p.answers, right: p.right, pct, delta, skipped: p.skipped === true };
  });
  const judged = rows.filter((r) => r.pct !== null && r.answers >= SUMMARY_MIN_ANSWERS);
  let best: SegmentId | null = null;
  let bestPct = -1;
  for (const r of judged) {
    if (r.pct! > bestPct) {
      best = r.id;
      bestPct = r.pct!;
    }
  }
  let improved: SegmentId | null = null;
  let bestDelta = IMPROVED_MIN_POINTS - 1;
  for (const r of judged) {
    if (r.delta !== null && r.delta > bestDelta) {
      improved = r.id;
      bestDelta = r.delta;
    }
  }
  return { rows, answers, right, pct: pctOf(right, answers), best, improved };
}
