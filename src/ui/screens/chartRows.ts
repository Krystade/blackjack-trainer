import type { Card, Rank } from '../../engine/cards';
import { handValue, isPair, pairRank } from '../../engine/hand';
import { getChart } from '../../engine/charts';
import type { Chart, ChartAction } from '../../engine/charts';
import { DEFAULT_RULES } from '../../engine/ruleset';
import type { RuleSet } from '../../engine/ruleset';

/**
 * Pure view-model for the strategy-chart viewer (src/ui/screens/Charts.tsx).
 *
 * Everything here is a TRANSFORM over a chart that getChart() already
 * assembled -- no cell values are authored, re-transcribed or "corrected"
 * anywhere in this file. That is deliberate and it is the single most
 * important property of the viewer: src/engine/strategy.ts grades against
 * exactly the same getChart(rules) object, so a chart the operator reads on
 * screen physically cannot disagree with the chart the trainer marks them
 * against. A second hand-typed table would drift the first time a ruleset
 * transform changed, and it would drift silently.
 *
 * Kept out of the component (and out of .tsx) so it is unit-testable under
 * vitest's `environment: 'node'` -- the project has no DOM test harness, so
 * anything worth asserting has to live in a plain module like this one.
 */

/** Chart column order. Fixed by the engine's upIndex(): dealer 2..9, ten, ace. */
export const DEALER_UPCARDS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

export type ChartSection = 'HARD' | 'SOFT' | 'PAIRS';

/**
 * Which end of each section sits at the top.
 *
 * 'descending' (highest total first) is the Wizard of Odds / BJA house layout
 * and matches the source GIFs in docs/sources/; 'ascending' is the layout the
 * operator also studies off. Same data either way -- only the row order flips,
 * never a cell.
 */
export type RowOrder = 'descending' | 'ascending';

/**
 * One rendered row. `keys` is the list of underlying chart keys the row
 * covers -- more than one when the row is a collapsed range ('4-8', '18+',
 * 'A,9-10') -- which is what lets a highlight aimed at, say, hard 20 find the
 * '18+' row it was folded into.
 */
export interface ChartRow {
  /** Stable, unique-within-section DOM/test id, e.g. 'HARD:18' or 'PAIRS:A'. */
  id: string;
  /** What the operator reads in the sticky label column, e.g. '4-8', 'A,7', '8,8'. */
  label: string;
  /** Hard/soft totals, or the single pair rank, this row stands for. */
  keys: (number | Rank)[];
  /** The assembled chart row, verbatim, one entry per DEALER_UPCARDS column. */
  actions: ChartAction[];
}

/**
 * Points at exactly ONE cell of one section.
 *
 * This is the screen's public highlight contract (see Charts.tsx's
 * `highlight` prop). A grading/mistake panel builds one of these with
 * highlightForHand() below and hands it straight to <Charts highlight={...} />
 * to open the viewer scrolled to, and ringed around, the cell the player got
 * wrong -- with its neighbours still on screen, because the correction only
 * means anything relative to the decisions either side of it.
 *
 * `row` is the HARD/SOFT total (a number) or the PAIRS rank (a Rank string);
 * it may name a total that got folded into a collapsed row -- isHighlighted()
 * resolves that. `dealerUp` must be a COLUMN rank; pass any rank through
 * upcardColumn() first if it might be a J/Q/K.
 */
export interface ChartHighlight {
  section: ChartSection;
  row: number | Rank;
  dealerUp: Rank;
}

/**
 * Normalize a dealer rank onto the ten column-ranks the charts actually have.
 * J/Q/K are not columns -- they share the '10' column, exactly as the engine's
 * upIndex() folds them onto index 8.
 */
export function upcardColumn(up: Rank): Rank {
  return up === 'J' || up === 'Q' || up === 'K' ? '10' : up;
}

/**
 * Legend text. The letters stay in every cell precisely because colour alone
 * cannot carry these: 'Dh' and 'Ds' are the same decision with different
 * fallbacks, and the fallback is the half people get wrong at the table.
 * Order mirrors the ChartAction union so the legend reads like the type.
 */
export const ACTION_LEGEND: readonly { code: ChartAction; label: string }[] = [
  { code: 'H', label: 'Hit' },
  { code: 'S', label: 'Stand' },
  { code: 'Dh', label: 'Double if allowed, else hit' },
  { code: 'Ds', label: 'Double if allowed, else stand' },
  { code: 'P', label: 'Split' },
  { code: 'Rh', label: 'Surrender if allowed, else hit' },
  { code: 'Rs', label: 'Surrender if allowed, else stand' },
  { code: 'Rp', label: 'Surrender if allowed, else split' },
];

/** Pair ranks in ascending order, ace HIGH -- an ace pair is the 11-pair, not the 1-pair. */
const PAIR_ORDER: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

