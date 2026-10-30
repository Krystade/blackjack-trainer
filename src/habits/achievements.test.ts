import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACHIEVEMENTS,
  ACCURACY_WINDOW,
  FAB4_WINDOW,
  FULL_SHOE_CARDS,
  I18_WINDOW,
  LEGACY_IDS,
  MASTERY_TIERS,
  RECENT_DAYS,
  backfillDate,
  evaluateAchievements,
  neededRight,
  newlyEarned,
  type AchievementContext,
} from './achievements';
import { addDays, computeStreak, emptyProgress, type DayRecord, type ProgressState } from './progress';
import { EMPTY_STATS, type IndexRecentEntry, type Stats } from '../store/types';
import { ILLUSTRIOUS_18, FAB_4_H17, FAB_4_S17 } from '../engine/deviations';
import { INDEX_RECENT_KEEP } from '../store/indexRecent';
import { WINDOW_SPARE } from '../store/cellStats';

const TODAY = '2026-10-21';
const NOW = Date.parse(`${TODAY}T12:00:00.000Z`);
const DAY = 86_400_000;

function ctx(opts: { stats?: Partial<Stats>; progress?: Partial<ProgressState>; casino?: number; nowMs?: number; guided?: number } = {}): AchievementContext {
  const progress: ProgressState = { ...emptyProgress(), ...opts.progress };
  const stats = { ...structuredClone(EMPTY_STATS), ...opts.stats } as Stats;
  return {
    stats,
    progress,
    streak: computeStreak(progress.days, TODAY),
    casinoSessions: opts.casino ?? 0,
    nowMs: opts.nowMs ?? NOW,
    ...(opts.guided !== undefined ? { guidedSessions: opts.guided } : {}),
  };
}

const metRun = (n: number, last = TODAY): Record<string, DayRecord> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays(last, -i), { answers: 60, activeMs: 0, met: true as const }]));
/** n met days, none consecutive (every other day, far back). */
const metSpread = (n: number): Record<string, DayRecord> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [addDays('2025-01-06', i * 2), { answers: 60, activeMs: 0, met: true as const }]));
const minutes = (min: number): Partial<ProgressState> => ({ days: { '2026-10-01': { answers: 1, activeMs: min * 60_000 } } });
/** Timed hand answers, `daysAgo` before TODAY, the wrong ones first (so the newest are right). */
const latency = (category: 'hard' | 'soft' | 'pairs', right: number, wrong: number, daysAgo = 0) =>
  [...Array(wrong).fill(false), ...Array(right).fill(true)].map((correct: boolean) => ({
    category,
    elapsedMs: 900,
    correct,
    date: `${addDays(TODAY, -daysAgo)}T10:00:00.000Z`,
  }));
/** One index's recent answers: `bits` oldest first, every one on `day`. */
const entry = (bits: string, day = TODAY): IndexRecentEntry => ({ recent: bits, days: Array(bits.length).fill(day) });
/** For each of `ids`: `wrong` wrong answers, then `right` right ones. */
const recentFor = (ids: readonly string[], right: number, wrong: number, day = TODAY) =>
  Object.fromEntries(ids.map((id) => [id, entry('0'.repeat(wrong) + '1'.repeat(right), day)]));
const runs = (n: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => ({ date: '2026-10-01T10:00:00Z', cards: 52, intervalMs: 800, correct: true, ...extra }));
const tcRows = (pattern: boolean[]) => pattern.map((correct) => ({ date: '2026-10-01T10:00:00Z', runningCount: 4, decksRemaining: 2, correctTc: 2, correct }));
const sessions = (n: number, extra: Record<string, unknown> = {}) =>
  Array.from({ length: n }, () => ({ date: '2026-10-01T10:00:00Z', rounds: 25, graded: 40, correct: 39, bankrollDelta: 0, ...extra }));
const timed = (cards: number, secondsPerDeck: number) => ({
  date: '2026-10-01T10:00:00Z', cards, elapsedMs: (secondsPerDeck * cards * 1000) / 52, secondsPerDeck, tier: 'table-ready', correct: true,
});
const i18 = ILLUSTRIOUS_18.filter((d) => d.active).map((d) => d.id);
const fab = FAB_4_S17.map((d) => d.id);
const fabH17 = FAB_4_H17.map((d) => d.id);
/** Every Illustrious 18 index at `right` of its last 20, except the first at `firstRight`. */
const i18At = (right: number, firstRight = right) => ({
  ...recentFor(i18, right, I18_WINDOW - right),
  [i18[0]!]: entry('0'.repeat(I18_WINDOW - firstRight) + '1'.repeat(firstRight)),
});

