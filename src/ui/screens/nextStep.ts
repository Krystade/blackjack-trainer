import type { Stats } from '../../store/types';
import { hydrateMasteryRun, isMasteryRunComplete } from '../../drills/masteryChallenge';
import type { MasteryRun, PersistedMasteryRun } from '../../drills/masteryChallenge';
import { generateAllCells } from '../../drills/flashcards';
import { CATEGORY_TARGET, MIN_CATEGORY_ANSWERS, WEAK_CELL_BELOW, goalPct, handCategoryProgress, pctDown, weakCells } from './handProgress';
import { cellWindow, countBits } from '../../store/cellStats';
import type { HandCategoryProgress, WeakCell } from './handProgress';
import type { HandScope } from '../../drills/handScope';
import { MIN_INDEX_ANSWERS, activeIndices, indexPractised } from './readiness';
import { COUNT_RUNS_JUDGED, COUNT_RUNS_NEEDED, countFluency } from '../../drills/fluencyGate';
import type { IndexRules } from './readiness';
import type { SrDeck } from '../../drills/spacedRepetition';
import { PLAY_MIN_GRADED, REVIEW_DUE_MIN, betRampResult, deckTcResult, dueForReview, playResult, stalestSkill } from './ladderRules';

const DAY = 86_400_000;

/**
 * #28 / B2: the ONE thing Home recommends next, and why, read off a ladder of
 * seven rungs in casino order. Each rung's pass rule is judged on its own (a
 * later rung can be met while an earlier one is current); the current rung is
 * the first one not passed, and its card is the step.
 *
 *  1. basic      -- hard, soft and pairs each at >= 90% over at least
 *                   MIN_CATEGORY_ANSWERS answers (W3: the recent window).
 *                   s07: a low category whose misses sit mostly in a few weak
 *                   cells goes to Custom instead.
 *  2. repair     -- no weak cells (Custom with Auto) and a whole-chart Mastery
 *                   sweep completed.
 *  3. count      -- COUNT_RUNS_NEEDED of the last COUNT_RUNS_JUDGED paced,
 *                   deck-long runs right (F15: drills/fluencyGate.ts).
 *  4. tc         -- deck estimation and the true count drill each at
 *                   DRILL_WINDOW_NEEDED of the last DRILL_WINDOW (ladderRules.ts).
 *  5. deviations -- every active index at MIN_INDEX_ANSWERS answers and
 *                   INDEX_TARGET together.
 *  6. betramp    -- bet sizing at DRILL_WINDOW_NEEDED of the last DRILL_WINDOW.
 *  7. play       -- one of the last PLAY_SESSIONS_JUDGED sessions has
 *                   PLAY_MIN_GRADED+ graded decisions at PLAY_TARGET.
 *
 * Per-cell figures are B3's cellStats, judged on their recent answers (W3).
 * Pure: the caller supplies whether a sweep is complete.
 */
export type NextStepKind =
  | 'flash'
  | 'custom'
  | 'mastery'
  | 'quiz'
  | 'count'
  | 'deckest'
  | 'truecount'
  | 'betsizing'
  | 'play';
export type RungId = 'basic' | 'repair' | 'count' | 'tc' | 'deviations' | 'betramp' | 'play';

export const RUNG_LABELS: Record<RungId, string> = {
  basic: 'Basic strategy',
  repair: 'Weak cells and a full sweep',
  count: 'Running count at table pace',
  tc: 'Deck estimation and true count',
  deviations: 'Deviations',
  betramp: 'Bet ramp',
  play: 'Play a shoe',
};

export interface StartTarget {
  kind: NextStepKind;
  /**
   * F21: the hand type a 'flash' step is about, so Start opens Flashcards on
   * it rather than on whatever scope was saved last. Absent = the whole chart.
   */
  scope?: HandScope;
}

export interface RungResult {
  id: RungId;
  label: string;
  passed: boolean;
  progress: string;
  start: StartTarget;
}

export type CardKind = 'rung' | 'review' | 'stale';

export interface NextStep extends StartTarget {
  card: CardKind;
  title: string;
  why: string;
  /**
   * s02: the three basic-strategy categories against the goal, on every step,
   * so Home shows progress while one is short and confirms the goal once all
   * three are met (every later step has them all on target).
   */
  progress?: HandCategoryProgress[];
  reviewCells?: string[];
}

export interface Ladder {
  rungs: RungResult[];
  current: number | null;
  step: NextStep;
}

export interface LadderContext {
  sweepDone: boolean;
  /** F11: the active profile's graded rules, so the deviations rung counts its own index set. */
  rules?: IndexRules;
  flashSr?: SrDeck;
  quizSr?: SrDeck;
  now?: number;
}

