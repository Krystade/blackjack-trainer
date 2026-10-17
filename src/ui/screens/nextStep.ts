import type { Stats } from '../../store/types';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';
import { hydrateMasteryRun, isMasteryRunComplete } from '../../drills/masteryChallenge';
import type { MasteryRun, PersistedMasteryRun } from '../../drills/masteryChallenge';
import { generateAllCells } from '../../drills/flashcards';
import { CATEGORY_TARGET, MIN_CATEGORY_ANSWERS, WEAK_CELL_BELOW, handCategoryProgress, pctDown, weakCells } from './handProgress';
import type { HandCategoryProgress, WeakCell } from './handProgress';
import type { HandScope } from '../../drills/handScope';

/**
 * #28: the ONE thing Home recommends next, and why. The first step in this
 * list that is not yet done wins:
 *
 *  1. flash   -- Learn basic strategy: until hard, soft and pairs are each
 *                at >= 90% over at least MIN_CATEGORY_ANSWERS answers.
 *                (s07: a category below 90% whose misses sit mostly in a few
 *                weak cells goes to step 2's Custom instead.)
 *  2. custom  -- Fix weak cells (Custom with Auto): any cell with at least
 *                MIN_CELL_ANSWERS answers below 78%.
 *  3. mastery -- a Mastery sweep, until one has been completed.
 *  4. quiz    -- Deviations: until every active index has at least
 *                MIN_INDEX_ANSWERS answers and they are >= 90% together.
 *  5. count   -- Counting: until COUNT_RUNS_JUDGED count runs have been done
 *                and at least COUNT_RUNS_NEEDED of the last ones were right.
 *  6. play    -- Play a shoe.
 *
 * Per-cell figures are B3's cellStats (every hand drill and Play), so a
 * category here is the sum of its cells, not the older per-category tally.
 * W3: categories and cells are judged on their recent answers (see
 * handProgress.ts), so a mistake made while learning ages out.
 * Pure: the caller supplies whether a sweep is complete.
 */
export type NextStepKind = 'flash' | 'custom' | 'mastery' | 'quiz' | 'count' | 'play';

export interface NextStep {
  kind: NextStepKind;
  title: string;
  why: string;
  /**
   * F21: the hand type a 'flash' step is about, so Start opens Flashcards on
   * it rather than on whatever scope was saved last. Absent = the whole chart.
   */
  scope?: HandScope;
  /**
   * s02: the three basic-strategy categories against the goal, shown on the
   * card while the step is about them ('flash'), so progress and a met goal
   * are visible on Home.
   */
  progress?: HandCategoryProgress[];
}

// W3: the category and cell thresholds live with the shared figures Home and
// Stats both read; re-exported here for the callers that already import them.
export { MIN_CATEGORY_ANSWERS, CATEGORY_TARGET, MIN_CELL_ANSWERS, WEAK_CELL_BELOW } from './handProgress';
export const MIN_INDEX_ANSWERS = 3;
export const INDEX_TARGET = 0.9;
export const COUNT_RUNS_JUDGED = 5;
export const COUNT_RUNS_NEEDED = 4;

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

/** The "Fix weak cells" step for `weak` (worst first), its reason led by `lead`. */
function weakCellsStep(weak: readonly WeakCell[], lead: string, progress?: HandCategoryProgress[]): NextStep {
  const w = weak[0]!;
  const more = weak.length > 1 ? ` and ${weak.length - 1} more cell${weak.length > 2 ? 's' : ''}` : '';
  return {
    kind: 'custom',
    title: 'Fix weak cells',
    why: `${lead}${cellLabel(w.id)}${lead ? '' : ' is'} at ${pctDown(w.pct)}%${more} below ${pctDown(WEAK_CELL_BELOW)}%. Custom with Auto drills them most.`,
    ...(progress ? { progress } : {}),
  };
}

