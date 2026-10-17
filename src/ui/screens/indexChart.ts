import type { Rank } from '../../engine/cards';
import { indexSetFor } from '../../engine/deviations';
import type { Deviation, DeviationId } from '../../engine/deviations';
import type { StrategyRules } from '../../engine/ruleset';
import { indexPlayAt, indexPlayBelow, publishedIndexText } from '../../drills/indexDisplay';
import { DEALER_UPCARDS, upcardColumn } from './chartRows';
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
  /**
   * The BJA H17 extras (B9) are their own group; of the rest, the Fab 4 are
   * the surrender indexes and everything else is the Illustrious 18.
   */
  group: 'illustrious' | 'fab4' | 'extra';
  /** '16', '10,10', 'A,8' for a soft hand, or 'Any hand' for insurance. */
  hand: string;
  /** A chart column rank. */
  dealer: Rank;
  /**
   * The PUBLISHED index, always 'TC ≥ n' (R6): 'TC ≥ +3', 'TC ≥ 0', and
   * 'TC ≥ −3' for 12 v 6 under H17, which the engine stores as hit at ≤ −4.
   */
  index: string;
  /** The play at and above the index: 'Stand', 'Split', 'Take insurance'. */
  play: string;
  /** 'hit below' when the entry names the play below the index, else null. */
  below: string | null;
  family: IndexFamily;
  /** The whole entry as one line: '16 v 10 · TC ≥ 0 · Stand', '12 v 6 · TC ≥ −3 · Stand · hit below'. */
  text: string;
  /**
   * The HARD-chart total the index sits on, or null when it has no cell
   * (insurance). 10,10 is 20: the chart has no ten-pair row and plays it as
   * hard 20, which is where its split index belongs.
   */
  hardTotal: number | null;
  /** The SOFT-chart total a soft index sits on (A,8 is 19), else null. */
  softTotal: number | null;
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

const PLAY_TEXT: Record<Deviation['action'], string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
  'take-insurance': 'Take insurance',
};

function toEntry(dev: Deviation): IndexEntry {
  const at = indexPlayAt(dev);
  const family: IndexFamily = at === 'take-insurance' ? 'insurance' : at;
  let hand: string;
  let hardTotal: number | null;
  let softTotal: number | null = null;
  if (dev.kind === 'insurance') {
    hand = 'Any hand';
    hardTotal = null;
  } else if (dev.kind === 'pair10') {
    hand = '10,10';
    hardTotal = 20;
  } else if (dev.kind === 'soft') {
    hand = `A,${dev.total! - 11}`;
    hardTotal = null;
    softTotal = dev.total!;
  } else {
    hand = String(dev.total);
    hardTotal = dev.total ?? null;
  }
  // Insurance is only ever offered against an ace, so that is its column.
  const dealer = upcardColumn(dev.up ?? 'A');
  const index = publishedIndexText(dev);
  const play = PLAY_TEXT[at];
  const belowPlay = indexPlayBelow(dev);
  const below = belowPlay === null ? null : `${PLAY_TEXT[belowPlay].toLowerCase()} below`;
  return {
    id: dev.id,
    group: dev.extra ? 'extra' : dev.kind === 'surrender' ? 'fab4' : 'illustrious',
    hand,
    dealer,
    index,
    play,
    below,
    family,
    text: `${hand} v ${dealer} · ${index} · ${play}${below === null ? '' : ` · ${below}`}`,
    hardTotal,
    softTotal,
  };
}

/**
 * Every index graded under `rules`, in the set's own order (Illustrious 18 by
 * value, then the Fab 4 when the profile plays them, then the BJA H17 extras
 * when it has those on). Pass
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
 * True when `entry` is a hit / stand / double / split index on a cell the
 * chart surrenders (Rh, Rs, Rp) -- 16 v 10, 15 v 10 and 16 v 9 under H17 with
 * late surrender.
 *
 * strategy.ts settles surrender (the basic Rh, or a Fab 4 index) BEFORE it
 * looks at any hard-total index, so on such a cell a two-card hand surrenders
 * at every count where the index would fire, and the index is only the play
 * once surrender is off the table (after a hit, or no surrender at all). Bare,
 * "16 v 10 · TC ≥ 0 · Stand" sitting under an Rh cell reads as "stand at +1",
 * which the grader marks wrong.
 */
export function surrenderComesFirst(entry: IndexEntry, cellAction: string | null): boolean {
  if (entry.family === 'surrender' || entry.family === 'insurance') return false;
  return cellAction === 'Rh' || cellAction === 'Rs' || cellAction === 'Rp';
}

/** The HARD chart's play at the cell an index sits on, or null when it has none. */
export function hardCellAction(entry: IndexEntry, hardRows: readonly ChartRow[]): string | null {
  if (entry.hardTotal === null) return null;
  const row = hardRows.find((r) => r.keys.includes(entry.hardTotal!));
  const col = DEALER_UPCARDS.indexOf(entry.dealer);
  return row && col >= 0 ? (row.actions[col] ?? null) : null;
}

/**
 * The indexes drawn on one chart cell. HARD cells carry the hard totals and
 * the ten-pairs (hard 20); SOFT cells carry the BJA H17 soft extras (B9);
 * PAIRS cells and insurance carry none. A collapsed
 * row ('18+') matches on any total folded into it, the same way a highlight
 * does. One cell can hold two (16 v 9: stand at +4, surrender at 0).
 */
export function indexesAtCell(
  entries: readonly IndexEntry[],
  section: ChartSection,
  row: ChartRow,
  dealerUp: Rank,
): IndexEntry[] {
  if (section === 'SOFT') {
    return entries.filter(
      (e) => e.softTotal !== null && e.dealer === dealerUp && row.keys.includes(e.softTotal),
    );
  }
  if (section !== 'HARD') return [];
  return entries.filter(
    (e) => e.hardTotal !== null && e.dealer === dealerUp && row.keys.includes(e.hardTotal),
  );
}
