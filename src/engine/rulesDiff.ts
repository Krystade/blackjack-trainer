import { getChart, type Chart, type ChartAction } from './charts';
import { indexSetFor, type Deviation, type DeviationId } from './deviations';
import type { RuleSet, StrategyRules } from './ruleset';

/**
 * B10 rules differences: what changes between two rulesets' basic charts and
 * index sets. Engine-only -- no drill or UI imports.
 */

export type Comparison = 'h17s17' | 'decks68' | 'custom';

/** cellId like 'hard-11-v-A', 'soft-18-v-2', 'pair-8-v-A'. */
export interface CellDiff {
  cellId: string;
  a: ChartAction;
  b: ChartAction;
}

/** null = absent from that set. */
export interface IndexDiff {
  id: DeviationId;
  a: Deviation | null;
  b: Deviation | null;
}

export interface RulesDiff {
  a: StrategyRules;
  b: StrategyRules;
  sameChart: boolean;
  cells: CellDiff[];
  indices: IndexDiff[];
}

const UPS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'] as const;

function diffTable(
  prefix: 'hard' | 'soft' | 'pair',
  ta: Chart['HARD'] | Chart['PAIRS'],
  tb: Chart['HARD'] | Chart['PAIRS'],
  out: CellDiff[],
): void {
  const ra = ta as Record<string, ChartAction[] | undefined>;
  const rb = tb as Record<string, ChartAction[] | undefined>;
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
  for (const key of keys) {
    const rowA = ra[key];
    const rowB = rb[key];
    if (!rowA || !rowB) continue;
    UPS.forEach((up, i) => {
      if (rowA[i] !== rowB[i]) out.push({ cellId: `${prefix}-${key}-v-${up}`, a: rowA[i], b: rowB[i] });
    });
  }
}

function sameDeviation(x: Deviation, y: Deviation): boolean {
  return (
    x.threshold === y.threshold &&
    x.dir === y.dir &&
    x.active === y.active &&
    x.action === y.action &&
    x.kind === y.kind
  );
}

export function diffRules(a: StrategyRules, b: StrategyRules): RulesDiff {
  const ca = getChart(a);
  const cb = getChart(b);
  const cells: CellDiff[] = [];
  diffTable('hard', ca.HARD, cb.HARD, cells);
  diffTable('soft', ca.SOFT, cb.SOFT, cells);
  diffTable('pair', ca.PAIRS, cb.PAIRS, cells);

  const ia = indexSetFor(a);
  const ib = indexSetFor(b);
  const indices: IndexDiff[] = [];
  for (const da of ia) {
    const db = ib.find((d) => d.id === da.id) ?? null;
    if (db === null || !sameDeviation(da, db)) indices.push({ id: da.id, a: da, b: db });
  }
  for (const db of ib) {
    if (!ia.some((d) => d.id === db.id)) indices.push({ id: db.id, a: null, b: db });
  }

  return { a, b, sameChart: cells.length === 0, cells, indices };
}

/** The chart cell a deviation lives on; 'insurance' for insurance; null if unknown. */
export function cellIdForDeviation(d: Deviation): string | null {
  const kind = d.kind as string;
  if ((kind === 'hard' || kind === 'surrender') && d.total !== undefined && d.up !== undefined) {
    return `hard-${d.total}-v-${d.up}`;
  }
  if (kind === 'pair10' && d.up !== undefined) return `pair-10-v-${d.up}`;
  if (kind === 'insurance') return 'insurance';
  // Lane D's soft deviations (expected shape: a kind naming 'soft' with total + up).
  if (kind.includes('soft') && d.total !== undefined && d.up !== undefined) {
    return `soft-${d.total}-v-${d.up}`;
  }
  return null;
}

export function comparisonRules(
  base: StrategyRules,
  c: Comparison,
  custom?: { decks: RuleSet['decks']; s17: boolean },
): [StrategyRules, StrategyRules] {
  if (c === 'h17s17') return [{ ...base, s17: false }, { ...base, s17: true }];
  if (c === 'decks68') return [{ ...base, decks: 6 }, { ...base, decks: 8 }];
  return [base, { ...base, decks: custom?.decks ?? base.decks, s17: custom?.s17 ?? base.s17 }];
}

export function rulesNames(a: StrategyRules, b: StrategyRules): [string, string] {
  const na: string[] = [];
  const nb: string[] = [];
  const deckName = (n: number) => (n === 1 ? '1 deck' : `${n} decks`);
  if (a.decks !== b.decks) { na.push(deckName(a.decks)); nb.push(deckName(b.decks)); }
  if (a.s17 !== b.s17) { na.push(a.s17 ? 'S17' : 'H17'); nb.push(b.s17 ? 'S17' : 'H17'); }
  if (a.das !== b.das) { na.push(a.das ? 'DAS' : 'no DAS'); nb.push(b.das ? 'DAS' : 'no DAS'); }
  if (a.ls !== b.ls) { na.push(a.ls ? 'surrender' : 'no surrender'); nb.push(b.ls ? 'surrender' : 'no surrender'); }
  if (na.length === 0) return ['Your game', 'Your game'];
  return [na.join(' · '), nb.join(' · ')];
}
