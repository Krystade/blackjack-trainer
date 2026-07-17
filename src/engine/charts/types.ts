import type { Rank } from '../cards';

/**
 * Every cell value a strategy chart can hold.
 *
 * Ph/Pd/Ps are DAS-conditional pair cells: Ph = split if DAS else hit,
 * Pd = split if DAS else double, Ps = split if DAS else stand. Raw base
 * tables (charts/d*_*.ts) may contain them; charts/transforms.ts resolves
 * them at assembly time (see resolveDas) so a Chart returned by getChart()
 * never contains Ph/Pd/Ps -- only H/S/Dh/Ds/P/Rh/Rs/Rp survive assembly.
 */
export type ChartAction = 'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Ph' | 'Rh' | 'Rs' | 'Rp' | 'Pd' | 'Ps';

/** A fully-assembled (or raw, pre-transform) strategy chart. */
export interface Chart {
  HARD: Record<number, ChartAction[]>;
  SOFT: Record<number, ChartAction[]>;
  PAIRS: Partial<Record<Rank, ChartAction[]>>;
}

/** Deck-count buckets that base charts and DAS transforms are keyed by. */
export type DeckClass = 'd68' | 'd2' | 'd1';