/**
 * Row collapsing follows the SOURCE CHARTS, not a generic run-length pass.
 *
 * A naive "merge adjacent identical rows" would fold hard 13 and hard 14
 * together (they are identical in every 6-deck chart) -- but every verified
 * GIF in docs/sources/ lists both, because a reader scanning for "14" expects
 * to find a row saying 14. What the sources DO collapse is the two trivial
 * ends: the run of totals you always hit, and the run you always stand.
 *
 * So: collapse a leading run only if every cell in it is 'H', and a trailing
 * run only if every cell in it is 'S'. That reproduces '4-8'/'4-7'/'17+'/
 * '18+'/'A,9-10' across all six base charts, and it is safe by construction --
 * a uniform run cannot be hiding a distinction worth a separate row.
 */
function uniform(actions: ChartAction[], value: ChartAction): boolean {
  return actions.every((a) => a === value);
}

/** Group a contiguous ascending list of numeric totals into [start, end] spans. */
function collapseSpans(totals: number[], rows: Record<number, ChartAction[]>): [number, number][] {
  const spans: [number, number][] = [];

  let lead = 0;
  while (lead + 1 < totals.length && uniform(rows[totals[lead]], 'H') && uniform(rows[totals[lead + 1]], 'H')) {
    lead += 1;
  }

  let tail = totals.length - 1;
  while (tail - 1 > lead && uniform(rows[totals[tail]], 'S') && uniform(rows[totals[tail - 1]], 'S')) {
    tail -= 1;
  }

  if (lead > 0) spans.push([totals[0], totals[lead]]);
  for (let i = lead > 0 ? lead + 1 : 0; i < (tail < totals.length - 1 ? tail : totals.length); i++) {
    spans.push([totals[i], totals[i]]);
  }
  if (tail < totals.length - 1) spans.push([totals[tail], totals[totals.length - 1]]);
  return spans;
}

/**
 * Hard rows read as totals ('16'). A span ending at the table's top total gets
 * the open-ended '18+' form the source charts use; a span ending mid-table
 * keeps both bounds ('4-8').
 */
function hardLabel(lo: number, hi: number, maxTotal: number): string {
  if (lo === hi) return String(lo);
  return hi === maxTotal ? `${lo}+` : `${lo}-${hi}`;
}

/**
 * Soft rows read as COMPOSITION ('A,7'), not as totals ('soft 18').
 *
 * Composition is what actually selects the row -- A,3 and A,7 share nothing
 * but an ace -- and "soft eighteen" is the exact phrase this app already
 * avoids elsewhere for being misheard as a hard total (see AudioSettings
 * handStyle in src/store/types.ts). The 2-deck and 1-deck source charts label
 * their soft rows this way too. Ranges keep both bounds ('A,9-10'); '+' would
 * read as a total here and mean nothing.
 */
function softLabel(lo: number, hi: number): string {
  const kicker = (total: number) => total - 11;
  return lo === hi ? `A,${kicker(lo)}` : `A,${kicker(lo)}-${kicker(hi)}`;
}

/**
 * Build the rendered rows for one section of an ALREADY-ASSEMBLED chart.
 * `chart` must have come from getChart() -- rows are copied out verbatim, so
 * anything unresolved in the input would be rendered as-is.
 */
export function buildSectionRows(chart: Chart, section: ChartSection, order: RowOrder): ChartRow[] {
  let rows: ChartRow[];

  if (section === 'PAIRS') {
    // Pairs are never collapsed: the "rows" are ranks, not a contiguous scale
    // (5,5 and 10,10 have no rows at all -- they play as hard 10 and hard 20),
    // and folding, say, 2,2 into 3,3 because they happen to match would hide
    // the ruleset's own structure. Ace-high ordering puts A,A at the top in
    // descending, matching the BJA layout.
    rows = PAIR_ORDER.filter((rank) => chart.PAIRS[rank] !== undefined).map((rank) => ({
      id: `PAIRS:${rank}`,
      label: `${rank},${rank}`,
      keys: [rank],
      actions: [...chart.PAIRS[rank]!],
    }));
  } else {
    const table = chart[section];
    const totals = Object.keys(table)
      .map(Number)
      .sort((a, b) => a - b);
    const maxTotal = totals[totals.length - 1];
    rows = collapseSpans(totals, table).map(([lo, hi]) => ({
      id: `${section}:${lo}`,
      label: section === 'HARD' ? hardLabel(lo, hi, maxTotal) : softLabel(lo, hi),
      keys: totals.filter((t) => t >= lo && t <= hi),
      // A collapsed span is uniform by construction, so any member's row is
      // the row -- take the first.
      actions: [...table[lo]],
    }));
  }

  return order === 'ascending' ? rows : rows.reverse();
}

/**
 * Does `row` (of `section`) contain the highlighted cell's row?
 * Collapsed spans match on any total they folded in, which is why a mistake on
 * hard 20 correctly lights up the '18+' row.
 */
