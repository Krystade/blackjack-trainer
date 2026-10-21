import type { Stats } from '../store/types';
import { localDayKey, dayKeyOfIso } from '../store/practiceDays';

/**
 * Wave N: habit formation -- the daily goal, the streak, freezes and the week.
 *
 * Pure: every function takes `now` (or a day key) from the caller. The store
 * (progressStore.ts) owns persistence and the clock.
 *
 * A DAY is the local calendar day (device time zone), keyed 'YYYY-MM-DD' by
 * practiceDays.localDayKey. Days are stepped by calendar date, never by 24h,
 * so a DST day of 23 or 25 hours is still exactly one day.
 */

export type GoalLevel = 'easy' | 'normal' | 'hard';

export interface DailyGoal {
  minutes: number;
  answers: number;
}

/** The ruled goals: easy 5 min / 30 answers, normal 10 / 60, hard 20 / 120. */
export const GOALS: Record<GoalLevel, DailyGoal> = {
  easy: { minutes: 5, answers: 30 },
  normal: { minutes: 10, answers: 60 },
  hard: { minutes: 20, answers: 120 },
};

export function goalFor(level: unknown): DailyGoal {
  return level === 'easy' || level === 'hard' ? GOALS[level] : GOALS.normal;
}

/**
 * A gap between two answers longer than this stops the clock: the time is not
 * credited. Answers flowing at a drill's pace (seconds apart) all count.
 */
export const IDLE_CAP_MS = 60_000;

/**
 * A Drive session (for the freeway achievement) ends after this long with no
 * eyes-free answer. Longer than IDLE_CAP_MS on purpose: active minutes stop
 * at a minute's silence, but a 90-second correction or a junction is still
 * the same drive.
 */
export const DRIVE_SESSION_GAP_MS = 3 * 60_000;

/** Wave O: the freeway drive needs this much wall time in one session... */
export const FREEWAY_WALL_MS = 15 * 60_000;
/** ...and this many active (idle-capped) minutes inside it. */
export const FREEWAY_ACTIVE_MS = 10 * 60_000;

/**
 * One number for "how far to a freeway drive": reaches FREEWAY_WALL_MS exactly
 * when the session has both the wall time and the active minutes. The active
 * time is scaled to the wall target so either shortfall holds it back.
 */
export function freewayScoreMs(runMs: number, runActiveMs: number): number {
  return Math.min(runMs, Math.floor((runActiveMs * FREEWAY_WALL_MS) / FREEWAY_ACTIVE_MS));
}

/** Freezes: one earned per 7 met days of streak, at most two held. */
export const FREEZE_EVERY = 7;
export const FREEZE_MAX = 2;

/** Weekly goal: days met in the calendar week (Monday first). */
export const WEEK_TARGET = 5;

/** Days kept in the store (~70 bytes each); the heatmap reads 84, streaks and totals read all. */
export const DAYS_KEPT = 2000;

export interface DayRecord {
  answers: number;
  activeMs: number;
  /** Active time credited while eyes-free (Drive) was on. */
  driveMs?: number;
  /** Set once, when the goal in force that day was met. */
  met?: true;
}

export interface ProgressState {
  version: 1;
  days: Record<string, DayRecord>;
  /** Epoch ms of the last credited answer. */
  lastAnswerAt?: number;
  /** Answer counts per stats section at the last save (see statsSignature). */
  sig?: Record<string, number>;
  /** Lifetime answers seen (backfill + every save since). */
  answersTotal: number;
  /** Drive: total ms, the current contiguous run, and the longest run. */
  /**
   * Drive: total active ms, and the current and longest DRIVE SESSION in wall
   * time (see recordActivity). `runStartAt` / `lastAt` are epoch ms of the
   * session's start and of its last answer; absent when no session is open.
   */
  drive: {
    totalMs: number;
    runMs: number;
    bestRunMs: number;
    runStartAt?: number;
    lastAt?: number;
    /** Wave O: active (idle-capped) ms credited inside the current session. */
    runActiveMs?: number;
    /** Wave O: best freeway score over sessions, see freewayScoreMs. */
    bestFreewayMs?: number;
  };
  /** Achievement id -> ISO date earned, or '' when earned from history undated. */
  earned: Record<string, string>;
  /** First-run backfill from history has been done. */
  backfilled?: true;
}

export function emptyProgress(): ProgressState {
  return { version: 1, days: {}, answersTotal: 0, drive: { totalMs: 0, runMs: 0, bestRunMs: 0 }, earned: {} };
}

