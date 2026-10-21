/**
 * Wave L: turn the variant EV engine (ev.ts) into charts.
 *
 * NOTHING here is a strategy value. Every cell is the highest-valued play
 * ev.ts finds for that hand; this module only decides how to WRITE the answer
 * down, in the notation the Wizard of Odds charts use, so the two can be
 * compared cell for cell (published.ts, variantCharts.test.ts).
 *
 * scripts/variantCharts.test.ts runs `generateAll()` and commits the result as
 * generated.json, which is what the app reads: the charts are reproducible
 * from the engine, and a change to the engine that moves a cell fails that
 * test until the data is regenerated on purpose.
 *
 * Cell notation (the chart legend in the app spells each one out):
 *   H S P           hit, stand, split
 *   Dh / Ds         double; if doubling is not allowed, hit / stand
 *   D               double (Spanish 21: doubling is always allowed)
 *   FD / FP         Free Bet free double / free split
 *   Rh / Rs / Rp    surrender; if not allowed, hit / stand / split
 *   S4, D5 ...      Spanish 21: that play, but HIT once the hand has 4 / 5 ... cards
 *   * ' "           Spanish 21: hit instead when a 6-7-8 (any suits / suited / spades) is possible
 */

import { PRESETS, PRESET_IDS } from './rules';
import type { PresetId, VariantRules } from './rules';
import {
  bestOf,
  decisionValues,
  evTable,
  roundReturn,
  standValue,
  actionValues,
  startState,
  switchHandValue,
  switchReturn,
  trackFor,
} from './ev';
import type { ActionValues, EvTable, HandState, StakeType, VAct } from './ev';

/** Column order, as every chart in the app: dealer 2-9, ten, ace. */
export const UP_VALUES: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

export type SectionId = 'HARD' | 'SOFT' | 'PAIRS';

export interface GenCell {
  /** What the chart cell shows, e.g. 'Dh', 'FD', 'S4*'. */
  code: string;
  /**
   * The play for this hand with 2, 3, ... cards (Spanish 21 only has more than
   * one entry: up to 7, its last bonus step). Surrender only ever at 2 cards.
   */
  plays: VAct[];
  /** Two-card play when doubling is not allowed (only when the play is a double). */
  noDouble?: VAct;
  /** Two-card play when surrender is not allowed (only when the play is surrender). */
  noSurrender?: VAct;
  /** EV gap between the best two-card play and the runner-up, 4 dp: how close the call is. */
  margin: number;
}

export interface GenRow {
  /** Hard/soft total, or a pair's card value (11 = aces). */
  key: number;
  cells: GenCell[];
}

export interface GenTable {
  /** 'main' for a single-chart game; Free Bet has 'real' and 'free'. */
  id: string;
  title: string;
  sections: Record<SectionId, GenRow[]>;
}

/** Spanish 21 after a double: stand, rescue (R) or, with redouble, double again (D). */
export interface AfterDoubleRow {
  key: number;
  soft: boolean;
  cells: VAct[];
}

/** One Switch starting hand's value per up card, after the peek. */
export interface SwitchValueRow {
  label: string;
  values: number[];
}

export interface GenPreset {
  preset: PresetId;
  /** House edge in percent, playing this strategy perfectly (infinite deck). */
  houseEdge: number;
  tables: GenTable[];
  afterDouble?: AfterDoubleRow[];
  switchValues?: SwitchValueRow[];
}

const HARD_ROWS = Array.from({ length: 18 }, (_, i) => i + 4); // 4..21
const SOFT_ROWS = Array.from({ length: 9 }, (_, i) => i + 13); // 13..21
const PAIR_ROWS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** Can a hand of `total` have exactly `n` cards? (Hard: no ace counting 11.) */
export function feasible(total: number, soft: boolean, n: number): boolean {
  if (soft) return total - 11 >= n - 1;
  // Hard with n cards: all of them 2+ (at least 2n), or an ace forced to count
  // as one, which needs the total to be 12+.
  return total >= 2 * n || (total >= 12 && total >= n + 1);
}

function without(vals: ActionValues, ...drop: VAct[]): ActionValues {
  const out: ActionValues = { ...vals };
  for (const a of drop) delete out[a];
  return out;
}