/** For every achievement: a context just short of it, and one that earns it. */
const CASES: Record<string, [AchievementContext, AchievementContext]> = {
  'streak-3': [ctx({ progress: { days: metRun(2) } }), ctx({ progress: { days: metRun(3) } })],
  'streak-7': [ctx({ progress: { days: metRun(6) } }), ctx({ progress: { days: metRun(7) } })],
  'streak-30': [ctx({ progress: { days: metRun(29) } }), ctx({ progress: { days: metRun(30) } })],
  'streak-100': [ctx({ progress: { days: metRun(99) } }), ctx({ progress: { days: metRun(100) } })],
  'days-10': [ctx({ progress: { days: metSpread(9) } }), ctx({ progress: { days: metSpread(10) } })],
  'days-50': [ctx({ progress: { days: metSpread(49) } }), ctx({ progress: { days: metSpread(50) } })],
  'days-200': [ctx({ progress: { days: metSpread(199) } }), ctx({ progress: { days: metSpread(200) } })],
  'minutes-60': [ctx({ progress: minutes(59) }), ctx({ progress: minutes(60) })],
  'minutes-600': [ctx({ progress: minutes(599) }), ctx({ progress: minutes(600) })],
  'minutes-3000': [ctx({ progress: minutes(2999) }), ctx({ progress: minutes(3000) })],
  'answers-100': [ctx({ progress: { answersTotal: 99 } }), ctx({ progress: { answersTotal: 100 } })],
  'answers-1000': [ctx({ progress: { answersTotal: 999 } }), ctx({ progress: { answersTotal: 1000 } })],
  'answers-10000': [ctx({ progress: { answersTotal: 9999 } }), ctx({ progress: { answersTotal: 10000 } })],
  // 19-25 Oct 2026 is Monday to Sunday.
  'week-goal': [ctx({ progress: { days: metRun(4, '2026-10-22') } }), ctx({ progress: { days: metRun(5, '2026-10-23') } })],
  'week-perfect': [ctx({ progress: { days: metRun(7, '2026-10-24') } }), ctx({ progress: { days: metRun(7, '2026-10-25') } })],
  'freeze-used': [
    ctx({ progress: { days: metRun(6, addDays(TODAY, -2)) } }), // no freeze earned: the miss ends it
    ctx({ progress: { days: metRun(7, addDays(TODAY, -2)) } }),
  ],
  'freeze-full': [ctx({ progress: { days: metRun(13) } }), ctx({ progress: { days: metRun(14) } })],
  // Hand accuracy: the last 200 timed answers, all from the last 180 days.
  'accuracy-hard-90': [
    ctx({ stats: { latencyHistory: latency('hard', 179, 21) } }),
    ctx({ stats: { latencyHistory: latency('hard', 180, 20) } }),
  ],
  'accuracy-hard-95': [ctx({ stats: { latencyHistory: latency('hard', 189, 11) } }), ctx({ stats: { latencyHistory: latency('hard', 190, 10) } })],
  'accuracy-hard-99': [ctx({ stats: { latencyHistory: latency('hard', 197, 3) } }), ctx({ stats: { latencyHistory: latency('hard', 198, 2) } })],
  // 199 recent and one exactly 180 days old is short of 200; 179 days old counts.
  'accuracy-soft-90': [
    ctx({ stats: { latencyHistory: [...latency('soft', 1, 0, RECENT_DAYS), ...latency('soft', 199, 0)] } }),
    ctx({ stats: { latencyHistory: [...latency('soft', 1, 0, RECENT_DAYS - 1), ...latency('soft', 199, 0)] } }),
  ],
  'accuracy-soft-95': [ctx({ stats: { latencyHistory: latency('soft', 199, 0) } }), ctx({ stats: { latencyHistory: latency('soft', 200, 0) } })],
  // Undated rows are never recent, however right.
  'accuracy-soft-99': [
    ctx({ stats: { latencyHistory: [...latency('soft', 100, 0).map(({ category, elapsedMs, correct }) => ({ category, elapsedMs, correct })), ...latency('soft', 100, 0)] } }),
    ctx({ stats: { latencyHistory: latency('soft', 198, 2) } }),
  ],
  // Another hand type, and wrong answers the window has moved past, count for nothing.
  'accuracy-pairs-90': [
    ctx({ stats: { latencyHistory: [...latency('pairs', 200, 0), ...latency('hard', 5, 0), ...latency('pairs', 0, 21)] } }),
    ctx({ stats: { latencyHistory: [...latency('pairs', 0, 30), ...latency('pairs', 180, 20)] } }),
  ],
  'accuracy-pairs-95': [ctx({ stats: { latencyHistory: latency('pairs', 189, 11) } }), ctx({ stats: { latencyHistory: latency('pairs', 190, 10) } })],
  'accuracy-pairs-99': [ctx({ stats: { latencyHistory: latency('pairs', 197, 3) } }), ctx({ stats: { latencyHistory: latency('pairs', 198, 2) } })],
  'chart-sweep': [ctx(), ctx({ stats: { masterySweepsCompleted: 1 } })],
  // Every Illustrious 18 index at once, on its last 20 answers: one index a
  // single answer short holds the whole set back.
  'index-i18-90': [ctx({ stats: { indexRecent: i18At(18, 17) } }), ctx({ stats: { indexRecent: i18At(18) } })],
  'index-i18-95': [ctx({ stats: { indexRecent: i18At(19, 18) } }), ctx({ stats: { indexRecent: i18At(19) } })],
  'index-i18-99': [ctx({ stats: { indexRecent: i18At(20, 19) } }), ctx({ stats: { indexRecent: i18At(20) } })],
  // The Fab 4 on the last 50 answers per index (the S17 four; H17 adds two).
  'index-fab4-90': [
    ctx({ stats: { indexRecent: { ...recentFor(fab, 45, 5), [fab[0]!]: entry('0'.repeat(6) + '1'.repeat(44)) } } }),
    ctx({ stats: { indexRecent: recentFor(fab, 45, 5) } }),
  ],
  'index-fab4-95': [
    ctx({ stats: { indexRecent: { ...recentFor(fab, 48, 2), [fab[3]!]: entry('0'.repeat(3) + '1'.repeat(47)) } } }),
    ctx({ stats: { indexRecent: recentFor(fabH17, 48, 2) } }),
  ],
  'index-fab4-99': [
    ctx({ stats: { indexRecent: { ...recentFor(fab, 50, 0), [fab[1]!]: entry('0' + '1'.repeat(49)) } } }),
    ctx({ stats: { indexRecent: recentFor(fab, 50, 0) } }),
  ],
  'count-clean-10': [ctx({ stats: { countDrill: { history: [...runs(9), ...runs(5, { correct: false }), ...runs(5, { selfReport: true })] } } }), ctx({ stats: { countDrill: { history: runs(10) } } })],
  'count-clean-50': [ctx({ stats: { countDrill: { history: runs(49) } } }), ctx({ stats: { countDrill: { history: runs(50) } } })],
  'count-full-shoe': [
    ctx({ stats: { countDrill: { history: [...runs(1, { cards: FULL_SHOE_CARDS, intervalMs: 600 }), ...runs(1, { cards: FULL_SHOE_CARDS - 1, intervalMs: 500 }), ...runs(1, { cards: FULL_SHOE_CARDS, intervalMs: 500, correct: false }), ...runs(1, { cards: FULL_SHOE_CARDS, intervalMs: 500, eyesFree: true, elapsedMs: FULL_SHOE_CARDS * 1100 })] } } }),
    // C6 (the eyes-free row above): a 500 ms GAP after ~600 ms of speech is not table-ready pace.
    ctx({ stats: { countDrill: { history: runs(1, { cards: FULL_SHOE_CARDS, intervalMs: 576 }) } } }),
  ],
  'count-full-shoe-timed': [
    ctx({ stats: { timedCount: { history: [timed(FULL_SHOE_CARDS, 31), timed(FULL_SHOE_CARDS - 1, 20), { ...timed(FULL_SHOE_CARDS, 20), correct: false }] } } }),
    ctx({ stats: { timedCount: { history: [timed(FULL_SHOE_CARDS, 30)] } } }),
  ],
  'tc-run-10': [ctx({ stats: { trueCount: { history: [...tcRows([...Array(9).fill(true), false, ...Array(9).fill(true)]), ...tcRows(Array(5).fill(true)).map((r) => ({ ...r, selfReport: true }))] } } }), ctx({ stats: { trueCount: { history: tcRows(Array(10).fill(true)) } } })],
  'tc-run-25': [ctx({ stats: { trueCount: { history: tcRows(Array(24).fill(true)) } } }), ctx({ stats: { trueCount: { history: tcRows(Array(25).fill(true)) } } })],
  'tc-run-50': [ctx({ stats: { trueCount: { history: tcRows(Array(49).fill(true)) } } }), ctx({ stats: { trueCount: { history: tcRows(Array(50).fill(true)) } } })],
  'deck-50': [
    ctx({ stats: { deckEstimation: { history: Array.from({ length: 49 }, () => ({ date: 'x', actualDecks: 2, guess: 2, errorDecks: 0, correct: true })) } } }),
    ctx({ stats: { deckEstimation: { history: Array.from({ length: 50 }, () => ({ date: 'x', actualDecks: 2, guess: 2, errorDecks: 0, correct: true })) } } }),
  ],
  'drive-min-30': [ctx({ progress: { drive: { totalMs: 29 * 60_000 + 59_999, runMs: 0, bestRunMs: 0 } } }), ctx({ progress: { drive: { totalMs: 30 * 60_000, runMs: 0, bestRunMs: 0 } } })],
  'drive-min-300': [ctx({ progress: { drive: { totalMs: 299 * 60_000, runMs: 0, bestRunMs: 0 } } }), ctx({ progress: { drive: { totalMs: 300 * 60_000, runMs: 0, bestRunMs: 0 } } })],
  'drive-freeway': [ctx({ progress: { drive: { totalMs: 0, runMs: 0, bestRunMs: 17 * 60_000, bestFreewayMs: 15 * 60_000 - 1 } } }), ctx({ progress: { drive: { totalMs: 0, runMs: 0, bestRunMs: 0, bestFreewayMs: 15 * 60_000 } } })],
  // A shoe is a session of SHOE_MIN_ROUNDS (20) rounds: 19 is not one.
  'shoes-1': [ctx({ stats: { sessions: sessions(3, { rounds: 19 }) } }), ctx({ stats: { sessions: sessions(1, { rounds: 20 }) } })],
  'shoes-10': [ctx({ stats: { sessions: [...sessions(9), ...sessions(5, { rounds: 19 })] } }), ctx({ stats: { sessions: sessions(10, { rounds: 20 }) } })],
  'shoes-50': [ctx({ stats: { sessions: sessions(49) } }), ctx({ stats: { sessions: sessions(50) } })],
  'shoe-perfect-play': [
    ctx({ stats: { sessions: [...sessions(1, { plays: 30, playsCorrect: 29 }), ...sessions(1, { rounds: 19, plays: 30, playsCorrect: 30 })] } }),
    ctx({ stats: { sessions: sessions(1, { plays: 30, playsCorrect: 30 }) } }),
  ],
  'shoe-perfect-bets': [
    ctx({ stats: { sessions: [...sessions(1, { plays: 30, betMisses: 1 }), ...sessions(1), ...sessions(1, { rounds: 19, plays: 30 })] } }),
    ctx({ stats: { sessions: sessions(1, { plays: 30 }) } }),
  ],
  'wong-25': [
    ctx({ stats: { categories: { ...EMPTY_STATS.categories, wong: { right: 24, wrong: 9 } } } }),
    ctx({ stats: { categories: { ...EMPTY_STATS.categories, wong: { right: 25, wrong: 0 } } } }),
  ],
  // Wave L (lane v): guided sessions run to the end; absent reads as none.
  'guided-1': [ctx(), ctx({ guided: 1 })],
  'guided-7': [ctx({ guided: 6 }), ctx({ guided: 7 })],
  'casino-1': [ctx({ casino: 0 }), ctx({ casino: 1 })],
  'casino-10': [ctx({ casino: 9 }), ctx({ casino: 10 })],
};

