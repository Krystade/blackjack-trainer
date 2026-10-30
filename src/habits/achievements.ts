import type { IndexRecentEntry, Stats } from '../store/types';
import type { ProgressState, StreakInfo } from './progress';
import { weeksWithAtLeast, WEEK_TARGET } from './progress';
import { ILLUSTRIOUS_18, FAB_4_H17, FAB_4_S17 } from '../engine/deviations';
import { classifySpeed, countRunPerCardMs } from '../drills/countSpeed';
import { countBits } from '../store/cellStats';
import { isRecent, recentWindow } from '../store/indexRecent';

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
  /**
   * The time the achievements are judged at (epoch ms), for the mastery
   * tiers' 180-day window. Supplied by the caller (progressStore contextFor,
   * from the habit clock) -- nothing here reads a clock, so the same context
   * always earns the same achievements, backfill included.
   */
  nowMs: number;
  /**
   * Wave L (lane v): guided sessions run to the end of their plan
   * (guided/store.ts). OPTIONAL: absent reads as none.
   */
  guidedSessions?: number;
}

export interface Measure {
  value: number;
  target: number;
  /** Optional extra text for the progress line ("93% now"). */
  note?: string;
}

/**
 * Wave T: the tiers of one mastery achievement, shown as one tile on the
 * Progress screen (its earned tiers dated, its bar on the next tier). Each
 * tier is still its own achievement, stored and toasted by its own id.
 */
export interface Ladder {
  id: string;
  title: string;
  how: string;
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
  /** Wave T: the mastery ladder this tier belongs to, and the tier's bar in %. */
  ladder?: Ladder;
  pct?: number;
}

/**
 * WAVE T: MASTERY TIERS -- bronze 90%, silver 95%, gold 99% -- judged on a
 * rolling window of recent answers that are also recent in time: the last N
 * answers, every one from the last RECENT_DAYS days, and at least N of them.
 * An index (or hand type) not practised for six months stops counting as
 * mastered now; a tier once earned stays earned, with its date.
 *
 * HOW BIG N IS, and why the two index sets differ. A set tier is passed when
 * EVERY index in it is at the bar at the same moment, so the evidence is the
 * whole set's windows together, not one index's. Simulated (players of a
 * fixed true accuracy answering the set's indices at random, about 200
 * answers per index; the share who ever reach the tier):
 *
 *   Illustrious 18 (17 indices), N = 20:
 *     bronze 18/20   18% of true-90% players, 87% at 93%, all at 95%
 *     silver 19/20   none at 93%, 30% at 95%, 95% at 97%
 *     gold   20/20   none at 98%, 58% at 99%, all at 99.5%
 *   With N = 50 instead, gold (50/50 on all 17 at once) is out of reach:
 *   none at 99%, 17% at 99.5%. So 20 is enough here -- 17 x 20 = 340
 *   answers at once is what makes 20 of 20 mean 99%, not merely a good run.
 *
 *   Fab 4 (4 indices), N = 20 would be far too easy -- gold reached by 92%
 *   of true-97% players -- so it is judged on N = 50 (200 answers at once):
 *     bronze 45/50   4% at 85%, 85% at 90%
 *     silver 48/50   14% at 93%, 68% at 95%
 *     gold   50/50   17% at 98%, 72% at 99%
 *
 * The hand types are one stream each (no "all at once"), and a window of 200
 * already lets 99% mean something (198 of 200, two misses), so it stays 200.
 * A tier needs `pct`% exactly, in integers: 18 of 20 is 90%, 47 of 50 is not 95%.
 */
export const MASTERY_TIERS: readonly (readonly [Tier, number])[] = [
  ['bronze', 90],
  ['silver', 95],
  ['gold', 99],
];
/** An answer counts toward a mastery window for this many days (today is day 0). */
export const RECENT_DAYS = 180;
/** Answers per index an Illustrious 18 tier is judged on. */
export const I18_WINDOW = 20;
/** Answers per index a Fab 4 tier is judged on. */
export const FAB4_WINDOW = 50;
/** Answers per hand type a hand-accuracy tier is judged on. */
export const ACCURACY_WINDOW = 200;

/** The fewest right of `n` that make `pct`%. */
export const neededRight = (n: number, pct: number): number => Math.ceil((pct * n) / 100);
const atLeast = (right: number, n: number, pct: number): boolean => right * 100 >= pct * n;