function margin(vals: ActionValues): number {
  const v = (Object.values(vals) as number[]).sort((a, b) => b - a);
  return v.length < 2 ? 0 : round4(v[0]! - v[1]!);
}

/** The base code for a two-card play, its fallbacks folded in. */
function baseCode(best: VAct, vals: ActionValues, rules: VariantRules): { code: string; noDouble?: VAct; noSurrender?: VAct } {
  if (best === 'R') {
    const fb = bestOf(without(vals, 'R'));
    const letter = fb === 'P' || fb === 'FP' ? 'p' : fb === 'S' ? 's' : 'h';
    return { code: `R${letter}`, noSurrender: fb };
  }
  if (best === 'D') {
    const fb = bestOf(without(vals, 'D', 'FD', 'R'));
    if (rules.doubleAnyCards) return { code: 'D', noDouble: fb };
    return { code: fb === 'S' ? 'Ds' : 'Dh', noDouble: fb };
  }
  return { code: best };
}

/** Hit-or-stand-or-double for the same total with more cards (Spanish 21). */
function playWithCards(total: number, soft: boolean, n: number, t: EvTable, stake: StakeType, split: boolean): VAct {
  const s = startState(total, soft, t, { n, stake, split, surrender: false });
  return bestOf(actionValues(s, t));
}

function totalCell(total: number, soft: boolean, t: EvTable, stake: StakeType, split: boolean): GenCell {
  const rules = t.rules;
  const s = startState(total, soft, t, { stake, split });
  const vals = actionValues(s, t);
  const best = bestOf(vals);
  const { code, noDouble, noSurrender } = baseCode(best, vals, rules);
  const plays: VAct[] = [best];
  let cellCode = code;
  if (rules.cardBonuses) {
    // The card-count steps. An impossible (total, cards) pair keeps the play
    // before it, so it cannot invent a step.
    for (let n = 3; n <= 7; n++) {
      plays.push(feasible(total, soft, n) ? playWithCards(total, soft, n, t, stake, split) : plays[plays.length - 1]!);
    }
    // The two-card play without surrender is what the steps continue from.
    const first = best === 'R' ? noSurrender! : best;
    const hitAt = plays.findIndex((p, i) => i > 0 && p === 'H' && first !== 'H');
    if (hitAt > 0) cellCode += String(hitAt + 2);
    // 6-7-8 marks, for the two-card hands that can start one.
    const comp: Record<number, [number, number]> = { 13: [6, 7], 14: [6, 8], 15: [7, 8] };
    const c = comp[total];
    if (!soft && c && !split) {
      const withTrack = (suit: 'm' | 's' | 'p') =>
        bestOf(without(actionValues(startState(total, soft, t, { stake, track: trackFor(c[0], c[1], suit) }), t), 'R'));
      const plain = bestOf(without(vals, 'R'));
      if (withTrack('m') !== plain) cellCode += '*';
      else if (withTrack('s') !== plain) cellCode += "'";
      else if (withTrack('p') !== plain) cellCode += '"';
    }
  }
  return {
    code: cellCode,
    plays,
    ...(noDouble ? { noDouble } : {}),
    ...(noSurrender ? { noSurrender } : {}),
    margin: margin(vals),
  };
}

function pairCell(pair: number, t: EvTable, stake: StakeType, split: boolean): GenCell {
  const rules = t.rules;
  const { total, soft } = pair === 11 ? { total: 12, soft: true } : { total: pair * 2, soft: false };
  const s: HandState = startState(total, soft, t, { stake, split });
  const vals = decisionValues(s, pair, t, stake);
  const best = bestOf(vals);
  const { code, noDouble, noSurrender } = baseCode(best, vals, rules);
  let cellCode = code;
  if (rules.cardBonuses && pair === 7 && !split) {
    const withTrack = (suit: 'm' | 's' | 'p') =>
      bestOf(without(decisionValues(startState(total, soft, t, { stake, track: trackFor(7, 7, suit) }), 7, t), 'R'));
    const plain = bestOf(without(vals, 'R'));
    if (withTrack('m') !== plain) cellCode += '*';
    else if (withTrack('s') !== plain) cellCode += "'";
    else if (withTrack('p') !== plain) cellCode += '"';
  }
  return {
    code: cellCode,
    plays: [best],
    ...(noDouble ? { noDouble } : {}),
    ...(noSurrender ? { noSurrender } : {}),
    margin: margin(vals),
  };
}