/** Defensive parse of a stored blob: anything unreadable becomes empty fields. */
export function normalizeProgress(raw: unknown): ProgressState {
  const base = emptyProgress();
  if (!raw || typeof raw !== 'object') return base;
  const p = raw as Partial<ProgressState>;
  if (p.version !== 1) return base;
  const days: Record<string, DayRecord> = {};
  if (p.days && typeof p.days === 'object') {
    for (const [k, v] of Object.entries(p.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
      const d = v as DayRecord;
      const rec: DayRecord = { answers: num(d.answers), activeMs: num(d.activeMs) };
      if (num(d.driveMs) > 0) rec.driveMs = num(d.driveMs);
      if (d.met === true) rec.met = true;
      days[k] = rec;
    }
  }
  const out: ProgressState = {
    version: 1,
    days,
    answersTotal: num(p.answersTotal),
    drive: {
      totalMs: num(p.drive?.totalMs),
      runMs: num(p.drive?.runMs),
      bestRunMs: num(p.drive?.bestRunMs),
      ...(num(p.drive?.runStartAt) > 0 ? { runStartAt: num(p.drive?.runStartAt) } : {}),
      ...(num(p.drive?.lastAt) > 0 ? { lastAt: num(p.drive?.lastAt) } : {}),
      ...(num(p.drive?.runActiveMs) > 0 ? { runActiveMs: num(p.drive?.runActiveMs) } : {}),
      ...(num(p.drive?.bestFreewayMs) > 0 ? { bestFreewayMs: num(p.drive?.bestFreewayMs) } : {}),
    },
    earned: {},
  };
  if (typeof p.lastAnswerAt === 'number' && Number.isFinite(p.lastAnswerAt)) out.lastAnswerAt = p.lastAnswerAt;
  if (p.sig && typeof p.sig === 'object') {
    out.sig = {};
    for (const [k, v] of Object.entries(p.sig)) out.sig[k] = num(v);
  }
  if (p.earned && typeof p.earned === 'object') {
    for (const [k, v] of Object.entries(p.earned)) if (typeof v === 'string') out.earned[k] = v;
  }
  if (p.backfilled === true) out.backfilled = true;
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/* ---------------------------------------------------------------- days -- */

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return localDayKey(new Date(y, m - 1, d + n));
}

/** Monday of the week `key` falls in. */
export function weekStart(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Mon = 0
  return addDays(key, -dow);
}

/* ------------------------------------------------------- answer signal -- */

/**
 * Sections whose rows are one answer each. Retention, EV cost, distraction and
 * latency rows shadow answers already counted elsewhere, so they are left out.
 */
export const ANSWER_SECTIONS = [
  'countDrill',
  'trueCount',
  'deckEstimation',
  'timedCount',
  'pairCancel',
  'betSitLeave',
  'downswing',
  'produceTc',
  'betSizing',
] as const;

/**
 * How many answers each part of `stats` holds: every graded event (the
 * `mistakes` tally counts each one exactly once by its class) plus each
 * history-only drill's rows. Compared save to save, the rise is the answers
 * that save recorded.
 */
export function statsSignature(stats: Stats): Record<string, number> {
  const sig: Record<string, number> = {};
  let events = 0;
  for (const v of Object.values(stats.mistakes ?? {})) if (typeof v === 'number') events += v;
  sig.events = events;
  const rec = stats as unknown as Record<string, { history?: unknown } | undefined>;
  for (const s of ANSWER_SECTIONS) {
    const h = rec[s]?.history;
    sig[s] = Array.isArray(h) ? h.length : 0;
  }
  return sig;
}

export function signatureTotal(sig: Record<string, number>): number {
  return Object.values(sig).reduce((a, b) => a + b, 0);
}

/**
 * The answers one save added, and how long the newest timed rows say they took
 * (a count-drill run is ONE answer that took a minute; its own row knows how
 * long). A falling section is a cap trimming old rows or a Wrong-tap undo:
 * `undone` reports only the events falling by exactly one, which a Wrong-tap undo does; a
 * reset or restore (a large fall) is a new baseline, not an undo.
 */
export function signatureDelta(
  before: Record<string, number> | undefined,
  after: Record<string, number>,
  next: Stats,
): { added: number; undone: number; durationHintMs: number } {
  if (!before) return { added: 0, undone: 0, durationHintMs: 0 };
  let added = 0;
  let undone = 0;
  let durationHintMs = 0;
  for (const [k, v] of Object.entries(after)) {
    const d = v - (before[k] ?? 0);
    if (d > 0) {
      added += d;
      const rows = (next as unknown as Record<string, { history?: unknown[] } | undefined>)[k]?.history;
      if (Array.isArray(rows)) {
        for (const row of rows.slice(-d)) durationHintMs += rowDurationMs(row);
      }
    } else if (k === 'events' && d === -1) {
      undone += 1;
    }
  }
  return { added, undone, durationHintMs };
}

/** How long a history row says it took, from its own fields; 0 when it does not say. */
export function rowDurationMs(row: unknown): number {
  if (!row || typeof row !== 'object') return 0;
  const r = row as Record<string, unknown>;
  if (typeof r.elapsedMs === 'number' && r.elapsedMs > 0) return r.elapsedMs;
  if (typeof r.cards === 'number' && r.cards > 0) {
    if (typeof r.meanTapMs === 'number' && r.meanTapMs > 0) return r.cards * r.meanTapMs;
    if (r.manual !== true && typeof r.intervalMs === 'number' && r.intervalMs > 0) return r.cards * r.intervalMs;
  }
  return 0;
}

/* --------------------------------------------------------- recording ---- */

export interface Activity {
  /** Answers this save added (>= 1), or answers undone (negative). */
  answers: number;
  /** Eyes-free (Drive) was on. */
  drive: boolean;
  /** A duration the new rows report for themselves (count-drill runs). */
  durationHintMs?: number;
}

export interface RecordResult {
  state: ProgressState;
  /** The goal was crossed by this answer. */
  goalMet: boolean;
}

/**
 * Credit one save's answers to the local day of `nowMs`.
 *
 * Active time is the gap since the previous answer when that gap is at most
 * IDLE_CAP_MS; a longer gap stops the clock (credits nothing), except that a
 * row which reports its own duration (a count run) is credited that duration,
 * never more than the gap itself. The credited time lands on the day of the
 * answer that closes the gap, so a burst straddling midnight credits the new
 * day with the seconds after the old one ended.
 */
export function recordActivity(prev: ProgressState, nowMs: number, act: Activity, goal: DailyGoal): RecordResult {
  const key = localDayKey(new Date(nowMs));
  const day: DayRecord = { ...(prev.days[key] ?? { answers: 0, activeMs: 0 }) };
  const state: ProgressState = { ...prev, days: { ...prev.days, [key]: day }, drive: { ...prev.drive } };

  if (act.answers <= 0) {
    day.answers = Math.max(0, day.answers + act.answers);
    state.answersTotal = Math.max(0, state.answersTotal + act.answers);
    return { state, goalMet: false };
  }

  const gap = prev.lastAnswerAt === undefined ? Infinity : nowMs - prev.lastAnswerAt;
  let credit = 0;
  if (gap > 0 && gap <= IDLE_CAP_MS) credit = gap;
  else if (gap > 0 && (act.durationHintMs ?? 0) > 0) credit = Math.min(act.durationHintMs ?? 0, gap);

  day.answers += act.answers;
  day.activeMs += credit;
  state.answersTotal += act.answers;
  state.lastAnswerAt = nowMs;

  if (act.drive) {
    day.driveMs = (day.driveMs ?? 0) + credit;
    state.drive.totalMs += credit;
    // A DRIVE SESSION is wall time with eyes-free answers flowing. The idle
    // gap is measured from the last answer to the START of this one -- a
    // count run's own duration is not idle -- and a session survives gaps up
    // to DRIVE_SESSION_GAP_MS (a long correction, a junction), longer than
    // the active-time cap, so one stretch of driving is one session.
    const hint = Math.max(0, act.durationHintMs ?? 0);
    const startedAt = nowMs - hint;
    const idle = prev.drive.lastAt === undefined ? Infinity : startedAt - prev.drive.lastAt;
    if (prev.drive.runStartAt !== undefined && idle <= DRIVE_SESSION_GAP_MS) {
      state.drive.runMs = nowMs - prev.drive.runStartAt;
      state.drive.runActiveMs = (prev.drive.runActiveMs ?? 0) + credit;
    } else {
      state.drive.runStartAt = startedAt;
      state.drive.runMs = hint;
      state.drive.runActiveMs = credit;
    }
    state.drive.lastAt = nowMs;
    state.drive.bestRunMs = Math.max(state.drive.bestRunMs, state.drive.runMs);
    state.drive.bestFreewayMs = Math.max(
      state.drive.bestFreewayMs ?? 0,
      freewayScoreMs(state.drive.runMs, state.drive.runActiveMs),
    );
  } else {
    state.drive = {
      totalMs: state.drive.totalMs,
      runMs: 0,
      bestRunMs: state.drive.bestRunMs,
      ...(state.drive.bestFreewayMs ? { bestFreewayMs: state.drive.bestFreewayMs } : {}),
    };
  }

  let goalMet = false;
  if (!day.met && meetsGoal(day, goal)) {
    day.met = true;
    goalMet = true;
  }
  state.days = pruneDays(state.days);
  return { state, goalMet };
}

export function meetsGoal(day: Pick<DayRecord, 'answers' | 'activeMs'>, goal: DailyGoal): boolean {
  return day.activeMs >= goal.minutes * 60_000 || day.answers >= goal.answers;
}

/** 0..1: the larger of the two routes to the goal. */
export function goalFraction(day: Pick<DayRecord, 'answers' | 'activeMs'> | undefined, goal: DailyGoal): number {
  if (!day) return 0;
  return Math.min(1, Math.max(day.activeMs / (goal.minutes * 60_000), day.answers / goal.answers));
}

function pruneDays(days: Record<string, DayRecord>): Record<string, DayRecord> {
  const keys = Object.keys(days);
  if (keys.length <= DAYS_KEPT) return days;
  const keep = keys.sort().slice(-DAYS_KEPT);
  const out: Record<string, DayRecord> = {};
  for (const k of keep) out[k] = days[k];
  return out;
}

/* ------------------------------------------------------------ streak ---- */

export interface StreakInfo {
  current: number;
  longest: number;
  freezes: number;
  /** Missed days a freeze covered. */
  frozen: Set<string>;
  todayMet: boolean;
  /** Most freezes ever held at once (for an achievement). */
  maxFreezesHeld: number;
  /** Day key on which each streak length (1..longest) was first reached. */
  reachedOn: string[];
}

/**
 * Walk every calendar day from the first met day to today.
 *
 * A met day extends the streak, and every FREEZE_EVERY-th met day of a streak
 * earns a freeze (none past FREEZE_MAX). A missed day before today spends one
 * freeze if any is held -- the streak is kept but not lengthened -- and
 * otherwise ends the streak. Today unmet is still open: it breaks nothing.
 */
export function computeStreak(days: Record<string, DayRecord>, today: string): StreakInfo {
  const metKeys = Object.keys(days).filter((k) => days[k].met).sort();
  const info: StreakInfo = {
    current: 0,
    longest: 0,
    freezes: 0,
    frozen: new Set(),
    todayMet: days[today]?.met === true,
    maxFreezesHeld: 0,
    reachedOn: [],
  };
  if (metKeys.length === 0 || metKeys[0] > today) return info;
  let streak = 0;
  for (let k = metKeys[0]; k <= today; k = addDays(k, 1)) {
    if (days[k]?.met) {
      streak += 1;
      if (streak > info.longest) {
        info.longest = streak;
        info.reachedOn.push(k);
      }
      if (streak % FREEZE_EVERY === 0 && info.freezes < FREEZE_MAX) {
        info.freezes += 1;
        info.maxFreezesHeld = Math.max(info.maxFreezesHeld, info.freezes);
      }
    } else if (k !== today) {
      if (streak > 0 && info.freezes > 0) {
        info.freezes -= 1;
        info.frozen.add(k);
      } else {
        streak = 0;
        info.freezes = 0;
      }
    }
  }
  info.current = streak;
  return info;
}

/* -------------------------------------------------------------- week ---- */

/** `before` is a day before anything was ever recorded: not a miss. */
export type DotState = 'met' | 'frozen' | 'missed' | 'today' | 'future' | 'before';

export interface WeekView {
  dots: { key: string; state: DotState }[];
  met: number;
  target: number;
}

export function weekView(days: Record<string, DayRecord>, today: string, frozen: Set<string>): WeekView {
  const start = weekStart(today);
  const recorded = Object.keys(days).sort();
  const first = recorded.length > 0 ? recorded[0] : today;
  const dots: WeekView['dots'] = [];
  let met = 0;
  for (let i = 0; i < 7; i++) {
    const key = addDays(start, i);
    let state: DotState;
    if (days[key]?.met) {
      state = 'met';
      met += 1;
    } else if (frozen.has(key)) state = 'frozen';
    else if (key === today) state = 'today';
    else if (key > today) state = 'future';
    else if (key < first) state = 'before';
    else state = 'missed';
    dots.push({ key, state });
  }
  return { dots, met, target: WEEK_TARGET };
}

/** Weeks (Monday-first) in which `n` or more days were met, over the whole record. */
export function weeksWithAtLeast(days: Record<string, DayRecord>, n: number): number {
  const perWeek = new Map<string, number>();
  for (const [k, d] of Object.entries(days)) {
    if (!d.met) continue;
    const w = weekStart(k);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  let count = 0;
  for (const v of perWeek.values()) if (v >= n) count += 1;
  return count;
}

/* ----------------------------------------------------------- heatmap ---- */

export interface HeatCell {
  key: string;
  /** 0 none, 1 some, 2 half, 3 most, 4 met. */
  level: 0 | 1 | 2 | 3 | 4;
  frozen: boolean;
  future: boolean;
}

/** `weeks` columns of 7 days (Monday first), ending with the current week. */
export function heatmap(
  days: Record<string, DayRecord>,
  today: string,
  goal: DailyGoal,
  frozen: Set<string>,
  weeks = 12,
): HeatCell[][] {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const cols: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = [];
    for (let i = 0; i < 7; i++) {
      const key = addDays(first, w * 7 + i);
      const d = days[key];
      const f = goalFraction(d, goal);
      const level: HeatCell['level'] = d?.met ? 4 : f >= 0.66 ? 3 : f >= 0.33 ? 2 : f > 0 || (d?.answers ?? 0) > 0 ? 1 : 0;
      col.push({ key, level, frozen: frozen.has(key), future: key > today });
    }
    cols.push(col);
  }
  return cols;
}

/* ---------------------------------------------------------- backfill ---- */

/**
 * Per-day answers and active time rebuilt from the dated rows already in
 * `stats`, for a first run. Deterministic: the same stats and goal give the
 * same days. Drive time cannot be recovered (eyes-free was never recorded),
 * so it starts at zero.
 */
export function backfillDays(stats: Stats, goal: DailyGoal): Record<string, DayRecord> {
  const stamps: number[] = [];
  const answersByDay = new Map<string, number>();
  const durByStamp = new Map<number, number>();
  const bump = (key: string, n: number) => answersByDay.set(key, (answersByDay.get(key) ?? 0) + n);
  const take = (iso: unknown, answers: number, duration = 0) => {
    if (typeof iso !== 'string') return;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return;
    stamps.push(t);
    if (duration > 0) durByStamp.set(t, Math.max(durByStamp.get(t) ?? 0, duration));
    if (answers > 0) bump(localDayKey(new Date(t)), answers);
  };
  const rec = stats as unknown as Record<string, { history?: unknown } | undefined>;
  for (const s of ANSWER_SECTIONS) {
    const h = rec[s]?.history;
    if (Array.isArray(h)) for (const row of h) take((row as { date?: unknown })?.date, 1, rowDurationMs(row));
  }
  for (const row of stats.latencyHistory ?? []) take(row?.date, 1);
  for (const row of stats.sessions ?? []) take(row?.date, typeof row?.graded === 'number' ? row.graded : 0);
  for (const row of stats.tableDecisions?.history ?? []) take(row?.date, 0);

  const days: Record<string, DayRecord> = {};
  for (const [k, n] of answersByDay) days[k] = { answers: n, activeMs: 0 };
  for (const k of stats.practiceDays ?? []) {
    if (typeof k === 'string' && !days[k]) days[k] = { answers: 0, activeMs: 0 };
  }
  const sorted = [...new Set(stamps)].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    const credit = gap <= IDLE_CAP_MS ? gap : Math.min(durByStamp.get(sorted[i]) ?? 0, gap);
    if (credit <= 0) continue;
    const key = localDayKey(new Date(sorted[i]));
    days[key] = days[key] ?? { answers: 0, activeMs: 0 };
    days[key].activeMs += credit;
  }
  for (const d of Object.values(days)) if (meetsGoal(d, goal)) d.met = true;
  return pruneDays(days);
}

/** For callers holding an ISO string rather than a Date. */
export function dayOf(iso: string): string | null {
  return dayKeyOfIso(iso);
}