// W3: the category and cell thresholds live with the shared figures Home and
// Stats both read; re-exported here for the callers that already import them.
export { MIN_CATEGORY_ANSWERS, CATEGORY_TARGET, MIN_CELL_ANSWERS, WEAK_CELL_BELOW } from './handProgress';
export { MIN_INDEX_ANSWERS } from './readiness';
export const INDEX_TARGET = 0.9;
// F15: one counting-fluency rule, shared with the Drills picker.
export { COUNT_RUNS_JUDGED, COUNT_RUNS_NEEDED } from '../../drills/fluencyGate';

/**
 * Whether the saved Mastery run is a finished sweep of the WHOLE chart. Only
 * the current run is stored, so a finished sweep stops counting once a new
 * one is started; a sweep of one scope (hard only, say) does not count.
 */
export function masterySweepDone(saved: PersistedMasteryRun | null): boolean {
  const run = hydrateMasteryRun(saved);
  return run ? isWholeChartSweep(run) : false;
}

/** A finished run that covered every chart cell. */
export function isWholeChartSweep(run: MasteryRun): boolean {
  if (!isMasteryRunComplete(run)) return false;
  const all = generateAllCells().map((c) => c.id);
  const inRun = new Set(run.order);
  return all.length === inRun.size && all.every((id) => inRun.has(id));
}

/** "hard-16-v-10" -> "Hard 16 v 10"; "pair-8-v-A" -> "8,8 v A". */
export function cellLabel(id: string): string {
  const m = /^(hard|soft|pair)-([0-9]+|A)-v-([0-9]+|A)$/.exec(id);
  if (!m) return id;
  const [, kind, row, up] = m;
  if (kind === 'pair') return `${row},${row} v ${up}`;
  return `${kind === 'hard' ? 'Hard' : 'Soft'} ${row} v ${up}`;
}

/** s07: cells judged weak inside a category that is below target need only this many answers. */
export const MIN_CELL_ANSWERS_IN_LOW_CATEGORY = 3;

/**
 * s07: whether `weak` (cells of a category below target) hold at least half
 * of the category's misses. Both sides count misses from the same kind of
 * figure the category is judged on: the recent windows (each weak cell's last
 * CELL_WINDOW against the category's last HAND_WINDOW) when the category is
 * judged on its window, else the lifetime tallies. Mixing the two let a
 * learner's early, spread-out misses -- which never age out of a lifetime
 * sum -- hide a weakness that sits in two cells now. A cell's window can
 * reach back past the category's, so this leans towards Fix weak cells; the
 * cells it names are weak on their own recent answers either way.
 */
function holdsHalfTheMisses(stats: Stats, low: HandCategoryProgress, weak: readonly WeakCell[]): boolean {
  const cells = stats.cellStats ?? {};
  const missesIn = (id: string) => (low.recent ? countBits(cellWindow(cells[id])).wrong : (cells[id]?.wrong ?? 0));
  const weakMisses = weak.reduce((n, w) => n + missesIn(w.id), 0);
  return weakMisses * 2 >= low.judgedN - low.judgedRight;
}

/** A rung's card while it fails: title, reason and Start target. */
type Card = StartTarget & { title: string; why: string };

/** The "Fix weak cells" card for `weak` (worst first), its reason led by `lead`. */
function weakCellsCard(weak: readonly WeakCell[], lead: string): Card {
  const w = weak[0]!;
  const more = weak.length > 1 ? ` and ${weak.length - 1} more cell${weak.length > 2 ? 's' : ''}` : '';
  return {
    kind: 'custom',
    title: 'Fix weak cells',
    why: `${lead}${cellLabel(w.id)}${lead ? '' : ' is'} at ${goalPct(w.pct)}${more} below ${pctDown(WEAK_CELL_BELOW)}%. Custom with Auto drills them most.`,
  };
}