export function isHighlighted(row: ChartRow, section: ChartSection, highlight: ChartHighlight | undefined): boolean {
  if (!highlight || highlight.section !== section) return false;
  return row.keys.includes(highlight.row);
}

/**
 * Map a real hand to the ONE chart cell that governs it -- the helper a
 * grading/mistake panel calls before opening the viewer.
 *
 * Routing deliberately mirrors src/engine/strategy.ts's play() step 1, so the
 * cell shown is the cell that was actually consulted:
 *  - a pair whose rank has a PAIRS row goes to PAIRS (A,A -> the ace row, not
 *    soft 12);
 *  - a pair whose rank has no PAIRS row falls through to its hard total
 *    (10,10 -> hard 20; 5,5 -> hard 10), exactly as the engine does;
 *  - `ctx.canSplit === false` forces that same fall-through, because when
 *    splitting was not legal the engine re-looked the hand up as a total and
 *    that -- not the pair cell -- is what the player should be corrected
 *    against.
 * PAIRS membership is read off getChart(rules) rather than hardcoded, so a
 * future ruleset that gains or loses a pair row needs no change here.
 *
 * Returns null when the hand has no row at all (a bust total): there is
 * nothing honest to point at, and callers should show no chart rather than an
 * arbitrary neighbouring cell.
 */
export function highlightForHand(
  cards: Card[],
  dealerUp: Rank,
  rules: RuleSet = DEFAULT_RULES,
  ctx: { canSplit?: boolean } = {},
): ChartHighlight | null {
  const chart = getChart(rules);
  const column = upcardColumn(dealerUp);
  const canSplit = ctx.canSplit ?? true;

  if (canSplit && isPair(cards)) {
    const rank = pairRank(cards);
    if (rank && chart.PAIRS[rank] !== undefined) {
      return { section: 'PAIRS', row: rank, dealerUp: column };
    }
  }

  const hv = handValue(cards);
  const section: ChartSection = hv.soft ? 'SOFT' : 'HARD';
  if (chart[section][hv.total] === undefined) return null;
  return { section, row: hv.total, dealerUp: column };
}

const SECTIONS: readonly ChartSection[] = ['HARD', 'SOFT', 'PAIRS'];

/**
 * Parse a `SECTION:ROW:UP` descriptor (e.g. 'HARD:16:9', 'PAIRS:8:A') into a
 * ChartHighlight.
 *
 * This is the string form of the same contract the `highlight` prop takes --
 * it exists so the viewer can be deep-linked (?cell=HARD:16:9) from a place
 * that only has a URL to work with, and so the browser-level behaviour of the
 * highlight (scroll-into-view, the ring, neighbours staying visible) is
 * reachable from an e2e spec at all. Props remain the primary interface.
 *
 * Anything malformed yields undefined rather than throwing: a stale or
 * hand-edited link must degrade to "no highlight", never to a broken screen.
 * Pair rows are validated against PAIR_ORDER, so 'PAIRS:Z:9' is rejected the
 * same as a non-numeric hard total.
 */
export function parseHighlightParam(raw: string | null | undefined): ChartHighlight | undefined {
  if (!raw) return undefined;
  const parts = raw.split(':');
  if (parts.length !== 3) return undefined;

  const [rawSection, rawRow, rawUp] = parts;
  const section = SECTIONS.find((s) => s === rawSection);
  if (!section) return undefined;

  const dealerUp = upcardColumn(rawUp as Rank);
  if (!DEALER_UPCARDS.includes(dealerUp)) return undefined;

  if (section === 'PAIRS') {
    const rank = PAIR_ORDER.find((r) => r === rawRow);
    return rank ? { section, row: rank, dealerUp } : undefined;
  }

  const total = Number(rawRow);
  if (!Number.isInteger(total)) return undefined;
  return { section, row: total, dealerUp };
}

/**
 * Coerce a persisted row-order string back into a RowOrder.
 *
 * The choice lives in its OWN localStorage key rather than in Settings: it is
 * a per-reader reading preference for one screen, not part of the game
 * definition, and Settings' shape is owned elsewhere. Unrecognised or missing
 * values fall back to 'descending', today's default.
 */
export function normalizeRowOrder(raw: string | null | undefined): RowOrder {
  return raw === 'ascending' ? 'ascending' : 'descending';
}

/**
 * The header line that makes it unambiguous WHICH chart is on screen. Rules
 * that silently change cells (deck count, dealer soft 17, DAS, late
 * surrender) each get a clause; rsa and bj65 are omitted because neither
 * moves a cell at this granularity (see RuleSet's own comments). Singular
 * "deck" throughout keeps it to one line on a 320px phone.
 */
export function rulesetSummary(rules: RuleSet): string {
  return [
    `${rules.decks} deck`,
    rules.s17 ? 'S17' : 'H17',
    rules.das ? 'DAS' : 'No DAS',
    rules.ls ? 'Late surrender' : 'No surrender',
  ].join(' · ');
}
