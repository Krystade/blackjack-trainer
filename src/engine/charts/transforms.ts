import type { Rank } from '../cards';
import type { Chart, ChartAction, DeckClass } from './types';

function cloneRows<T extends Record<string, ChartAction[]>>(rows: T): T {
  const out = {} as T;
  for (const key of Object.keys(rows)) {
    (out as Record<string, ChartAction[]>)[key] = [...rows[key]];
  }
  return out;
}

function cloneChart(chart: Chart): Chart {
  return {
    HARD: cloneRows(chart.HARD as unknown as Record<string, ChartAction[]>) as unknown as Record<number, ChartAction[]>,
    SOFT: cloneRows(chart.SOFT as unknown as Record<string, ChartAction[]>) as unknown as Record<number, ChartAction[]>,
    PAIRS: cloneRows(chart.PAIRS as Record<string, ChartAction[]>) as Partial<Record<Rank, ChartAction[]>>,
  };
}

/**
 * Resolve DAS-conditional pair cells (Ph, Pd, Ps -- and, 2-deck only, Rp)
 * into concrete actions now that `das` is known. Pure: the input chart is
 * never mutated; a deep copy is always returned.
 *
 * - das:true  -> Ph, Pd, Ps all resolve to 'P' (split). 2-deck only: Rp also
 *   resolves to 'P' (the 2D legend: 8,8vA surrenders only when DAS is
 *   UNAVAILABLE -- with DAS on, you split). d68/d1 Rp is left untouched here
 *   (it's unconditional surrender-else-split, independent of DAS).
 * - das:false -> Ph -> 'H', Pd -> 'Dh', Ps -> 'S'. Rp is left untouched
 *   everywhere -- it already encodes "surrender if allowed, else split" and
 *   the runtime pair-path falls back to split when surrender isn't legal.
 *
 * Only the PAIRS table can hold these cell values -- HARD/SOFT are untouched.
 */
export function resolveDas(chart: Chart, das: boolean, deckClass: DeckClass): Chart {
  const out = cloneChart(chart);
  for (const rank of Object.keys(out.PAIRS) as Rank[]) {
    const row = out.PAIRS[rank]!;
    for (let i = 0; i < row.length; i++) {
      switch (row[i]) {
        case 'Ph':
          row[i] = das ? 'P' : 'H';
          break;
        case 'Pd':
          row[i] = das ? 'P' : 'Dh';
          break;
        case 'Ps':
          row[i] = das ? 'P' : 'S';
          break;
        case 'Rp':
          if (das && deckClass === 'd2') row[i] = 'P';
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/**
 * Resolve late-surrender-conditional cells (Rh, Rs, Rp) to their fallback
 * action when `ls` is false. Pure. Must be applied AFTER resolveDas -- any
 * Rp that DAS already turned into 'P' is no longer 'Rp' and is untouched
 * here. ls:true leaves the chart unchanged (same object, no clone needed --
 * nothing is mutated either way).
 *
 * Rh/Rs can appear in HARD (e.g. hard 16 vs 10, hard 17 vs A) as well as
 * PAIRS (e.g. 1D's 7,7 vs 10 = Rs); Rp only appears in PAIRS.
 */
export function stripLs(chart: Chart, ls: boolean): Chart {
  if (ls) return chart;

  const out = cloneChart(chart);
  const fix = (row: ChartAction[]) => {
    for (let i = 0; i < row.length; i++) {
      if (row[i] === 'Rh') row[i] = 'H';
      else if (row[i] === 'Rs') row[i] = 'S';
      else if (row[i] === 'Rp') row[i] = 'P';
    }
  };
  for (const total of Object.keys(out.HARD)) fix(out.HARD[Number(total)]);
  for (const total of Object.keys(out.SOFT)) fix(out.SOFT[Number(total)]);
  for (const rank of Object.keys(out.PAIRS) as Rank[]) fix(out.PAIRS[rank]!);
  return out;
}

const CONDITIONAL_CELLS: ChartAction[] = ['Ph', 'Pd', 'Ps'];

/**
 * Assembly-time guard: after resolveDas + stripLs, a Chart must contain only
 * H/S/Dh/Ds/P/Rh/Rs/Rp. Ph/Pd/Ps are DAS-conditional and must never survive
 * assembly -- getChart() calls this before returning/caching a chart.
 */
export function assertFullyResolved(chart: Chart): void {
  const scan = (table: 'HARD' | 'SOFT' | 'PAIRS', key: string, row: ChartAction[]) => {
    for (let i = 0; i < row.length; i++) {
      if (CONDITIONAL_CELLS.includes(row[i])) {
        throw new Error(
          `getChart assembly left an unresolved conditional cell '${row[i]}' at ${table}[${key}][${i}] -- resolveDas must resolve all Ph/Pd/Ps before a Chart is returned`,
        );
      }
    }
  };
  for (const total of Object.keys(chart.HARD)) scan('HARD', total, chart.HARD[Number(total)]);
  for (const total of Object.keys(chart.SOFT)) scan('SOFT', total, chart.SOFT[Number(total)]);
  for (const rank of Object.keys(chart.PAIRS)) scan('PAIRS', rank, chart.PAIRS[rank as Rank]!);
}