/** Rung 1: basic strategy, category by category; null once every category is on target. */
function basicCard(stats: Stats, cats: HandCategoryProgress[]): Card | null {
  // Too few answers to judge comes first: it is the reason the percentage
  // cannot be trusted yet.
  const thin = cats.filter((c) => c.thin).sort((a, b) => a.n - b.n)[0];
  if (thin) {
    // cellStats has no backfill: a returning user's older answers are in the
    // category tally only, so "so far" would be false for them.
    const since = thin.legacy ? 'since per-hand tracking began' : 'so far';
    return {
      kind: 'flash',
      title: 'Learn basic strategy',
      why: `${thin.label}: ${thin.n} answer${thin.n === 1 ? '' : 's'} ${since}, ${MIN_CATEGORY_ANSWERS} needed to judge. Get every category to ${pctDown(CATEGORY_TARGET)}%.`,
      scope: thin.scope,
    };
  }
  const low = cats.filter((c) => c.pct < CATEGORY_TARGET).sort((a, b) => a.pct - b.pct)[0];
  if (!low) return null;
  // s07: a weakness CONCENTRATED in a few cells keeps its category under 90%
  // for good while the rest is known, and more of the whole category is the
  // wrong drill for it. When cells judged weak (on as few as
  // MIN_CELL_ANSWERS_IN_LOW_CATEGORY answers) hold at least half of the
  // category's misses, send them to Custom with Auto instead.
  const lowWeak = weakCells(stats, { prefix: low.prefix, minAnswers: MIN_CELL_ANSWERS_IN_LOW_CATEGORY });
  if (lowWeak.length > 0 && holdsHalfTheMisses(stats, low, lowWeak)) {
    return weakCellsCard(lowWeak, `${low.label} are at ${goalPct(low.pct)}, mostly from `);
  }
  return {
    kind: 'flash',
    title: 'Learn basic strategy',
    why: `${low.label} are at ${goalPct(low.pct)}${low.recent ? ` over your last ${low.judgedN}` : ''}; get every category to ${pctDown(CATEGORY_TARGET)}%.`,
    scope: low.scope,
  };
}

/** Rung 2: weak cells (worst first), then a full sweep with no misses. */
function repairCard(weak: readonly WeakCell[], sweepDone: boolean): Card | null {
  if (weak.length > 0) return weakCellsCard(weak, '');
  if (!sweepDone) {
    return {
      kind: 'mastery',
      title: 'Mastery sweep',
      why: `Every category is at ${pctDown(CATEGORY_TARGET)}% or better. Now answer every cell once without a miss.`,
    };
  }
  return null;
}

/** Rung 5: deviations (the Wave A rule, unchanged). */
function deviationsCard(stats: Stats, rules?: IndexRules): Card | null {
  const active = activeIndices(rules);
  const unpractised = active.filter((d) => !indexPractised(stats, d.id));
  if (unpractised.length > 0) {
    return {
      kind: 'quiz',
      title: 'Learn the deviations',
      why: `${unpractised.length} of ${active.length} indices have fewer than ${MIN_INDEX_ANSWERS} answers.`,
    };
  }
  let ir = 0;
  let iw = 0;
  for (const d of active) {
    ir += stats.perIndex[d.id]?.right ?? 0;
    iw += stats.perIndex[d.id]?.wrong ?? 0;
  }
  const ipct = ir + iw > 0 ? ir / (ir + iw) : 1;
  if (ipct < INDEX_TARGET) {
    return {
      kind: 'quiz',
      title: 'Learn the deviations',
      why: `The deviation quiz is at ${goalPct(ipct)}; get it to ${pctDown(INDEX_TARGET)}%.`,
    };
  }
  return null;
}

/** Rung 4's reason for one of its two drills. */
function windowWhy(name: string, judged: number, right: number): string {
  return judged < 10
    ? `${judged} of 10 ${name.toLowerCase()} answers so far.`
    : `${name}: ${right} of your last ${judged} right; aim for 8 of 10.`;
}

interface RungDraft {
  id: RungId;
  card: Card | null;
  progress: string;
  /** Where Start goes once the rung is passed. */
  passedStart: StartTarget;
}