/**
 * The rules a chart is computed under. Free Bet's published chart marks the
 * cells to surrender "if possible", so its chart is computed with surrender
 * considered (Rh/Rs cells fall back to the no-surrender play); the house edge
 * uses the preset as dealt.
 */
export function chartRules(preset: PresetId): VariantRules {
  const rules = PRESETS[preset];
  return rules.variant === 'freebet' ? { ...rules, ls: true } : rules;
}

function table(id: string, title: string, rules: VariantRules, stake: StakeType, split: boolean): GenTable {
  const tables = UP_VALUES.map((up) => evTable(rules, up));
  const rows = (keys: number[], cell: (k: number, t: EvTable) => GenCell): GenRow[] =>
    keys.map((key) => ({ key, cells: tables.map((t) => cell(key, t)) }));
  return {
    id,
    title,
    sections: {
      HARD: rows(HARD_ROWS, (k, t) => totalCell(k, false, t, stake, split)),
      SOFT: rows(SOFT_ROWS, (k, t) => totalCell(k, true, t, stake, split)),
      PAIRS: rows(PAIR_ROWS, (k, t) => pairCell(k, t, stake, split)),
    },
  };
}

function afterDoubleTable(rules: VariantRules): AfterDoubleRow[] {
  const tables = UP_VALUES.map((up) => evTable(rules, up));
  const row = (key: number, soft: boolean): AfterDoubleRow => ({
    key,
    soft,
    cells: tables.map((t) => {
      const s: HandState = {
        ...startState(key, soft, t, { n: 3, surrender: false }),
        W: 2,
        L: 2,
        doubles: 1,
        postDouble: true,
      };
      return bestOf(actionValues(s, t), ['S', 'D', 'R']);
    }),
  });
  return [
    ...Array.from({ length: 16 }, (_, i) => row(i + 6, false)), // hard 6..21
    ...Array.from({ length: 9 }, (_, i) => row(i + 13, true)), // soft 13..21
  ];
}

function switchValues(rules: VariantRules): SwitchValueRow[] {
  const tables = UP_VALUES.map((up) => evTable(rules, up));
  const rows: SwitchValueRow[] = [];
  const add = (label: string, v1: number, v2: number, natural = true) =>
    rows.push({ label, values: tables.map((t) => round4(switchHandValue(v1, v2, natural, t))) });
  // Hard totals from two different non-ace cards (the value does not depend on
  // which two, infinite deck), then soft hands, the two ace-tens, then pairs.
  for (let total = 5; total <= 20; total++) {
    const lo = total <= 11 ? 2 : total - 10;
    const hi = total - lo;
    // 20 has only one make, 10,10; every other total has a non-pair make.
    if (total === 20) add('20', 10, 10);
    else add(String(total), lo === hi ? lo - 1 : lo, lo === hi ? hi + 1 : hi);
  }
  for (let k = 2; k <= 9; k++) add(`A,${k}`, 11, k);
  add('BJ (switched)', 11, 10, false);
  add('BJ (natural)', 11, 10, true);
  add('A,A', 11, 11);
  for (let k = 2; k <= 10; k++) add(`${k},${k}`, k, k);
  return rows;
}

export function generatePreset(preset: PresetId): GenPreset {
  const rules = PRESETS[preset];
  const cr = chartRules(preset);
  const houseEdge = round4(-(rules.variant === 'switch' ? switchReturn(rules) : roundReturn(rules)) * 100);
  const tables: GenTable[] =
    rules.variant === 'freebet'
      ? [table('real', 'Real-money hand', cr, 'real', false), table('free', 'Free hand (after a free split)', cr, 'free', true)]
      : [table('main', 'Basic strategy', cr, 'real', false)];
  return {
    preset,
    houseEdge,
    tables,
    ...(rules.variant === 'spanish21' ? { afterDouble: afterDoubleTable(rules) } : {}),
    ...(rules.variant === 'switch' ? { switchValues: switchValues(rules) } : {}),
  };
}

export function generateAll(): Record<PresetId, GenPreset> {
  const out = {} as Record<PresetId, GenPreset>;
  for (const id of PRESET_IDS) out[id] = generatePreset(id);
  return out;
}

/** Re-exported for the stand-value cross-check in tests. */
export { standValue };
