/**
 * Wave L: grading a hand against a variant chart.
 *
 * Reads the committed generated.json (the charts the Charts tab shows), so the
 * chart on screen and the grader cannot disagree -- the same property
 * src/engine/strategy.ts has with getChart(). The code in a cell is read with
 * cellCode.ts's playFor, the same reader the published comparison uses.
 */

import type { Card, Rank } from '../cards';
import { rankValue } from '../cards';
import { handValue } from '../hand';
import type { Action } from '../deviations';
import type { PlayContext } from '../strategy';
import type { AfterDoubleRow, GenCell, GenPreset, GenTable, SectionId, SwitchValueRow } from './chartGen';
import type { Disagreement } from './compare';
import type { PresetId } from './rules';
import { PRESETS } from './rules';
import { fallbackOf, parseCode, playFor } from './cellCode';
import type { SuitState, VAct } from './ev';
// The import attribute is for Node ESM: the Playwright specs import this
// module directly, and Node refuses a bare JSON import. Vite accepts it too.
import generated from './generated.json' with { type: 'json' };

export interface VariantData {
  note: string;
  sources: Record<string, string>;
  presets: Record<PresetId, GenPreset>;
  disagreements: Disagreement[];
}

export const VARIANT_DATA = generated as unknown as VariantData;

export function presetData(id: PresetId): GenPreset {
  return VARIANT_DATA.presets[id];
}

export function switchValueRows(): SwitchValueRow[] {
  return VARIANT_DATA.presets.switch.switchValues ?? [];
}

/**
 * The disagreement on one cell, if the computed chart and the published one
 * differ there. Keyed like compare.ts: preset:table:SECTION:row:up (up 2-11).
 */
const DISAGREEMENT_BY_KEY = new Map(VARIANT_DATA.disagreements.map((d) => [d.key, d]));

export function disagreementAt(preset: PresetId, table: string, section: string, row: number, col: number): Disagreement | null {
  return DISAGREEMENT_BY_KEY.get(`${preset}:${table}:${section}:${row}:${col === 9 ? 11 : col + 2}`) ?? null;
}

/**
 * The code a cell is graded as and shown with: the published code where the
 * disagreement is graded 'published', the computed code otherwise. `other` is
 * the code it is not, for the note on the cell (and, for 'either', a second
 * right answer).
 */
export interface GradedCell {
  code: string;
  /** True when `code` is not the computed code (its noDouble/noSurrender do not apply). */
  overridden: boolean;
  note: Disagreement | null;
  other: string | null;
}

export function gradedCell(preset: PresetId, table: string, section: SectionId, row: number, col: number, cell: GenCell): GradedCell {
  const d = disagreementAt(preset, table, section, row, col);
  if (!d) return { code: cell.code, overridden: false, note: null, other: null };
  if (d.grade === 'published') return { code: d.published, overridden: true, note: d, other: cell.code };
  return { code: cell.code, overridden: false, note: d, other: d.published };
}

/** A preset's table with every cell's code as graded: what the Charts tab paints. */
export function gradedTable(preset: PresetId, table: GenTable): GenTable {
  const sections = {} as GenTable['sections'];
  for (const section of ['HARD', 'SOFT', 'PAIRS'] as const) {
    sections[section] = table.sections[section].map((r) => ({
      key: r.key,
      cells: r.cells.map((c, i) => ({ ...c, code: gradedCell(preset, table.id, section, r.key, i, c).code })),
    }));
  }
  return { ...table, sections };
}

/** Column index of a dealer up card: 2-9, ten (J/Q/K too), ace. */
export function upColumn(up: Rank): number {
  const v = rankValue(up);
  return v === 11 ? 9 : v - 2;
}

const ACTION_OF: Record<VAct, Action> = {
  H: 'hit',
  S: 'stand',
  D: 'double',
  FD: 'double',
  P: 'split',
  FP: 'split',
  R: 'surrender',
};

/** The chart cell that governs a hand: which section, which row. */
export interface VariantCellRef {
  section: SectionId;
  row: number;
  /** Column 0-9. */
  col: number;
  cell: GenCell;
}

/**
 * Find the cell for a hand. A pair goes to PAIRS when it may still be split;
 * otherwise (or with more than two cards) to its hard / soft total.
 */
export function variantCellFor(
  preset: PresetId,
  table: string,
  cards: readonly Card[],
  up: Rank,
  canSplit: boolean,
): VariantCellRef {
  const t = presetData(preset).tables.find((x) => x.id === table);
  if (!t) throw new Error(`no ${table} table for ${preset}`);
  const col = upColumn(up);
  if (cards.length === 2 && canSplit && rankValue(cards[0]!.rank) === rankValue(cards[1]!.rank)) {
    const row = rankValue(cards[0]!.rank);
    return { section: 'PAIRS', row, col, cell: t.sections.PAIRS.find((r) => r.key === row)!.cells[col]! };
  }
  const { total, soft } = handValue([...cards]);
  const section: SectionId = soft ? 'SOFT' : 'HARD';
  const rows = t.sections[section];
  // A soft 12 (two aces that may not split) reads as the lowest soft row, as
  // strategy.ts reads its own charts.
  const row = rows.find((r) => r.key === total) ?? rows[0]!;
  return { section, row: row.key, col, cell: row.cells[col]! };
}