/**
 * Ids a tier was stored under before it was a tier, so an earn carries over:
 * the old "Illustrious 18" and "Fab 4" (10+ answers at 90% on every index,
 * lifetime) are the 90% tiers now, the old "sharp" achievements (95% over the
 * last 200) the 95% ones.
 */
export const LEGACY_IDS: Readonly<Record<string, string>> = {
  'index-i18-90': 'index-i18',
  'index-fab4-90': 'index-fab4',
  'accuracy-hard-95': 'accuracy-hard',
  'accuracy-soft-95': 'accuracy-soft',
  'accuracy-pairs-95': 'accuracy-pairs',
};

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

/**
 * The tiers of one ladder read the same window three times; it is worked out
 * once per context. Every stats save evaluates every achievement, so this
 * keeps a save's cost to one pass per window rather than three.
 */
const perContext = new WeakMap<AchievementContext, Map<string, unknown>>();
function once<T>(ctx: AchievementContext, key: string, make: () => T): T {
  let memo = perContext.get(ctx);
  if (!memo) {
    memo = new Map();
    perContext.set(ctx, memo);
  }
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}

/** A hand type's last ACCURACY_WINDOW timed, graded answers from the last RECENT_DAYS days. */
function handWindow(ctx: AchievementContext, category: string): { right: number; n: number } {
  return once(ctx, `hand:${category}`, () => {
    const rows = Array.isArray(ctx.stats.latencyHistory) ? ctx.stats.latencyHistory : [];
    // From the newest back, stopping at the window: the same rows as filtering
    // the whole history and keeping its last ACCURACY_WINDOW.
    let right = 0;
    let n = 0;
    for (let i = rows.length - 1; i >= 0 && n < ACCURACY_WINDOW; i -= 1) {
      const r = rows[i];
      if (!r || r.category !== category || typeof r.correct !== 'boolean' || !isRecent(r.date, ctx.nowMs, RECENT_DAYS)) continue;
      n += 1;
      if (r.correct) right += 1;
    }
    return { right, n };
  });
}

function accuracyTier(ctx: AchievementContext, category: string, pct: number): Measure {
  const { right, n } = handWindow(ctx, category);
  const acc = n ? right / n : 0;
  const note = n ? `${Math.floor(acc * 100)}% over the last ${n}` : `no answers in the last ${RECENT_DAYS} days`;
  if (n < ACCURACY_WINDOW) return m(n * 0.99, ACCURACY_WINDOW, note);
  return atLeast(right, ACCURACY_WINDOW, pct)
    ? m(ACCURACY_WINDOW, ACCURACY_WINDOW, note)
    : m(ACCURACY_WINDOW * 0.99 * (acc / (pct / 100)), ACCURACY_WINDOW, note);
}

