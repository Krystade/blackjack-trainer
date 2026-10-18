import { getChart } from '../engine/charts';
import type { Action } from '../engine/deviations';
import type { GradedEvent } from '../engine/grade';
import type { RuleSet } from '../engine/ruleset';
import { applyEvents } from '../store/stats';
import { loadStats, saveStats } from '../store/persist';
import { PAINT_SECTIONS, PAINT_UPCARDS, cellIdAt } from './cellSelection';
import type { PaintRow, PaintSection } from './cellSelection';
import { actionAt, familyOf } from './chartFamily';
import { cellCategory, loadFlashSr, saveFlashSr } from './gradeAnswer';
import { reviewCard, SCREEN_CHANNEL } from './spacedRepetition';

/**
 * F12 (W2-21, D3): Charts "Test me" -- a blank chart for the active profile's
 * rules, painted from memory one table at a time, then graded cell by cell.
 *
 * Pure grading plus one recorder. Cells are the painter's (cellSelection.ts),
 * so their ids are the flashcards' ("soft-18-v-9"): a miss here lands on the
 * same spaced-repetition card and the same per-cell tally a missed flashcard
 * does, and Review deals it like any other due cell.
 *
 * GRADED BY FAMILY. The brushes are the five colours of the one palette (F8):
 * hit, stand, double, split, surrender. A Dh and a Ds are both "double"; the
 * fallback letter is the chart's annotation of what to do when the double is
 * not allowed, and a blank-chart recall test asks what the cell IS.
 */

export const TEST_TABLES: readonly { section: PaintSection; title: string; rows: readonly PaintRow[] }[] =
  PAINT_SECTIONS.map((s) => ({ ...s, title: s.section === 'hard' ? 'Hard' : s.section === 'soft' ? 'Soft' : 'Pairs' }));

/** What the learner painted, by cell id. A missing id is an unpainted cell. */
export type PaintedChart = Readonly<Record<string, Action | undefined>>;

export interface GradedCell {
  cellId: string;
  row: PaintRow;
  up: (typeof PAINT_UPCARDS)[number];
  expected: Action;
  painted: Action | undefined;
  correct: boolean;
}

export interface ChartTestResult {
  section: PaintSection;
  title: string;
  cells: GradedCell[];
  right: number;
  total: number;
  /** Cell ids of the misses, in grid order. */
  misses: string[];
}

function tableOf(section: PaintSection) {
  const t = TEST_TABLES.find((x) => x.section === section);
  if (!t) throw new Error(`no chart table ${section}`);
  return t;
}

/** The correct family of every cell of one table, under these rules, in grid order. */
export function expectedTable(rules: RuleSet, section: PaintSection): { cellId: string; row: PaintRow; up: GradedCell['up']; expected: Action }[] {
  const chart = getChart(rules);
  return tableOf(section).rows.flatMap((row) =>
    PAINT_UPCARDS.map((up, col) => ({ cellId: cellIdAt(row, up), row, up, expected: familyOf(actionAt(chart, row, col)) })),
  );
}

/** Every cell id of one table, in grid order. */
export function tableCellIds(section: PaintSection): string[] {
  return tableOf(section).rows.flatMap((row) => PAINT_UPCARDS.map((up) => cellIdAt(row, up)));
}

/**
 * Grade one painted table against the chart for `rules`. An unpainted cell is
 * a miss (the screen only offers Check once every cell is painted, so in
 * practice it never is).
 */
export function gradeChartTest(painted: PaintedChart, rules: RuleSet, section: PaintSection): ChartTestResult {
  const cells = expectedTable(rules, section).map((c) => {
    const p = painted[c.cellId];
    return { ...c, painted: p, correct: p === c.expected };
  });
  const misses = cells.filter((c) => !c.correct).map((c) => c.cellId);
  return {
    section,
    title: tableOf(section).title,
    cells,
    right: cells.length - misses.length,
    total: cells.length,
    misses,
  };
}

/** "Hard: 31/34". */
export function scoreLine(result: Pick<ChartTestResult, 'title' | 'right' | 'total'>): string {
  return `${result.title}: ${result.right}/${result.total}`;
}

const ACTION_WORD: Record<Action, string> = {
  hit: 'hit',
  stand: 'stand',
  double: 'double',
  split: 'split',
  surrender: 'surrender',
};

/**
 * One wrong-answer event per miss, source 'chartTest'. Untimed (a painted
 * cell has no decision latency) and unpriced (no hand was played). Correct
 * cells produce nothing: the same rule D-R9 set for Speed -- a cell painted
 * right in a sweep of 150 is not the evidence a dealt hand is, and letting it
 * in would promote cards Review should keep asking.
 */
export function chartTestEvents(result: ChartTestResult, now: number): GradedEvent[] {
  const at = new Date(now).toISOString();
  return result.cells
    .filter((c) => !c.correct)
    .map((c) => ({
      kind: 'action' as const,
      source: 'chartTest' as const,
      category: cellCategory(c.cellId, c.expected),
      correct: false,
      classification: 'basic-error' as const,
      taken: c.painted ?? 'none',
      expected: c.expected,
      reason: `Chart test: ${c.row.label} v ${c.up} is ${ACTION_WORD[c.expected]}`,
      tc: 0,
      hand: c.cellId,
      at,
    }));
}

/**
 * Write a graded table: each miss is a wrong review of its flashcard (box 0,
 * due now) and a wrong answer in Stats. Correct cells are not written at all.
 * One load and one save per store. Returns the events written.
 */
export function recordChartTest(result: ChartTestResult, now: number): GradedEvent[] {
  const events = chartTestEvents(result, now);
  if (events.length === 0) return events;
  const deck = { ...loadFlashSr() };
  for (const id of result.misses) deck[id] = reviewCard(deck[id], false, now, { channel: SCREEN_CHANNEL });
  saveFlashSr(deck);
  saveStats(applyEvents(loadStats(), events));
  return events;
}