export function nextStep(stats: Stats, opts: { sweepDone: boolean }): NextStep {
  // 1. Basic strategy, category by category (W3: judged on the recent
  // window, see handProgress). Too few answers to judge comes first: it is
  // the reason the percentage cannot be trusted yet.
  const cats = handCategoryProgress(stats);
  const thin = cats.filter((c) => c.thin).sort((a, b) => a.n - b.n)[0];
  if (thin) {
    return {
      kind: 'flash',
      title: 'Learn basic strategy',
      why: `${thin.label}: ${thin.n} answer${thin.n === 1 ? '' : 's'} so far, ${MIN_CATEGORY_ANSWERS} needed to judge. Get every category to ${pctDown(CATEGORY_TARGET)}%.`,
      scope: thin.scope,
      progress: cats,
    };
  }
  const low = cats.filter((c) => c.pct < CATEGORY_TARGET).sort((a, b) => a.pct - b.pct)[0];
  // s07: a weakness CONCENTRATED in a few cells keeps its category under 90%
  // for good while the rest is known, and more of the whole category is the
  // wrong drill for it. When cells judged weak (on as few as
  // MIN_CELL_ANSWERS_IN_LOW_CATEGORY answers) hold at least half of the
  // category's misses, send them to Custom with Auto instead.
  if (low) {
    const lowWeak = weakCells(stats, { prefix: low.prefix, minAnswers: MIN_CELL_ANSWERS_IN_LOW_CATEGORY });
    const cells = stats.cellStats ?? {};
    const missesIn = (ids: readonly string[]) => ids.reduce((n, id) => n + (cells[id]?.wrong ?? 0), 0);
    const categoryMisses = missesIn(Object.keys(cells).filter((id) => id.startsWith(`${low.prefix}-`)));
    if (lowWeak.length > 0 && missesIn(lowWeak.map((w) => w.id)) * 2 >= categoryMisses) {
      return weakCellsStep(lowWeak, `${low.label} are at ${pctDown(low.pct)}%, mostly from `, cats);
    }
  }
  if (low) {
    return {
      kind: 'flash',
      title: 'Learn basic strategy',
      why: `${low.label} are at ${pctDown(low.pct)}%${low.recent ? ` over your last ${low.judgedN}` : ''}; get every category to ${pctDown(CATEGORY_TARGET)}%.`,
      scope: low.scope,
      progress: cats,
    };
  }

  // 2. Weak cells, worst first (W3: judged on each cell's recent answers).
  const weak = weakCells(stats);
  if (weak.length > 0) return weakCellsStep(weak, '');

  // 3. A full sweep proves it with no misses in a row.
  if (!opts.sweepDone) {
    return {
      kind: 'mastery',
      title: 'Mastery sweep',
      why: `Every category is at ${pctDown(CATEGORY_TARGET)}% or better. Now answer every cell once without a miss.`,
    };
  }

  // 4. Deviations.
  const active = ILLUSTRIOUS_18.filter((d) => d.active);
  const unpractised = active.filter((d) => {
    const t = stats.perIndex[d.id];
    return (t?.right ?? 0) + (t?.wrong ?? 0) < MIN_INDEX_ANSWERS;
  });
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
  const ipct = ir / (ir + iw);
  if (ipct < INDEX_TARGET) {
    return {
      kind: 'quiz',
      title: 'Learn the deviations',
      why: `The deviation quiz is at ${pctDown(ipct)}%; get it to ${pctDown(INDEX_TARGET)}%.`,
    };
  }

  // 5. Counting.
  const runs = stats.countDrill.history.slice(-COUNT_RUNS_JUDGED);
  const right = runs.filter((r) => r.correct).length;
  if (runs.length < COUNT_RUNS_JUDGED || right < COUNT_RUNS_NEEDED) {
    return {
      kind: 'count',
      title: 'Practise counting',
      why:
        runs.length < COUNT_RUNS_JUDGED
          ? `${runs.length} of ${COUNT_RUNS_JUDGED} count drill runs done.`
          : `${right} of your last ${COUNT_RUNS_JUDGED} count runs were right; aim for ${COUNT_RUNS_NEEDED}.`,
    };
  }

  // 6. Everything above is in hand.
  return {
    kind: 'play',
    title: 'Play a shoe',
    why: 'Strategy, deviations and counting are all on target. Put them together at the table.',
  };
}