const statusOf = (c: AchievementContext, id: string) => evaluateAchievements(c).find((s) => s.def.id === id)!;

afterEach(() => {
  vi.useRealTimers();
});

describe('achievements', () => {
  it('there are about fifty, with unique ids, and every one has a case below', () => {
    expect(ACHIEVEMENTS.length).toBe(53);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    // `<id>-timed` is a second case for the same achievement.
    expect([...new Set(Object.keys(CASES).map((k) => k.replace(/-timed$/, '')))].sort()).toEqual(ACHIEVEMENTS.map((a) => a.id).sort());
  });

  for (const [caseId, [below, at]] of Object.entries(CASES)) {
    const id = caseId.replace(/-timed$/, '');
    it(`${caseId}: just short is not earned, with partial progress; the threshold earns it`, () => {
      const b = statusOf(below, id);
      expect(b.earned).toBe(false);
      expect(b.fraction).toBeLessThan(1);
      const a = statusOf(at, id);
      expect(a.earned).toBe(true);
      expect(a.fraction).toBe(1);
    });
  }

  it('progress is proportional', () => {
    expect(statusOf(ctx({ progress: { answersTotal: 250 } }), 'answers-1000').fraction).toBeCloseTo(0.25);
    const acc = statusOf(ctx({ stats: { latencyHistory: latency('hard', 100, 0) } }), 'accuracy-hard-95');
    expect(acc.fraction).toBeCloseTo(0.495);
    expect(acc.note).toBe(`100% over the last 100`);
    expect(ACCURACY_WINDOW).toBe(200);
    // An index set: the share of its indices at the bar now.
    const set = statusOf(ctx({ stats: { indexRecent: { ...recentFor(i18.slice(0, 10), 19, 1), ...recentFor(i18.slice(10), 18, 2) } } }), 'index-i18-95');
    expect(set.fraction).toBeCloseTo(10 / i18.length);
    expect(set.note).toBe(`10/${i18.length} indices at 19/20`);
  });

  it('the tier bars: 90, 95 and 99% of each window, in whole answers', () => {
    expect(
      MASTERY_TIERS.map(([tier, pct]) => [tier, neededRight(I18_WINDOW, pct), neededRight(FAB4_WINDOW, pct), neededRight(ACCURACY_WINDOW, pct)]),
    ).toEqual([
      ['bronze', 18, 45, 180],
      ['silver', 19, 48, 190],
      ['gold', 20, 50, 198],
    ]);
    expect([I18_WINDOW, FAB4_WINDOW, RECENT_DAYS]).toEqual([20, 50, 180]);
    // The store keeps the longest window plus Wrong tap's spare.
    expect(INDEX_RECENT_KEEP).toBe(Math.max(I18_WINDOW, FAB4_WINDOW) + WINDOW_SPARE);
  });

  it('an index window: 20 recent answers or it does not qualify; older and undated ones do not count', () => {
    const earned = (e: IndexRecentEntry, nowMs = NOW) =>
      statusOf(ctx({ stats: { indexRecent: { ...recentFor(i18, 20, 0), [i18[0]!]: e } }, nowMs }), 'index-i18-90').earned;
    expect(earned(entry('1'.repeat(19)))).toBe(false);
    expect(earned(entry('1'.repeat(20)))).toBe(true);
    // Twenty right after wrong ones the window has moved past.
    expect(earned(entry('0'.repeat(30) + '1'.repeat(20)))).toBe(true);
    // The 20th-last answer 180 days old is out (19 recent); 179 days old is in.
    const aged = (daysAgo: number): IndexRecentEntry => ({ recent: '1'.repeat(20), days: [addDays(TODAY, -daysAgo), ...Array(19).fill(TODAY)] });
    expect(earned(aged(RECENT_DAYS))).toBe(false);
    expect(earned(aged(RECENT_DAYS - 1))).toBe(true);
    // Wrong answers older than the 180 days do not hold a recent twenty back.
    expect(earned({ recent: '0'.repeat(5) + '1'.repeat(20), days: [...Array(5).fill(addDays(TODAY, -400)), ...Array(20).fill(TODAY)] })).toBe(true);
    // An undated answer is not recent.
    expect(earned({ recent: '1'.repeat(20), days: [...Array(19).fill(TODAY), ''] })).toBe(false);
    // The same twenty, judged 180 days later, are no longer recent.
    expect(earned(entry('1'.repeat(20)), NOW + RECENT_DAYS * DAY)).toBe(false);
    expect(earned(entry('1'.repeat(20)), NOW + (RECENT_DAYS - 1) * DAY)).toBe(true);
    // Out-of-step arrays (a hand-edited blob) are read from the end, where they pair up.
    expect(earned({ recent: '0000' + '1'.repeat(20), days: Array(20).fill(TODAY) })).toBe(true);
    expect(earned({ recent: '1'.repeat(20), days: Array(19).fill(TODAY) })).toBe(false);
  });

  it('each window is read once per context, not once per tier', () => {
    const c = ctx({ stats: { indexRecent: i18At(19), latencyHistory: latency('hard', 200, 0) } });
    const parse = vi.spyOn(Date, 'parse');
    evaluateAchievements(c);
    const first = parse.mock.calls.length;
    parse.mockRestore();
    // One pass: the 17 windows of 20 (I18), at most 200 hand rows per type, the Fab 4 (empty).
    expect(first).toBeLessThanOrEqual(i18.length * I18_WINDOW + ACCURACY_WINDOW * 3);
    expect(first).toBeGreaterThanOrEqual(i18.length * I18_WINDOW + ACCURACY_WINDOW);
  });

  it('a corrupt index store reads as none, never a throw', () => {
    for (const indexRecent of [null, 'junk', 7, { [i18[0]!]: null }, { [i18[0]!]: { recent: 5, days: null } }, { [i18[0]!]: { recent: '1'.repeat(20), days: 'x' } }]) {
      const s = statusOf(ctx({ stats: { indexRecent: { ...recentFor(i18.slice(1), 20, 0), ...(indexRecent as object) } as Stats['indexRecent'] } }), 'index-i18-90');
      expect(s.earned).toBe(false);
    }
    for (const indexRecent of [null, 'junk', 7]) {
      const s = statusOf(ctx({ stats: { indexRecent: indexRecent as unknown as Stats['indexRecent'] } }), 'index-i18-90');
      expect(s.note).toBe(`0/${i18.length} indices at 18/20`);
    }
  });

  it('the tiers only rise: whatever a moment earns, it earns every tier below', () => {
    const moments = [
      ...[17, 18, 19, 20].map((r) => ctx({ stats: { indexRecent: i18At(r) } })),
      ...[44, 45, 47, 48, 49, 50].map((r) => ctx({ stats: { indexRecent: recentFor(fabH17, r, FAB4_WINDOW - r) } })),
      ...[179, 180, 189, 190, 197, 198, 200].map((r) => ctx({ stats: { latencyHistory: latency('soft', r, 200 - r) } })),
    ];
    const ladders = [...new Set(ACHIEVEMENTS.flatMap((a) => (a.ladder ? [a.ladder.id] : [])))];
    expect(ladders).toEqual(['accuracy-hard', 'accuracy-soft', 'accuracy-pairs', 'index-i18', 'index-fab4']);
    const seen = new Set<string>();
    for (const c of moments) {
      const st = evaluateAchievements(c);
      for (const l of ladders) {
        const tiers = st.filter((x) => x.def.ladder?.id === l);
        expect(tiers.map((x) => x.def.tier)).toEqual(['bronze', 'silver', 'gold']);
        const earned = tiers.map((x) => x.earned);
        expect(earned).toEqual([...earned].sort((a, b) => Number(b) - Number(a)));
        seen.add(earned.join());
      }
    }
    // Every step of the ladder was actually reached by some moment above.
    expect([...seen].sort()).toEqual(['false,false,false', 'true,false,false', 'true,true,false', 'true,true,true']);
  });

  it('carries over earns stored under the old ids, dated, and never re-earns them', () => {
    const c = ctx({
      progress: { earned: { 'index-i18': '2026-09-01T00:00:00.000Z', 'index-fab4': '', 'accuracy-hard': '2026-08-01T00:00:00.000Z' } },
    });
    const s = (id: string) => statusOf(c, id);
    expect([s('index-i18-90').earned, s('index-i18-90').earnedAt]).toEqual([true, '2026-09-01T00:00:00.000Z']);
    expect([s('index-fab4-90').earned, s('index-fab4-90').earnedAt]).toEqual([true, '']);
    expect([s('index-i18-95').earned, s('index-fab4-95').earned]).toEqual([false, false]);
    // The old "sharp" was 95% over 200: silver now, and bronze came with it.
    expect([s('accuracy-hard-95').earned, s('accuracy-hard-95').earnedAt]).toEqual([true, '2026-08-01T00:00:00.000Z']);
    expect([s('accuracy-hard-90').earned, s('accuracy-hard-90').earnedAt]).toEqual([true, '2026-08-01T00:00:00.000Z']);
    expect([s('accuracy-hard-99').earned, s('accuracy-soft-95').earned]).toEqual([false, false]);
    expect(newlyEarned(c)).toEqual([]);
    expect(Object.values(LEGACY_IDS).sort()).toEqual(['accuracy-hard', 'accuracy-pairs', 'accuracy-soft', 'index-fab4', 'index-i18']);
    for (const id of Object.keys(LEGACY_IDS)) expect(ACHIEVEMENTS.some((a) => a.id === id)).toBe(true);
  });

  it('a stored higher tier carries the lower ones, dated by it; a tier stored itself keeps its own date', () => {
    const c = ctx({ progress: { earned: { 'index-i18-99': '2026-10-20T00:00:00.000Z', 'index-i18-90': '2026-10-01T00:00:00.000Z' } } });
    expect(statusOf(c, 'index-i18-90').earnedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(statusOf(c, 'index-i18-95').earnedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(statusOf(c, 'index-i18-99').earnedAt).toBe('2026-10-20T00:00:00.000Z');
    expect(newlyEarned(c)).toEqual([]);
    // Crossing gold from nothing earns all three at once.
    expect(newlyEarned(ctx({ stats: { indexRecent: i18At(20) } })).filter((id) => id.startsWith('index-i18'))).toEqual([
      'index-i18-90',
      'index-i18-95',
      'index-i18-99',
    ]);
  });

  it('judged at ctx.nowMs, never the wall clock: the same context earns the same', () => {
    const c = ctx({ stats: { indexRecent: i18At(19), latencyHistory: latency('hard', 200, 0) } });
    const first = newlyEarned(c);
    expect(first).toEqual(expect.arrayContaining(['index-i18-95', 'accuracy-hard-99']));
    expect(first).not.toContain('index-i18-99');
    vi.useFakeTimers();
    vi.setSystemTime(NOW + 365 * DAY);
    // A copy, so nothing worked out for `c` is reused.
    expect(newlyEarned({ ...c })).toEqual(first);
    vi.useRealTimers();
    // A year on BY THE CONTEXT, none of those answers is recent any more.
    expect(newlyEarned({ ...c, nowMs: NOW + 365 * DAY }).filter((id) => /^(index|accuracy)-/.test(id))).toEqual([]);
  });

  it('a stored earn stays earned even when the measure falls back', () => {
    const c = ctx({ progress: { earned: { 'answers-100': '2026-10-01T00:00:00.000Z' } } });
    const s = statusOf(c, 'answers-100');
    expect(s.earned).toBe(true);
    expect(s.earnedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(newlyEarned(c)).not.toContain('answers-100');
    // A tier stays earned once its answers have aged out of the window.
    const aged = ctx({ stats: { indexRecent: i18At(20) }, progress: { earned: { 'index-i18-99': '2026-10-21T00:00:00.000Z' } }, nowMs: NOW + 400 * DAY });
    expect(statusOf(aged, 'index-i18-99').fraction).toBe(1);
    expect(['index-i18-90', 'index-i18-95', 'index-i18-99'].map((id) => statusOf(aged, id).earned)).toEqual([true, true, true]);
  });

  it('backfill dates streak achievements by the day the length was reached', () => {
    const c = ctx({ progress: { days: metRun(8, '2026-10-10') } });
    expect(backfillDate('streak-3', c.streak)).toBe('2026-10-05');
    expect(backfillDate('streak-7', c.streak)).toBe('2026-10-09');
    expect(backfillDate('answers-100', c.streak)).toBe('');
  });
});

// C13 (audit 2026-10-29): index-only answers stay out of the hand window.
describe('hand accuracy leaves index-only answers out (C13)', () => {
  it('200 right Deviation-quiz answers do not earn Hard hands sharp', () => {
    const a = ACHIEVEMENTS.find((x) => x.id === 'accuracy-hard-90')!;
    const indexOnly = latency('hard', 200, 0).map((r) => ({ ...r, indexOnly: true as const }));
    expect(a.measure(ctx({ stats: { latencyHistory: indexOnly } })).value).toBe(0);
    expect(a.measure(ctx({ stats: { latencyHistory: latency('hard', 200, 0) } })).value).toBeGreaterThan(0);
  });
});