/** How many of `ids` are at `pct`% over their last `window` recent answers. */
function indexSetTier(ctx: AchievementContext, ids: readonly string[], window: number, pct: number): Measure {
  // Each index's right answers in its window, or -1 with too few recent answers.
  const rights = once(ctx, `index:${window}:${ids.join(',')}`, () => {
    const store: unknown = ctx.stats.indexRecent;
    const per = (typeof store === 'object' && store !== null ? store : {}) as Record<string, IndexRecentEntry | undefined>;
    return ids.map((id) => {
      const w = recentWindow(per[id], window, ctx.nowMs, RECENT_DAYS);
      return w === null ? -1 : countBits(w).right;
    });
  });
  const done = rights.filter((r) => r >= 0 && atLeast(r, window, pct)).length;
  return m(done, ids.length, `${done}/${ids.length} indices at ${neededRight(window, pct)}/${window}`);
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
const FAB4_H17_IDS = FAB_4_H17.map((d) => d.id);
const FAB4_S17_IDS = FAB_4_S17.map((d) => d.id);
/** The Fab 4 under whichever rule (H17 or S17) is further along. */
const fab4 = (ctx: AchievementContext, pct: number): Measure => {
  const h = indexSetTier(ctx, FAB4_H17_IDS, FAB4_WINDOW, pct);
  const s = indexSetTier(ctx, FAB4_S17_IDS, FAB4_WINDOW, pct);
  return h.value / h.target >= s.value / s.target ? h : s;
};

/** One mastery ladder: a tier per MASTERY_TIERS, ids `<ladder>-<pct>`. */
const mastery = (
  group: Achievement['group'],
  ladder: Ladder,
  how: (pct: number) => string,
  measure: (ctx: AchievementContext, pct: number) => Measure,
): Achievement[] =>
  MASTERY_TIERS.map(([tier, pct]) => ({
    id: `${ladder.id}-${pct}`,
    title: `${ladder.title} (${tier})`,
    how: how(pct),
    tier,
    group,
    ladder,
    pct,
    measure: (ctx: AchievementContext) => measure(ctx, pct),
  }));

const HAND_WORD = { hard: 'hard', soft: 'soft', pairs: 'pair' } as const;
const HAND_TITLE = { hard: 'Hard hands', soft: 'Soft hands', pairs: 'Pairs' } as const;

/** Play sessions long enough to be called a shoe (SHOE_MIN_ROUNDS rounds). */
const playSessions = (s: Stats) => (s.sessions ?? []).filter((r) => (r.rounds ?? 0) >= SHOE_MIN_ROUNDS);
// C12: a self-reported run is the operator's word, not a graded count.
const countRuns = (s: Stats) => (s.countDrill?.history ?? []).filter((r) => r.selfReport !== true);

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
  ...(['hard', 'soft', 'pairs'] as const).flatMap((cat) =>
    mastery(
      'Drills',
      {
        id: `accuracy-${cat}`,
        title: `${HAND_TITLE[cat]} sharp`,
        how: `Your last ${ACCURACY_WINDOW} timed ${HAND_WORD[cat]} hand answers in the drills, all from the last ${RECENT_DAYS} days.`,
      },
      (pct) => `${pct}% right over your last ${ACCURACY_WINDOW} timed ${HAND_WORD[cat]} hand answers in the drills, all from the last ${RECENT_DAYS} days.`,
      (ctx, pct) => accuracyTier(ctx, cat, pct),
    ),
  ),
  {
    id: 'chart-sweep',
    title: 'Clean sweep',
    how: 'Finish a Mastery sweep of the whole chart.',
    tier: 'gold',
    group: 'Drills',
    measure: (c) => m(Math.min(1, c.stats.masterySweepsCompleted ?? 0), 1),
  },
  // Wave L (lane v): the guided session (guided/session.ts countsAsCompleted).
  ...tiered({ group: 'Drills' }, 'guided', [
    ['bronze', 1, 'Guided start', 'Finish a guided session.'],
    ['silver', 7, 'Routine', 'Finish 7 guided sessions.'],
  ], (c) => c.guidedSessions ?? 0),
  ...mastery(
    'Drills',
    {
      id: 'index-i18',
      title: 'Illustrious 18',
      how: `Every Illustrious 18 index at once, on its last ${I18_WINDOW} answers, all from the last ${RECENT_DAYS} days.`,
    },
    (pct) => `Every Illustrious 18 index right on ${neededRight(I18_WINDOW, pct)} of its last ${I18_WINDOW} answers (${pct}%), all from the last ${RECENT_DAYS} days.`,
    (ctx, pct) => indexSetTier(ctx, I18_IDS, I18_WINDOW, pct),
  ),
  ...mastery(
    'Drills',
    {
      id: 'index-fab4',
      title: 'Fab 4',
      how: `Every Fab 4 surrender index at once, on its last ${FAB4_WINDOW} answers, all from the last ${RECENT_DAYS} days.`,
    },
    (pct) => `Every Fab 4 surrender index right on ${neededRight(FAB4_WINDOW, pct)} of its last ${FAB4_WINDOW} answers (${pct}%), all from the last ${RECENT_DAYS} days.`,
    fab4,
  ),
  ...tiered({ group: 'Counting' }, 'count-clean', [
    ['bronze', 10, 'Counter', 'Finish 10 count-drill runs with the right count.'],
    ['silver', 50, 'Steady count', 'Finish 50 count-drill runs with the right count.'],
  ], (c) => countRuns(c.stats).filter((r) => r.correct).length),
  {
    id: 'count-full-shoe',
    title: 'Full shoe',
    how: `Count a ${FULL_SHOE_CARDS}-card shoe exactly at table-ready pace (a deck in 30 s or faster), in the count drill or a Timed Challenge.`,
    tier: 'gold',
    group: 'Counting',
    measure: (c) =>
      m(
        countRuns(c.stats).some((r) => {
          if (!r.correct || r.cards < FULL_SHOE_CARDS) return false;
          // C6: an eyes-free run's pace is its measured time, not its gap.
          const perCard = countRunPerCardMs(r);
          return typeof perCard === 'number' && perCard > 0 && classifySpeed((perCard * 52) / 1000) !== 'learning';
        }) ||
          (c.stats.timedCount?.history ?? []).some(
            (r) => r.correct && r.cards >= FULL_SHOE_CARDS && r.secondsPerDeck > 0 && classifySpeed(r.secondsPerDeck) !== 'learning',
          )
          ? 1
          : 0,
        1,
      ),
  },
  ...tiered({ group: 'Counting' }, 'tc-run', [
    ['bronze', 10, 'True to form', '10 true-count conversions right in a row.'],
    ['silver', 25, 'Converter', '25 true-count conversions right in a row.'],
    ['gold', 50, 'Human divider', '50 true-count conversions right in a row.'],
  ], (c) => longestRun((c.stats.trueCount?.history ?? []).filter((r) => r.selfReport !== true), (r) => r.correct)),
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
    how: 'One eyes-free Drive session of 15 minutes (no break over 3 minutes) with at least 10 active minutes in it.',
    tier: 'silver',
    group: 'Drive',
    measure: (c) => m(Math.floor((c.progress.drive.bestFreewayMs ?? 0) / 60_000), FREEWAY_MS / 60_000),
  },
  ...tiered({ group: 'Play' }, 'shoes', [
    ['bronze', 1, 'First shoe', `Play a shoe at the table (a session of ${SHOE_MIN_ROUNDS}+ rounds).`],
    ['silver', 10, 'Ten shoes', `Play 10 shoes at the table (sessions of ${SHOE_MIN_ROUNDS}+ rounds).`],
    ['gold', 50, 'Table regular', `Play 50 shoes at the table (sessions of ${SHOE_MIN_ROUNDS}+ rounds).`],
  ], (c) => playSessions(c.stats).length),
  {
    id: 'shoe-perfect-play',
    title: 'By the book',
    how: `A table session of ${SHOE_MIN_ROUNDS}+ rounds with zero strategy errors.`,
    tier: 'gold',
    group: 'Play',
    measure: (c) =>
      m(playSessions(c.stats).some((s) => (s.plays ?? 0) > 0 && s.playsCorrect === s.plays) ? 1 : 0, 1),
  },
  {
    id: 'shoe-perfect-bets',
    title: 'Right on the ramp',
    how: `A table session of ${SHOE_MIN_ROUNDS}+ rounds with zero bet errors.`,
    tier: 'silver',
    group: 'Play',
    // `plays` marks a row new enough to have recorded bet misses at all.
    measure: (c) =>
      m(playSessions(c.stats).some((s) => s.plays !== undefined && !s.betMisses) ? 1 : 0, 1),
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

const TIER_RANK: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2 };

