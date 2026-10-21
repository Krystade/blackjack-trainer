/**
 * Wave L: pure view-model for the variant charts (VariantCharts.tsx).
 *
 * Shapes generated.json for the screen: rows are folded exactly as the
 * standard chart folds them (chartRows.ts's buildSectionRows -- the same
 * leading-hit / trailing-stand rule), a cell code is mapped to its colour
 * family, and the legend lists only the codes this chart actually uses. No
 * cell value is authored here: every code is read from the generated data the
 * grader (engine/variants/strategy.ts) also reads.
 */

import type { Rank } from '../../engine/cards';
import type { Chart } from '../../engine/charts';
import type { GenTable, SectionId } from '../../engine/variants/chartGen';
import type { Disagreement } from '../../engine/variants/compare';
import type { PresetId } from '../../engine/variants/rules';
import { parseCode } from '../../engine/variants/cellCode';
import { buildSectionRows } from './chartRows';
import type { ChartRow, RowOrder } from './chartRows';

const PAIR_RANK: Record<number, Rank> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'A',
};

/** One rendered section of a variant table, folded like the standard chart. */
export function variantSectionRows(table: GenTable, section: SectionId, order: RowOrder): ChartRow[] {
  // buildSectionRows only compares and copies codes, so a table of variant
  // code strings goes through it unchanged.
  const asChart = {
    HARD: Object.fromEntries(table.sections.HARD.map((r) => [r.key, r.cells.map((c) => c.code)])),
    SOFT: Object.fromEntries(table.sections.SOFT.map((r) => [r.key, r.cells.map((c) => c.code)])),
    PAIRS: Object.fromEntries(table.sections.PAIRS.map((r) => [PAIR_RANK[r.key]!, r.cells.map((c) => c.code)])),
  } as unknown as Chart;
  return buildSectionRows(asChart, section, order);
}

/**
 * The colour family a code is painted in -- one of the standard chart's
 * data-action values, so the theme palette applies unchanged. The letters
 * stay in the cell; colour only groups the decision.
 */
export function codeFamily(code: string): string {
  const { base, step } = parseCode(code);
  if (base === 'H' || base === 'S') return base;
  if (base === 'Dh' || base === 'Ds' || base === 'Rh' || base === 'Rs' || base === 'Rp') return base;
  // A Spanish 21 double that turns to a hit at n cards carries the hit sliver.
  if (base === 'D') return step !== null ? 'Dh' : 'D';
  if (base === 'FD') return 'FD';
  if (base === 'P' || base === 'P$') return 'P';
  if (base === 'FP') return 'FP';
  if (base === 'R') return 'Rh';
  return base;
}

/** Long names, for the legend and each cell's title. */
export function describeCode(code: string): string {
  const { base, step, mark } = parseCode(code);
  const BASE: Record<string, string> = {
    H: 'Hit',
    S: 'Stand',
    D: 'Double',
    Dh: 'Double if allowed, else hit',
    Ds: 'Double if allowed, else stand',
    FD: 'Free double',
    P: 'Split',
    P$: 'Split, except hit suited sevens (Super Bonus)',
    FP: 'Free split',
    Rh: 'Surrender if allowed, else hit',
    Rs: 'Surrender if allowed, else stand',
    Rp: 'Surrender if allowed, else split',
    R: 'Surrender',
  };
  let text = BASE[base] ?? base;
  if (step !== null) text += `, but hit once you hold ${step} or more cards`;
  if (mark === '*') text += '; hit if a 6-7-8 is possible';
  if (mark === "'") text += '; hit if a suited 6-7-8 is possible';
  if (mark === '"') text += '; hit if a spaded 6-7-8 is possible';
  return text;
}

export interface LegendEntry {
  code: string;
  family: string;
  label: string;
}

/** The legend: each base code this preset's tables use, plus the step and mark rules when present. */
export function legendFor(tables: readonly GenTable[]): {
  entries: LegendEntry[];
  steps: boolean;
  marks: string[];
} {
  const bases = new Set<string>();
  let steps = false;
  const marks = new Set<string>();
  for (const t of tables) {
    for (const section of ['HARD', 'SOFT', 'PAIRS'] as const) {
      for (const row of t.sections[section]) {
        for (const cell of row.cells) {
          const p = parseCode(cell.code);
          bases.add(p.base);
          if (p.step !== null) steps = true;
          if (p.mark) marks.add(p.mark);
        }
      }
    }
  }
  const ORDER = ['H', 'S', 'D', 'Dh', 'Ds', 'FD', 'P', 'FP', 'P$', 'Rh', 'Rs', 'Rp'];
  const entries = ORDER.filter((b) => bases.has(b)).map((b) => ({
    code: b,
    family: codeFamily(b),
    label: describeCode(b),
  }));
  return { entries, steps, marks: ['*', "'", '"'].filter((m) => marks.has(m)) };
}

export const MARK_TEXT: Record<string, string> = {
  '*': 'hit instead when the hand can make a 6-7-8 (a 6-7, 6-8 or 7-8 start)',
  "'": 'hit instead when a suited or spaded 6-7-8 is possible',
  '"': 'hit instead when a spaded 6-7-8 is possible',
};

/** A cell to ring: which table, which section, which row key, which column. */
export interface VariantHighlight {
  table: string;
  section: SectionId;
  /** Hard/soft total or pair value (11 = aces), as generated.json keys them. */
  row: number;
  /** Column 0-9: dealer 2-9, ten, ace. */
  col: number;
}

/** Does a folded row hold the highlighted row key? (Pairs are keyed by rank there.) */
export function rowHolds(row: ChartRow, section: SectionId, key: number): boolean {
  if (section === 'PAIRS') return row.keys.includes(PAIR_RANK[key]!);
  return row.keys.includes(key);
}

/** A folded row's keys as generated.json numbers them (pairs by card value, aces 11). */
export function rowKeyNumbers(row: ChartRow, section: SectionId): number[] {
  if (section !== 'PAIRS') return row.keys as number[];
  const byRank = new Map(Object.entries(PAIR_RANK).map(([v, r]) => [r, Number(v)]));
  return row.keys.map((k) => byRank.get(k as Rank)!);
}

/** The disagreements for one preset, grouped by their reason, for the "where this differs" list. */
export function disagreementGroups(
  all: readonly Disagreement[],
  preset: PresetId,
): { reason: string; cells: Disagreement[] }[] {
  const groups = new Map<string, Disagreement[]>();
  for (const d of all) {
    if (d.preset !== preset) continue;
    const key = d.reason ?? 'No reason recorded.';
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  return [...groups.entries()].map(([reason, cells]) => ({ reason, cells }));
}

/** '15 v 4 (hard)', '8,8 v A', 'soft 18 v 6', 'after a double: 13 v 10'. */
export function disagreementLabel(d: Disagreement): string {
  const up = d.up === 11 ? 'A' : String(d.up);
  if (d.table === 'afterDouble') return `doubled ${d.section === 'soft' ? 'soft ' : ''}${d.row} v ${up}`;
  const hand =
    d.section === 'PAIRS'
      ? `${PAIR_RANK[d.row]},${PAIR_RANK[d.row]}`
      : d.section === 'SOFT'
        ? `soft ${d.row}`
        : `${d.row}`;
  const free = d.table === 'free' ? ' (free hand)' : '';
  return `${hand} v ${up}${free}`;
}

/** A switch value (EV per unit) as the table shows it: hundredths, signed. */
export function formatSwitchValue(v: number): string {
  const n = Math.round(v * 100);
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `−${Math.abs(n)}`;
}
