import type { Rank } from '../../engine/cards';
import { indexSetFor } from '../../engine/deviations';
import type { Deviation, DeviationId } from '../../engine/deviations';
import type { StrategyRules } from '../../engine/ruleset';
import { upcardColumn } from './chartRows';
import type { ChartRow, ChartSection } from './chartRows';

/**
 * #23: the count indexes, shaped for the Charts screen -- the "Indexes" list
 * and the corner markers on the grid.
 *
 * Read straight out of indexSetFor(rules), the SAME set strategy.ts and the
 * grader use, for the same reason chartRows.ts reads getChart(): an index
 * typed out a second time here would drift from the one the trainer marks you
 * against. Nothing below authors a threshold, a play or a cell; it only
 * reformats what the engine already holds.
 */

/** The family a play's colour is drawn from, matching the chart cells. */
export type IndexFamily = 'hit' | 'stand' | 'double' | 'split' | 'surrender' | 'insurance';

export interface IndexEntry {
  id: DeviationId;
  /** The Fab 4 are the surrender indexes; everything else is the Illustrious 18. */
  group: 'illustrious' | 'fab4';
  /** '16', '10,10', or 'Any hand' for insurance. */
  hand: string;
  /** A chart column rank. */
  dealer: Rank;
  /** 'TC ≥ +3', 'TC ≥ 0', 'TC ≤ −2'. */
  index: string;
  /** 'Stand', 'Split', 'Take insurance'. */
  play: string;
  family: IndexFamily;
  /** The whole entry as one line: '16 v 10 · TC ≥ 0 · Stand'. */
  text: string;
  /**
   * The HARD-chart total the index sits on, or null when it has no cell
   * (insurance). 10,10 is 20: the chart has no ten-pair row and plays it as
   * hard 20, which is where its split index belongs.
   */
  hardTotal: number | null;
}

export interface IndexList {
  entries: IndexEntry[];
  /**
   * Indexes the set carries but switches off under these rules (11 v A under
   * H17), as the engine's own sentence, so the list can say why it is absent
   * rather than silently being one short of eighteen.
   */
  inactive: string[];
}

/** The signed threshold as the deviation labels write it: +3, 0, −2 (a real minus). */
export function formatIndex(threshold: number, dir: Deviation['dir']): string {
  const sign = threshold > 0 ? '+' : threshold < 0 ? '−' : '';
  return `TC ${dir === 'gte' ? '≥' : '≤'} ${sign}${Math.abs(threshold)}`;
}

const PLAY_TEXT: Record<Deviation['action'], string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
  'take-insurance': 'Take insurance',
};

function toEntry(dev: Deviation): IndexEntry {
  const family: IndexFamily = dev.action === 'take-insurance' ? 'insurance' : dev.action;
  let hand: string;
  let hardTotal: number | null;
  if (dev.kind === 'insurance') {
    hand = 'Any hand';
    hardTotal = null;
  } else if (dev.kind === 'pair10') {
    hand = '10,10';
    hardTotal = 20;
  } else {
    hand = String(dev.total);
    hardTotal = dev.total ?? null;
  }
  // Insurance is only ever offered against an ace, so that is its column.
  const dealer = upcardColumn(dev.up ?? 'A');
  const index = formatIndex(dev.threshold, dev.dir);
  const play = PLAY_TEXT[dev.action];
  return {
    id: dev.id,
    group: dev.kind === 'surrender' ? 'fab4' : 'illustrious',
    hand,
    dealer,
    index,
    play,
    family,
    text: `${hand} v ${dealer} · ${index} · ${play}`,
    hardTotal,
  };
}

/**
 * Every index graded under `rules`, in the set's own order (Illustrious 18 by
 * value, then the Fab 4 when the profile plays them). Pass
 * strategyRulesFor(profile), not the bare RuleSet -- the surrender indexes are
 * a profile choice, and only that call knows it (and drops them when the
 * table has no surrender).
 */
export function indexList(rules: StrategyRules): IndexList {
  const set = indexSetFor(rules);
  return {
    entries: set.filter((d) => d.active).map(toEntry),
    inactive: set.filter((d) => !d.active).map((d) => d.label),
  };
}

/**
 * The indexes drawn on one chart cell. Only HARD cells carry any: every index
 * is a hard total, a ten-pair (hard 20) or insurance (no cell). A collapsed
 * row ('18+') matches on any total folded into it, the same way a highlight
 * does. One cell can hold two (16 v 9: stand at +4, surrender at 0).
 */
export function indexesAtCell(
  entries: readonly IndexEntry[],
  section: ChartSection,
  row: ChartRow,
  dealerUp: Rank,
): IndexEntry[] {
  if (section !== 'HARD') return [];
  return entries.filter(
    (e) => e.hardTotal !== null && e.dealer === dealerUp && row.keys.includes(e.hardTotal),
  );
}