/** The date stored for `id`, under its own id or the one it had before it was a tier. */
function storedDate(earned: Readonly<Record<string, string>>, id: string): string | undefined {
  if (Object.prototype.hasOwnProperty.call(earned, id)) return earned[id];
  const legacy = LEGACY_IDS[id];
  return legacy !== undefined && Object.prototype.hasOwnProperty.call(earned, legacy) ? earned[legacy] : undefined;
}

/**
 * The stored date of a tier, or of the nearest tier above it in its ladder:
 * a higher tier was earned through this one (the bars only rise), so a stored
 * gold or silver carries this tier with it -- an old 95% "sharp" earn, now
 * silver, carries bronze.
 */
function storedOrImplied(earned: Readonly<Record<string, string>>, def: Achievement): string | undefined {
  const own = storedDate(earned, def.id);
  if (own !== undefined || !def.ladder) return own;
  const above = ACHIEVEMENTS.filter((a) => a.ladder?.id === def.ladder!.id && TIER_RANK[a.tier] > TIER_RANK[def.tier]).sort(
    (a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier],
  );
  for (const a of above) {
    const d = storedDate(earned, a.id);
    if (d !== undefined) return d;
  }
  return undefined;
}

export function evaluateAchievements(ctx: AchievementContext): AchievementStatus[] {
  return ACHIEVEMENTS.map((def) => {
    let ms: Measure;
    try {
      ms = def.measure(ctx);
    } catch {
      ms = m(0, 1);
    }
    const stored = storedOrImplied(ctx.progress.earned, def);
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

/** Ids earned by `ctx` that `ctx.progress.earned` does not yet hold, nor imply. */
export function newlyEarned(ctx: AchievementContext): string[] {
  return evaluateAchievements(ctx)
    .filter((s) => s.earned && s.earnedAt === undefined)
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
