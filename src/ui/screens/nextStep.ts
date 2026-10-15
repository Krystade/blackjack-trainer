import type { Stats } from '../../store/types';
import { ILLUSTRIOUS_18 } from '../../engine/deviations';
import { hydrateMasteryRun, isMasteryRunComplete } from '../../drills/masteryChallenge';
import type { PersistedMasteryRun } from '../../drills/masteryChallenge';
import { generateAllCells } from '../../drills/flashcards';

/**
 * #28: the ONE thing Home recommends next, and why. The first step in this
 * list that is not yet done wins:
 *
 *  1. flash   -- Learn basic strategy: until hard, soft and pairs are each
 *                at >= 90% over at least MIN_CATEGORY_ANSWERS answers.
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
 * Pure: the caller supplies whether a sweep is complete.
 */
export type NextStepKind = 'flash' | 'custom' | 'mastery' | 'quiz' | 'count' | 'play';

export interface NextStep {
  kind: NextStepKind;
  title: string;
  why: string;
}

export const MIN_CATEGORY_ANSWERS = 20;
export const CATEGORY_TARGET = 0.9;
export const MIN_CELL_ANSWERS = 5;
export const WEAK_CELL_BELOW = 0.78;
export const MIN_INDEX_ANSWERS = 3;
export const INDEX_TARGET = 0.9;
export const COUNT_RUNS_JUDGED = 5;
export const COUNT_RUNS_NEEDED = 4;

const HAND_CATEGORIES = [
  { prefix: 'hard', label: 'Hard totals' },
  { prefix: 'soft', label: 'Soft totals' },
  { prefix: 'pair', label: 'Pairs' },
] as const;

/**
 * Whether the saved Mastery run is a finished sweep of the WHOLE chart. Only
 * the current run is stored, so a finished sweep stops counting once a new
 * one is started; a sweep of one scope (hard only, say) does not count.
 */
export function masterySweepDone(saved: PersistedMasteryRun | null): boolean {
  const run = hydrateMasteryRun(saved);
  if (!run || !isMasteryRunComplete(run)) return false;
  const all = generateAllCells().map((c) => c.id);
  const inRun = new Set(run.order);
  return all.length === inRun.size && all.every((id) => inRun.has(id));
}

/** A whole percent that never rounds a miss up to the target. */
function pctDown(p: number): number {
  return Math.floor(p * 100);
}

/** "hard-16-v-10" -> "Hard 16 v 10"; "pair-8-v-A" -> "8,8 v A". */
export function cellLabel(id: string): string {
  const m = /^(hard|soft|pair)-([0-9]+|A)-v-([0-9]+|A)$/.exec(id);
  if (!m) return id;
  const [, kind, row, up] = m;
  if (kind === 'pair') return `${row},${row} v ${up}`;
  return `${kind === 'hard' ? 'Hard' : 'Soft'} ${row} v ${up}`;
}

export function nextStep(stats: Stats, opts: { sweepDone: boolean }): NextStep {
  const cells = Object.entries(stats.cellStats ?? {});

  // 1. Basic strategy, category by category. Too few answers to judge comes
  // first: it is the reason the percentage cannot be trusted yet.
  const cats = HAND_CATEGORIES.map(({ prefix, label }) => {
    let right = 0;
    let wrong = 0;
    for (const [id, t] of cells) {
      if (id.startsWith(`${prefix}-`)) {
        right += t.right;
        wrong += t.wrong;
      }
    }
    const n = right + wrong;
    return { label, n, pct: n === 0 ? 0 : right / n };
  });
  const thin = cats.filter((c) => c.n < MIN_CATEGORY_ANSWERS).sort((a, b) => a.n - b.n)[0];
  if (thin) {
    return {
      kind: 'flash',
      title: 'Learn basic strategy',
      why: `${thin.label}: ${thin.n} answer${thin.n === 1 ? '' : 's'} so far, ${MIN_CATEGORY_ANSWERS} needed to judge. Get every category to ${pctDown(CATEGORY_TARGET)}%.`,
    };
  }
  const low = cats.filter((c) => c.pct < CATEGORY_TARGET).sort((a, b) => a.pct - b.pct)[0];
  if (low) {
    return {
      kind: 'flash',
      title: 'Learn basic strategy',
      why: `${low.label} are at ${pctDown(low.pct)}%; get every category to ${pctDown(CATEGORY_TARGET)}%.`,
    };
  }

  // 2. Weak cells, worst first.
  const weak = cells
    .map(([id, t]) => ({ id, n: t.right + t.wrong, pct: t.right + t.wrong === 0 ? 1 : t.right / (t.right + t.wrong) }))
    .filter((c) => c.n >= MIN_CELL_ANSWERS && c.pct < WEAK_CELL_BELOW)
    .sort((a, b) => a.pct - b.pct || b.n - a.n || a.id.localeCompare(b.id));
  if (weak.length > 0) {
    const w = weak[0]!;
    const more = weak.length > 1 ? ` and ${weak.length - 1} more cell${weak.length > 2 ? 's' : ''}` : '';
    return {
      kind: 'custom',
      title: 'Fix weak cells',
      why: `${cellLabel(w.id)} is at ${pctDown(w.pct)}%${more} below ${pctDown(WEAK_CELL_BELOW)}%. Custom with Auto drills them most.`,
    };
  }

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
