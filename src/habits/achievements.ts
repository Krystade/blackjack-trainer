import type { Stats } from '../store/types';
import type { ProgressState, StreakInfo } from './progress';
import { weeksWithAtLeast, WEEK_TARGET } from './progress';
import { ILLUSTRIOUS_18, FAB_4_H17, FAB_4_S17 } from '../engine/deviations';
import { classifySpeed } from '../drills/countSpeed';

/**
 * Wave N: achievements, every one computed from data the app already keeps
 * (stats, the progress store, the casino log). Each has a measure returning
 * how far along it is; earned is value >= target.
 */

export type Tier = 'bronze' | 'silver' | 'gold';

export interface AchievementContext {
  stats: Stats;
  progress: ProgressState;
  streak: StreakInfo;
  /** Finished sessions in the real-play casino log. */
  casinoSessions: number;
}

export interface Measure {
  value: number;
  target: number;
  /** Optional extra text for the progress line ("93% now"). */
  note?: string;
}

export interface Achievement {
  id: string;
  title: string;
  how: string;
  tier: Tier;
  /** Hidden until earned. */
  secret?: true;
  /** Grouping on the Progress screen. */
  group: 'Habit' | 'Drills' | 'Counting' | 'Drive' | 'Play' | 'Casino';
  measure: (ctx: AchievementContext) => Measure;
}

/** Window for the accuracy achievements, and the bar. */
export const ACCURACY_WINDOW = 200;
export const ACCURACY_TARGET = 0.95;
/** An index counts as mastered at this many answers and this accuracy. */
export const INDEX_MASTERY_ANSWERS = 10;
export const INDEX_MASTERY_ACCURACY = 0.9;
/** A shoe for the clean-shoe achievements: at least this many rounds. */
export const SHOE_MIN_ROUNDS = 20;
/** A full shoe of cards for the count achievement (six decks). */
export const FULL_SHOE_CARDS = 312;
/** A "freeway drive": one contiguous Drive session this long. */
export const FREEWAY_MS = 15 * 60_000;

const m = (value: number, target: number, note?: string): Measure => ({ value, target, ...(note ? { note } : {}) });

function totalActiveMs(p: ProgressState): number {
  return Object.values(p.days).reduce((a, d) => a + d.activeMs, 0);
}
function daysMet(p: ProgressState): number {
  return Object.values(p.days).filter((d) => d.met).length;
}

function accuracyWindow(stats: Stats, category: string): Measure {
  const rows = (stats.latencyHistory ?? []).filter((r) => r.category === category && typeof r.correct === 'boolean');
  const last = rows.slice(-ACCURACY_WINDOW);
  const right = last.filter((r) => r.correct).length;
  const acc = last.length ? right / last.length : 0;
  const note = last.length ? `${Math.floor(acc * 100)}% over the last ${last.length}` : undefined;
  if (last.length < ACCURACY_WINDOW) return m(last.length * 0.99, ACCURACY_WINDOW, note);
  return acc >= ACCURACY_TARGET ? m(ACCURACY_WINDOW, ACCURACY_WINDOW, note) : m(ACCURACY_WINDOW * 0.99 * (acc / ACCURACY_TARGET), ACCURACY_WINDOW, note);
}

function indexSetMastery(stats: Stats, ids: readonly string[]): Measure {
  const per = stats.perIndex as Record<string, { right: number; wrong: number } | undefined>;
  let done = 0;
  for (const id of ids) {
    const t = per[id];
    if (!t) continue;
    const n = t.right + t.wrong;
    if (n >= INDEX_MASTERY_ANSWERS && t.right / n >= INDEX_MASTERY_ACCURACY) done += 1;
  }
  return m(done, ids.length, `${done} of ${ids.length} indices`);
}