/** Suit state of a two-card Spanish 21 6-7-8 / 7-7-7 start, or null when it is not one. */
export function setStartSuit(cards: readonly Card[]): SuitState | null {
  if (cards.length !== 2) return null;
  const vals = cards.map((c) => rankValue(c.rank)).sort((a, b) => a - b).join(',');
  if (!['6,7', '6,8', '7,8', '7,7'].includes(vals)) return null;
  if (cards[0]!.suit !== cards[1]!.suit) return 'm';
  return cards[0]!.suit === 's' ? 'p' : 's';
}

export interface VariantAdvice {
  action: Action;
  /** The cell code it was read from, e.g. 'S4*'. */
  code: string;
  section: SectionId;
  row: number;
  /** In the shape strategy.ts writes, so the spoken correction stays clip-covered. */
  reason: string;
  /** A second play graded right ('either' cells): the other chart's play. */
  alsoRight?: Action;
  /** The cell's disagreement with the published chart, when it has one. */
  note?: Disagreement;
}

function basicReason(action: Action, up: Rank): string {
  return `Basic ${action} vs dealer ${up === 'J' || up === 'Q' || up === 'K' ? '10' : up}`;
}

/**
 * The right play for a hand under a variant chart, with what the hand may do.
 *
 * `table` is 'main' for Spanish 21 and Switch, and 'real' or 'free' for Free
 * Bet (a free hand is one a free split made: only a free-bet token on it).
 */
export function variantPlay(
  preset: PresetId,
  table: string,
  cards: readonly Card[],
  up: Rank,
  ctx: PlayContext,
): VariantAdvice {
  const ref = variantCellFor(preset, table, cards, up, ctx.canSplit);
  const graded = gradedCell(preset, table, ref.section, ref.row, ref.col, ref.cell);
  const code = graded.code;
  const suit = PRESETS[preset].cardBonuses ? setStartSuit(cards) : null;
  // The computed cell's no-double / no-surrender plays belong to the computed
  // code; a published code falls back by its own second letter.
  const fallbacks = graded.overridden ? {} : ref.cell;
  const action = actionFor(code, cards.length, suit, ctx, fallbacks);
  const advice: VariantAdvice = { action, code, section: ref.section, row: ref.row, reason: basicReason(action, up) };
  if (graded.note) advice.note = graded.note;
  if (graded.note?.grade === 'either' && graded.other !== null) {
    const other = actionFor(graded.other, cards.length, suit, ctx, {});
    if (other !== action) advice.alsoRight = other;
  }
  return advice;
}

function actionFor(
  code: string,
  n: number,
  suit: SuitState | null,
  ctx: PlayContext,
  fallbacks: Pick<GenCell, 'noDouble' | 'noSurrender'>,
): Action {
  let act: VAct = playFor(code, n, suit);
  if (act === 'R' && !ctx.canSurrender) {
    act = fallbacks.noSurrender ?? fallbackOf(parseCode(code).base);
  }
  if ((act === 'D' || act === 'FD') && !ctx.canDouble) {
    const base = parseCode(code).base;
    act = fallbacks.noDouble ?? (base === 'Dh' || base === 'Ds' ? fallbackOf(base) : 'H');
  }
  if ((act === 'P' || act === 'FP') && !ctx.canSplit) act = 'H';
  return ACTION_OF[act];
}

/**
 * Spanish 21 after a double: stand, rescue (surrender) or, in a redouble game,
 * double again. `total`/`soft` are the doubled hand's.
 */
export function afterDoublePlay(preset: PresetId, total: number, soft: boolean, up: Rank): VariantAdvice {
  const rows: AfterDoubleRow[] = presetData(preset).afterDouble ?? [];
  const row = rows.find((r) => r.key === total && r.soft === soft);
  const col = upColumn(up);
  const computed: VAct = row ? row.cells[col]! : 'S';
  const d = DISAGREEMENT_BY_KEY.get(`${preset}:afterDouble:${soft ? 'soft' : 'hard'}:${total}:${col === 9 ? 11 : col + 2}`);
  const act: VAct = d?.grade === 'published' ? (d.published as VAct) : computed;
  const action = ACTION_OF[act];
  const advice: VariantAdvice = { action, code: act, section: soft ? 'SOFT' : 'HARD', row: total, reason: basicReason(action, up) };
  if (d) advice.note = d;
  if (d?.grade === 'either') {
    const other = ACTION_OF[d.published as VAct];
    if (other !== action) advice.alsoRight = other;
  }
  return advice;
}

/** The plays a variant hand may make. */
export function variantLegal(preset: PresetId, cards: readonly Card[], ctx: PlayContext): Action[] {
  const out: Action[] = ['hit', 'stand'];
  const rules = PRESETS[preset];
  if (ctx.canDouble && (cards.length === 2 || rules.doubleAnyCards)) out.push('double');
  if (ctx.canSplit && cards.length === 2 && rankValue(cards[0]!.rank) === rankValue(cards[1]!.rank)) out.push('split');
  if (ctx.canSurrender && cards.length === 2) out.push('surrender');
  return out;
}
