/**
 * Wave L: computed variant charts against the published ones, cell by cell.
 *
 * Pure. Used by scripts/variantCharts.test.ts, which writes the result into
 * generated.json (so the disagreement list ships beside the charts it is
 * about) and fails if any disagreement has no recorded reason.
 */

import { PUBLISHED, PUBLISHED_AFTER_DOUBLE, PUBLISHED_RESCUE, DISAGREEMENT_GRADES, DISAGREEMENT_REASONS } from './published';
import type { DisagreementGrade } from './published';
import type { GenPreset, SectionId } from './chartGen';
import { UP_VALUES, chartRules, feasible } from './chartGen';
import type { PresetId } from './rules';
import { PRESETS } from './rules';
import { actionValues, decisionValues, evTable, startState, trackFor } from './ev';
import type { ActionValues, EvTable, HandState, SuitState, VAct } from './ev';
import { playFor } from './cellCode';

export interface Disagreement {
  key: string;
  preset: PresetId;
  table: string;
  section: string;
  row: number;
  /** Dealer up card value, 2-11. */
  up: number;
  published: string;
  computed: string;
  /**
   * What the published play costs under this engine, in units of the bet:
   * value of the computed play minus value of the published one, at the first
   * hand (card count, 6-7-8 suit state) where the two codes call for different
   * plays. Null when the published play is not one this engine can value.
   */
  margin: number | null;
  /** Where that first difference is: '2 cards', '5 cards', 'suited 6-7-8 start' ... */
  at: string | null;
  reason: string | null;
  /** Which play is graded and shown (published.ts DISAGREEMENT_GRADES); null = not yet decided. */
  grade: DisagreementGrade | null;
}

/** Expand '5-8:H H ...' into one entry per key. */
export function expandRows(rows: readonly string[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const row of rows) {
    const [range, rest] = row.split(':') as [string, string];
    const cells = rest.trim().split(/\s+/);
    if (cells.length !== 10) throw new Error(`published row ${row} has ${cells.length} cells`);
    const [lo, hi] = range.split('-').map(Number) as [number, number | undefined];
    for (let k = lo; k <= (hi ?? lo); k++) out.set(k, cells);
  }
  return out;
}

/** Does a computed code say what the published one says? */
export function sameCell(published: string, computed: string): boolean {
  if (published === computed) return true;
  // Free Bet's chart prints a real-money double with no fallback.
  if (published === 'D' && (computed === 'Dh' || computed === 'Ds')) return true;
  // Spanish 21's 8,8 v A prints a bare R: surrender, fallback not given.
  return published === 'R' && /^R[hsp]$/.test(computed);
}

export { playFor };

const SET_STARTS: Record<number, [number, number]> = { 13: [6, 7], 14: [6, 8], 15: [7, 8] };

function valuesAt(
  t: EvTable,
  section: string,
  row: number,
  n: number,
  stake: 'real' | 'free',
  split: boolean,
  track: string,
): ActionValues {
  if (section === 'PAIRS') {
    const total = row === 11 ? 12 : row * 2;
    return decisionValues(startState(total, row === 11, t, { stake, split, track }), row, t, stake);
  }
  const soft = section === 'SOFT';
  return actionValues(startState(row, soft, t, { stake, split, n, track }), t);
}

function cost(vals: ActionValues, pub: VAct, comp: VAct): number | null {
  const a = vals[comp];
  const b = vals[pub];
  return a === undefined || b === undefined ? null : Math.round((a - b) * 1e4) / 1e4;
}

/** First place a published code and a computed code call for different plays, and its cost. */
export function cellMargin(
  preset: PresetId,
  table: string,
  section: SectionId,
  row: number,
  up: number,
  published: string,
  computed: string,
): { margin: number | null; at: string | null } {
  const rules = chartRules(preset);
  const t = evTable(rules, up);
  const stake = table === 'free' ? 'free' : 'real';
  const split = table === 'free';
  const soft = section === 'SOFT';
  const maxN = rules.cardBonuses && section !== 'PAIRS' ? 7 : 2;
  for (let n = 2; n <= maxN; n++) {
    if (section !== 'PAIRS' && !feasible(row, soft, n)) continue;
    const pub = playFor(published, n);
    const comp = playFor(computed, n);
    if (pub !== comp) return { margin: cost(valuesAt(t, section, row, n, stake, split, ''), pub, comp), at: `${n} cards` };
  }
  if (rules.cardBonuses) {
    const start: [number, number] | undefined =
      section === 'PAIRS' ? (row === 7 ? [7, 7] : undefined) : !soft ? SET_STARTS[row] : undefined;
    if (start) {
      for (const suit of ['m', 's', 'p'] as SuitState[]) {
        const pub = playFor(published, 2, suit);
        const comp = playFor(computed, 2, suit);
        if (pub !== comp) {
          const label = { m: 'mixed-suit', s: 'suited', p: 'spaded' }[suit];
          return {
            margin: cost(valuesAt(t, section, row, 2, stake, split, trackFor(start[0], start[1], suit)), pub, comp),
            at: `${label} ${start[0] === 7 && start[1] === 7 ? '7-7-7' : '6-7-8'} start`,
          };
        }
      }
    }
  }
  return { margin: null, at: null };
}

