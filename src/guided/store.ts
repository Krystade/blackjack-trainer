import { getStorage } from '../store/persist';
import { SEGMENTS, PRESETS, type GuidedPreset, type PlannedSegment, type SegmentId } from './plan';
import { countsAsCompleted, toRecord, type GuidedRecord, type GuidedSession } from './session';

/**
 * Wave L (lane v): the guided session's own store -- the session in progress
 * (so an interrupted one can be resumed the same day) and the finished ones
 * (to say what improved, and for the two guided achievements). Its own key,
 * so nothing in the stats or settings blobs changes shape.
 */

export const GUIDED_KEY = 'bjtrainer.guided.v1';
/** Finished sessions kept, newest first. */
export const HISTORY_KEPT = 30;

export interface GuidedStore {
  version: 1;
  active: GuidedSession | null;
  history: GuidedRecord[];
  /** Sessions that count as completed (session.ts countsAsCompleted), ever. */
  completed: number;
}

export function emptyGuidedStore(): GuidedStore {
  return { version: 1, active: null, history: [], completed: 0 };
}

const SEGMENT_IDS: ReadonlySet<string> = new Set(SEGMENTS.map((s) => s.id));

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

function readSegment(raw: unknown): PlannedSegment | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<PlannedSegment>;
  if (typeof r.id !== 'string' || !SEGMENT_IDS.has(r.id)) return null;
  const t = r.target as { kind?: unknown; n?: unknown; ms?: unknown } | undefined;
  const target =
    t?.kind === 'answers' && num(t.n) > 0
      ? { kind: 'answers' as const, n: num(t.n) }
      : t?.kind === 'time' && num(t.ms) > 0
        ? { kind: 'time' as const, ms: num(t.ms) }
        : null;
  if (!target) return null;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);
  const cells = strings(r.cells);
  const indexes = strings(r.indexes);
  return {
    id: r.id as SegmentId,
    minutes: Math.max(1, num(r.minutes)),
    target,
    weak: r.weak === true,
    ...(cells ? { cells } : {}),
    ...(indexes ? { indexes } : {}),
  };
}

/** Defensive parse of a stored session: anything malformed is no session at all. */
export function readSession(raw: unknown): GuidedSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<GuidedSession>;
  if (s.version !== 1 || !Array.isArray(s.plan) || !Array.isArray(s.progress)) return null;
  const plan = s.plan.map(readSegment);
  if (plan.length === 0 || plan.some((p) => p === null) || s.progress.length !== plan.length) return null;
  if (typeof s.day !== 'string' || !PRESETS.includes(s.preset as GuidedPreset)) return null;
  const phase = s.phase === 'intro' || s.phase === 'running' || s.phase === 'paused' || s.phase === 'done' ? s.phase : null;
  if (!phase) return null;
  const index = Math.min(plan.length - 1, Math.floor(num(s.index)));
  return {
    version: 1,
    startedAt: num(s.startedAt),
    day: s.day,
    preset: s.preset as GuidedPreset,
    drive: s.drive === true,
    plan: plan as PlannedSegment[],
    index,
    progress: s.progress.map((p) => {
      const q = (p ?? {}) as Partial<GuidedSession['progress'][number]>;
      const answers = num(q.answers);
      return {
        answers,
        right: Math.min(answers, num(q.right)),
        activeMs: num(q.activeMs),
        ...(q.skipped === true ? { skipped: true as const } : {}),
        ...(q.done === true ? { done: true as const } : {}),
        ...(typeof q.windowMs === 'number' ? { windowMs: num(q.windowMs) } : {}),
        ...(typeof q.windowAnswers === 'number' ? { windowAnswers: num(q.windowAnswers) } : {}),
      };
    }),
    phase,
    ...(s.outcome === 'completed' || s.outcome === 'ended' ? { outcome: s.outcome } : {}),
  };
}

function readRecord(raw: unknown): GuidedRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<GuidedRecord>;
  if (!Array.isArray(r.rows) || !PRESETS.includes(r.preset as GuidedPreset)) return null;
  return {
    at: num(r.at),
    preset: r.preset as GuidedPreset,
    drive: r.drive === true,
    rows: r.rows
      .filter((x) => x && typeof x === 'object' && SEGMENT_IDS.has((x as { id?: string }).id ?? ''))
      .map((x) => ({ id: x.id, answers: num(x.answers), right: Math.min(num(x.answers), num(x.right)) })),
  };
}

export function normalizeGuidedStore(raw: unknown): GuidedStore {
  const base = emptyGuidedStore();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<GuidedStore>;
  if (r.version !== 1) return base;
  return {
    version: 1,
    active: readSession(r.active),
    history: Array.isArray(r.history) ? r.history.map(readRecord).filter((x): x is GuidedRecord => x !== null).slice(0, HISTORY_KEPT) : [],
    completed: Math.floor(num(r.completed)),
  };
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return getStorage();
  } catch {
    return null;
  }
}

export function loadGuided(): GuidedStore {
  const raw = storage()?.getItem(GUIDED_KEY);
  if (!raw) return emptyGuidedStore();
  try {
    return normalizeGuidedStore(JSON.parse(raw));
  } catch {
    return emptyGuidedStore();
  }
}

function save(store: GuidedStore): void {
  try {
    storage()?.setItem(GUIDED_KEY, JSON.stringify(store));
  } catch {
    /* full storage: a lost resume point costs one tap */
  }
}

/** Write the session in progress (read-modify-write, so history is kept). */
export function saveActive(session: GuidedSession | null): void {
  save({ ...loadGuided(), active: session });
}

/**
 * A finished session: off the resume slot, onto the history, and counted when
 * it ran its plan. Returns the store as written. Idempotent per session: a
 * second call for the same start time does not record it twice.
 */
export function recordFinished(session: GuidedSession): GuidedStore {
  const prev = loadGuided();
  if (prev.history.some((h) => h.at === session.startedAt)) {
    const next = { ...prev, active: null };
    save(next);
    return next;
  }
  const answered = session.progress.some((p) => p.answers > 0);
  const next: GuidedStore = {
    version: 1,
    active: null,
    history: answered ? [toRecord(session), ...prev.history].slice(0, HISTORY_KEPT) : prev.history,
    completed: prev.completed + (countsAsCompleted(session) ? 1 : 0),
  };
  save(next);
  return next;
}

/** Completed guided sessions, for the achievements. */
export function guidedCompletedCount(): number {
  return loadGuided().completed;
}