export function ladder(stats: Stats, ctx: LadderContext): Ladder {
  const cats = handCategoryProgress(stats);
  const weak = weakCells(stats);
  const fluency = countFluency(stats.countDrill?.history ?? []);
  const dt = deckTcResult(stats);
  const bets = betRampResult(stats);
  const play = playResult(stats);
  const active = activeIndices(ctx.rules);
  // Wave B2 #10: the same figure as Home's readiness tile.
  const practised = active.filter((d) => indexPractised(stats, d.id)).length;

  const playCard: Card = {
    kind: 'play',
    title: 'Play a shoe',
    why: `Strategy, counting, deviations and the bet ramp are on target. Play a shoe: ${PLAY_MIN_GRADED}+ decisions at 90%.`,
  };

  const drafts: RungDraft[] = [
    {
      id: 'basic',
      card: basicCard(stats, cats),
      progress: `${cats.filter((c) => c.onTarget).length}/${cats.length} categories on target`,
      passedStart: { kind: 'flash' },
    },
    {
      id: 'repair',
      card: repairCard(weak, ctx.sweepDone),
      progress: `${weak.length === 0 ? 'No weak cells' : `${weak.length} weak cell${weak.length === 1 ? '' : 's'}`} · ${ctx.sweepDone ? 'sweep done' : 'no full sweep yet'}`,
      passedStart: { kind: 'mastery' },
    },
    {
      // F15: the same rule as the Drills picker's fluency nudge.
      id: 'count',
      card: fluency.fluent
        ? null
        : {
            kind: 'count',
            title: 'Practise counting',
            why:
              fluency.judged < COUNT_RUNS_JUDGED
                ? `${fluency.judged} of ${COUNT_RUNS_JUDGED} count drill runs done (dealt at a set pace, a deck or more).`
                : `${fluency.right} of your last ${COUNT_RUNS_JUDGED} count runs were right; aim for ${COUNT_RUNS_NEEDED}.`,
          },
      progress:
        fluency.judged < COUNT_RUNS_JUDGED
          ? `${fluency.judged}/${COUNT_RUNS_JUDGED} paced deck runs`
          : `${fluency.right}/${COUNT_RUNS_JUDGED} right (need ${COUNT_RUNS_NEEDED})`,
      passedStart: { kind: 'count' },
    },
    {
      id: 'tc',
      card: dt.passed
        ? null
        : !dt.deck.passed
          ? { kind: 'deckest', title: 'Deck estimation and true count', why: windowWhy('Deck estimation', dt.deck.judged, dt.deck.right) }
          : { kind: 'truecount', title: 'Deck estimation and true count', why: windowWhy('True count drill', dt.tc.judged, dt.tc.right) },
      progress: `Decks ${dt.deck.right}/${dt.deck.judged} · TC ${dt.tc.right}/${dt.tc.judged} (need 8/10 each)`,
      passedStart: { kind: 'deckest' },
    },
    {
      id: 'deviations',
      card: deviationsCard(stats, ctx.rules),
      progress: `${practised}/${active.length} indices practised`,
      passedStart: { kind: 'quiz' },
    },
    {
      id: 'betramp',
      card: bets.passed
        ? null
        : {
            kind: 'betsizing',
            title: 'Bet ramp',
            why:
              bets.judged < 10
                ? `Size bets from the count: ${bets.judged} of 10 answers so far.`
                : `Bet sizing: ${bets.right} of your last ${bets.judged} right; aim for 8 of 10.`,
          },
      progress: bets.judged === 0 ? 'No bet sizing answers yet' : `${bets.right}/${bets.judged} right (need 8/10)`,
      passedStart: { kind: 'betsizing' },
    },
    {
      id: 'play',
      card: play.passed ? null : playCard,
      progress: play.best ? `Best recent: ${play.best.correct}/${play.best.graded} graded` : 'No sessions yet',
      passedStart: { kind: 'play' },
    },
  ];

  const rungs: RungResult[] = drafts.map((d) => ({
    id: d.id,
    label: RUNG_LABELS[d.id],
    passed: d.card === null,
    progress: d.progress,
    start: d.card ? { kind: d.card.kind, ...(d.card.scope ? { scope: d.card.scope } : {}) } : d.passedStart,
  }));
  const first = rungs.findIndex((r) => !r.passed);
  const current = first === -1 ? null : first;
  const now = ctx.now ?? Date.now();
  const activeIds = active.map((d) => d.id);
  const flashSr = ctx.flashSr ?? {};
  const quizSr = ctx.quizSr ?? {};
  // s02: every step carries the three categories.
  // W2: first match wins -- Review (once strategy is in hand), the rung, the stalest skill.
  const due = dueForReview(flashSr, quizSr, activeIds, now);
  if ((current === null || current >= 2) && due.total >= REVIEW_DUE_MIN) {
    const flash = due.cells.length >= due.indexes.length;
    return {
      rungs,
      current,
      step: {
        card: 'review',
        kind: flash ? 'flash' : 'quiz',
        title: `Review ${due.total} due`,
        why: `${due.cells.length} cells and ${due.indexes.length} indexes are due for review. Start reviews the ${flash ? 'cells' : 'indexes'}.`,
        progress: cats,
        ...(flash ? { reviewCells: due.cells } : {}),
      },
    };
  }
  if (current !== null) return { rungs, current, step: { card: 'rung', ...drafts[current]!.card!, progress: cats } };
  const stale = stalestSkill(stats, quizSr, activeIds);
  const days = Math.max(0, Math.floor((now - stale.lastAt) / DAY));
  const ago = days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  return {
    rungs,
    current,
    step: {
      card: 'stale',
      kind: stale.kind,
      title: `Keep it fresh: ${stale.label}`,
      why: stale.lastAt === 0
        ? `Every rung is done. ${stale.label} has not been practised yet.`
        : `Every rung is done. ${stale.label} was practised longest ago (${ago}).`,
      progress: cats,
    },
  };
}

export function nextStep(stats: Stats, ctx: LadderContext): NextStep {
  return ladder(stats, ctx).step;
}