/** The cost of the published after-double play (S, D or R) under this engine. */
export function afterDoubleMargin(
  preset: PresetId,
  soft: boolean,
  row: number,
  up: number,
  published: string,
  computed: string,
): number | null {
  const t = evTable(PRESETS[preset], up);
  const s: HandState = { ...startState(row, soft, t, { n: 3, surrender: false }), W: 2, L: 2, doubles: 1, postDouble: true };
  return cost(actionValues(s, t), published as VAct, computed as VAct);
}

export function upLabel(up: number): string {
  return up === 11 ? 'A' : String(up);
}

export function compareAll(gen: Record<PresetId, GenPreset>): Disagreement[] {
  const out: Disagreement[] = [];
  const push = (d: Omit<Disagreement, 'key' | 'reason' | 'grade'>) => {
    const key = `${d.preset}:${d.table}:${d.section}:${d.row}:${d.up}`;
    out.push({ ...d, key, reason: DISAGREEMENT_REASONS[key] ?? null, grade: DISAGREEMENT_GRADES[key] ?? null });
  };

  for (const pub of PUBLISHED) {
    const table = gen[pub.preset].tables.find((t) => t.id === pub.table);
    if (!table) throw new Error(`no computed table ${pub.preset}/${pub.table}`);
    for (const section of ['HARD', 'SOFT', 'PAIRS'] as SectionId[]) {
      const rows = pub.sections[section];
      if (!rows) continue;
      for (const [key, cells] of expandRows(rows)) {
        const row = table.sections[section].find((r) => r.key === key);
        if (!row) throw new Error(`no computed row ${pub.preset}/${pub.table}/${section}/${key}`);
        cells.forEach((published, i) => {
          const cell = row.cells[i]!;
          if (sameCell(published, cell.code)) return;
          const up = UP_VALUES[i]!;
          push({
            preset: pub.preset,
            table: pub.table,
            section,
            row: key,
            up,
            published,
            computed: cell.code,
            ...cellMargin(pub.preset, pub.table, section, key, up, published, cell.code),
          });
        });
      }
    }
  }

  // Spanish 21 with redouble, after a double.
  const rdd = gen[PUBLISHED_AFTER_DOUBLE.preset].afterDouble!;
  for (const [soft, rows] of [
    [false, PUBLISHED_AFTER_DOUBLE.hard],
    [true, PUBLISHED_AFTER_DOUBLE.soft],
  ] as const) {
    for (const [key, cells] of expandRows(rows)) {
      const row = rdd.find((r) => r.key === key && r.soft === soft)!;
      cells.forEach((published, i) => {
        const computed = row.cells[i]!;
        if (published === computed) return;
        const up = UP_VALUES[i]!;
        push({
          preset: PUBLISHED_AFTER_DOUBLE.preset,
          table: 'afterDouble',
          section: soft ? 'soft' : 'hard',
          row: key,
          up,
          published,
          computed,
          margin: afterDoubleMargin(PUBLISHED_AFTER_DOUBLE.preset, soft, key, up, published, computed),
          at: 'after a double',
        });
      });
    }
  }

  // The non-redouble charts' rescue line covers hard 12-17 only.
  for (const preset of ['s21-h17', 's21-s17'] as const) {
    const ad = gen[preset].afterDouble!;
    for (let total = 12; total <= 17; total++) {
      const row = ad.find((r) => r.key === total && !r.soft)!;
      const ups = PUBLISHED_RESCUE.find((r) => r.total === total)?.ups ?? [];
      UP_VALUES.forEach((up, i) => {
        const published = ups.includes(up) ? 'R' : 'S';
        const computed = row.cells[i] === 'R' ? 'R' : 'S';
        if (published === computed) return;
        push({
          preset,
          table: 'afterDouble',
          section: 'hard',
          row: total,
          up,
          published,
          computed,
          margin: afterDoubleMargin(preset, false, total, up, published, computed),
          at: 'after a double',
        });
      });
    }
  }
  return out;
}