function longestRun<T>(rows: readonly T[], ok: (r: T) => boolean): number {
  let best = 0;
  let run = 0;
  for (const r of rows) {
    run = ok(r) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

const I18_IDS = ILLUSTRIOUS_18.filter((d) => d.active).map((d) => d.id);
const fab4 = (stats: Stats): Measure => {
  const h = indexSetMastery(stats, FAB_4_H17.map((d) => d.id));
  const s = indexSetMastery(stats, FAB_4_S17.map((d) => d.id));
  return h.value / h.target >= s.value / s.target ? h : s;
};

const playSessions = (s: Stats) => (s.sessions ?? []).filter((r) => (r.rounds ?? 0) > 0);
const countRuns = (s: Stats) => s.countDrill?.history ?? [];

const tiered = (
  base: Omit<Achievement, 'id' | 'title' | 'how' | 'tier' | 'measure'>,
  id: string,
  levels: [Tier, number, string, string][],
  value: (ctx: AchievementContext) => number,
): Achievement[] =>
  levels.map(([tier, target, title, how]) => ({
    ...base,
    id: `${id}-${target}`,
    title,
    how,
    tier,
    measure: (ctx) => m(value(ctx), target),
  }));

export const ACHIEVEMENTS: readonly Achievement[] = [
  ...tiered({ group: 'Habit' }, 'streak', [
    ['bronze', 3, 'Warming up', 'Meet the daily goal 3 days in a row.'],
    ['silver', 7, 'One week', 'Meet the daily goal 7 days in a row.'],
    ['gold', 30, 'One month', 'Meet the daily goal 30 days in a row.'],
    ['gold', 100, 'Hundred days', 'Meet the daily goal 100 days in a row.'],
  ], (c) => c.streak.longest),
  ...tiered({ group: 'Habit' }, 'days', [
    ['bronze', 10, 'Regular', 'Meet the daily goal on 10 days.'],
    ['silver', 50, 'Committed', 'Meet the daily goal on 50 days.'],
    ['gold', 200, 'Devoted', 'Meet the daily goal on 200 days.'],
  ], (c) => daysMet(c.progress)),
  ...tiered({ group: 'Habit' }, 'minutes', [
    ['bronze', 60, 'First hour', 'Practise for 60 active minutes in all.'],
    ['silver', 600, 'Ten hours', 'Practise for 600 active minutes in all.'],
    ['gold', 3000, 'Fifty hours', 'Practise for 3,000 active minutes in all.'],
  ], (c) => Math.floor(totalActiveMs(c.progress) / 60_000)),
  ...tiered({ group: 'Habit' }, 'answers', [
    ['bronze', 100, 'Hundred answers', 'Answer 100 graded questions.'],
    ['silver', 1000, 'Thousand answers', 'Answer 1,000 graded questions.'],
    ['gold', 10000, 'Ten thousand', 'Answer 10,000 graded questions.'],
  ], (c) => c.progress.answersTotal),
  {
    id: 'week-goal',
    title: 'Good week',
    how: `Meet the daily goal on ${WEEK_TARGET} days of one week (Monday to Sunday).`,
    tier: 'silver',
    group: 'Habit',
    measure: (c) => m(weeksWithAtLeast(c.progress.days, WEEK_TARGET) > 0 ? 1 : 0, 1),
  },
  {
    id: 'week-perfect',
    title: 'Perfect week',
    how: 'Meet the daily goal on all 7 days of one week.',
    tier: 'gold',
    group: 'Habit',
    measure: (c) => m(weeksWithAtLeast(c.progress.days, 7) > 0 ? 1 : 0, 1),
  },
  {
    id: 'freeze-used',
    title: 'Saved by the freeze',
    how: 'Miss a day while holding a streak freeze.',
    tier: 'bronze',
    group: 'Habit',
    secret: true,
    measure: (c) => m(c.streak.frozen.size > 0 ? 1 : 0, 1),
  },
  {
    id: 'freeze-full',
    title: 'Cold storage',
    how: 'Hold two streak freezes at once.',
    tier: 'silver',
    group: 'Habit',
    secret: true,
    measure: (c) => m(c.streak.maxFreezesHeld, 2),
  },
  ...(['hard', 'soft', 'pairs'] as const).map<Achievement>((cat) => ({
    id: `accuracy-${cat}`,
    title: `${cat === 'pairs' ? 'Pairs' : cat === 'hard' ? 'Hard hands' : 'Soft hands'} sharp`,
    how: `${Math.round(ACCURACY_TARGET * 100)}% right over your last ${ACCURACY_WINDOW} timed ${cat === 'pairs' ? 'pair' : cat} hand answers in the drills.`,
    tier: 'silver',
    group: 'Drills',
    measure: (c) => accuracyWindow(c.stats, cat),
  })),
  {
    id: 'chart-sweep',
    title: 'Clean sweep',
    how: 'Finish a Mastery sweep of the whole chart.',
    tier: 'gold',
    group: 'Drills',
    measure: (c) => m(Math.min(1, c.stats.masterySweepsCompleted ?? 0), 1),
  },
  {
    id: 'index-i18',
    title: 'Illustrious 18',
    how: `Get every Illustrious 18 index to ${INDEX_MASTERY_ANSWERS}+ answers at ${Math.round(INDEX_MASTERY_ACCURACY * 100)}%.`,
    tier: 'gold',
    group: 'Drills',
    measure: (c) => indexSetMastery(c.stats, I18_IDS),
  },
  {
    id: 'index-fab4',
    title: 'Fab 4',
    how: `Get every Fab 4 surrender index to ${INDEX_MASTERY_ANSWERS}+ answers at ${Math.round(INDEX_MASTERY_ACCURACY * 100)}%.`,
    tier: 'silver',
    group: 'Drills',
    measure: (c) => fab4(c.stats),
  },
  ...tiered({ group: 'Counting' }, 'count-clean', [
    ['bronze', 10, 'Counter', 'Finish 10 count-drill runs with the right count.'],
    ['silver', 50, 'Steady count', 'Finish 50 count-drill runs with the right count.'],
  ], (c) => countRuns(c.stats).filter((r) => r.correct).length),
  {
    id: 'count-full-shoe',
    title: 'Full shoe',
    how: `Count a ${FULL_SHOE_CARDS}-card shoe exactly at table-ready pace (a deck in 30 s or faster).`,
    tier: 'gold',
    group: 'Counting',
    measure: (c) =>
      m(
        countRuns(c.stats).some((r) => {
          if (!r.correct || r.cards < FULL_SHOE_CARDS) return false;
          const perCard = r.manual ? r.meanTapMs : r.intervalMs;
          return typeof perCard === 'number' && perCard > 0 && classifySpeed((perCard * 52) / 1000) !== 'learning';
        })
          ? 1
          : 0,
        1,
      ),
  },
  ...tiered({ group: 'Counting' }, 'tc-run', [
    ['bronze', 10, 'True to form', '10 true-count conversions right in a row.'],
    ['silver', 25, 'Converter', '25 true-count conversions right in a row.'],
    ['gold', 50, 'Human divider', '50 true-count conversions right in a row.'],
  ], (c) => longestRun(c.stats.trueCount?.history ?? [], (r) => r.correct)),
  {
    id: 'deck-50',
    title: 'Deck reader',
    how: 'Get 50 deck estimates right.',
    tier: 'bronze',
    group: 'Counting',
    measure: (c) => m((c.stats.deckEstimation?.history ?? []).filter((r) => r.correct).length, 50),
  },
  ...tiered({ group: 'Drive' }, 'drive-min', [
    ['bronze', 30, 'On the road', 'Practise eyes-free (Drive) for 30 active minutes.'],
    ['silver', 300, 'Road warrior', 'Practise eyes-free (Drive) for 300 active minutes.'],
  ], (c) => Math.floor(c.progress.drive.totalMs / 60_000)),
  {
    id: 'drive-freeway',
    title: 'Freeway drive',
    how: 'One eyes-free Drive session of 15 active minutes without a break.',
    tier: 'silver',
    group: 'Drive',
    measure: (c) => m(Math.floor(c.progress.drive.bestRunMs / 60_000), FREEWAY_MS / 60_000),
  },
  ...tiered({ group: 'Play' }, 'shoes', [
    ['bronze', 1, 'First shoe', 'Play a session at the table.'],
    ['silver', 10, 'Ten shoes', 'Play 10 sessions at the table.'],
    ['gold', 50, 'Table regular', 'Play 50 sessions at the table.'],
  ], (c) => playSessions(c.stats).length),
  {
    id: 'shoe-perfect-play',
    title: 'By the book',
    how: `A table session of ${SHOE_MIN_ROUNDS}+ rounds with zero strategy errors.`,
    tier: 'gold',
    group: 'Play',
    measure: (c) =>
      m(playSessions(c.stats).some((s) => (s.rounds ?? 0) >= SHOE_MIN_ROUNDS && (s.plays ?? 0) > 0 && s.playsCorrect === s.plays) ? 1 : 0, 1),
  },
  {
    id: 'shoe-perfect-bets',
    title: 'Right on the ramp',
    how: `A table session of ${SHOE_MIN_ROUNDS}+ rounds with zero bet errors.`,
    tier: 'silver',
    group: 'Play',
    // `plays` marks a row new enough to have recorded bet misses at all.
    measure: (c) =>
      m(playSessions(c.stats).some((s) => (s.rounds ?? 0) >= SHOE_MIN_ROUNDS && s.plays !== undefined && !s.betMisses) ? 1 : 0, 1),
  },
  {
    id: 'wong-25',
    title: 'Know when to sit',
    how: 'Get 25 play-or-sit (Wong) calls right at the table.',
    tier: 'silver',
    group: 'Play',
    measure: (c) => m(c.stats.categories.wong?.right ?? 0, 25),
  },
  ...tiered({ group: 'Casino' }, 'casino', [
    ['bronze', 1, 'Into the wild', 'Log your first real casino session.'],
    ['silver', 10, 'Field notes', 'Log 10 real casino sessions.'],
  ], (c) => c.casinoSessions),
];

export interface AchievementStatus {
  def: Achievement;
  value: number;
  target: number;
  fraction: number;
  note?: string;
  earned: boolean;
  /** ISO date, '' when earned undated (from history). */
  earnedAt?: string;
}

export function evaluateAchievements(ctx: AchievementContext): AchievementStatus[] {
  return ACHIEVEMENTS.map((def) => {
    let ms: Measure;
    try {
      ms = def.measure(ctx);
    } catch {
      ms = m(0, 1);
    }
    const stored = ctx.progress.earned[def.id];
    const earned = stored !== undefined || ms.value >= ms.target;
    return {
      def,
      value: ms.value,
      target: ms.target,
      fraction: earned ? 1 : Math.max(0, Math.min(1, ms.value / ms.target)),
      ...(ms.note ? { note: ms.note } : {}),
      earned,
      ...(stored !== undefined ? { earnedAt: stored } : {}),
    };
  });
}

/** Ids earned by `ctx` that `ctx.progress.earned` does not yet hold. */
export function newlyEarned(ctx: AchievementContext): string[] {
  return evaluateAchievements(ctx)
    .filter((s) => s.earned && ctx.progress.earned[s.def.id] === undefined)
    .map((s) => s.def.id);
}

/**
 * A date for an achievement earned from history, where one is computable:
 * a streak length is dated by the day it was first reached. Others are ''.
 */
export function backfillDate(id: string, streak: StreakInfo): string {
  const match = /^streak-(\d+)$/.exec(id);
  if (match) {
    const day = streak.reachedOn[Number(match[1]) - 1];
    if (day) return day;
  }
  return '';
}
