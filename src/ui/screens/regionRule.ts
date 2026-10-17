import type { Rank } from '../../engine/cards';
import { getChart } from '../../engine/charts';
import type { Chart, ChartAction } from '../../engine/charts';
import type { RuleSet } from '../../engine/ruleset';
import { DEALER_UPCARDS } from './chartRows';

/**
 * B7: the chart region a missed cell sits in, as one line a beginner can
 * learn from ("Hard 12–16 v 7–A: hit."). Derived from the assembled chart
 * for the ruleset -- no strategy is typed in here.
 */
export interface RegionRule {
  section: 'HARD' | 'SOFT' | 'PAIRS';
  rows: (number | Rank)[];
  ups: Rank[];
  action: ChartAction;
  text: string;
}

/** The only codes an assembled chart holds (engine/charts/types.ts). */
const PHRASE: Record<'H' | 'S' | 'Dh' | 'Ds' | 'P' | 'Rh' | 'Rs' | 'Rp', string> = {
  H: 'hit',
  S: 'stand',
  Dh: "double (hit if you can't)",
  Ds: "double (stand if you can't)",
  P: 'split',
  Rh: "surrender (hit if you can't)",
  Rs: "surrender (stand if you can't)",
  Rp: "surrender (split if you can't)",
};

function phraseFor(a: ChartAction): string {
  const p = (PHRASE as Record<string, string | undefined>)[a];
  if (p === undefined) throw new Error(`regionRule: unresolved chart action ${a}`);
  return p;
}

const ROW_RANGE = { HARD: [5, 21], SOFT: [13, 21] } as const;
const DASH = '\u2013';

function upsText(ups: Rank[]): string {
  if (ups.length === DEALER_UPCARDS.length) return 'any dealer card';
  if (ups.length === 1) return ups[0]!;
  return `${ups[0]}${DASH}${ups[ups.length - 1]}`;
}

function rowsLabel(section: 'HARD' | 'SOFT', lo: number, hi: number): string {
  const name = (n: number) => (section === 'HARD' ? String(n) : `A,${n - 11}`);
  const prefix = section === 'HARD' ? 'Hard' : 'Soft';
  if (lo === hi) return `${prefix} ${name(lo)}`;
  if (hi === 21) return `${prefix} ${name(lo)}+`;
  return `${prefix} ${name(lo)}${DASH}${section === 'HARD' ? hi : hi - 11}`;
}

/** Maximal horizontal run of `a` through column `col` in `row`. */
function horizontalRun(row: readonly ChartAction[], col: number): [number, number] {
  const a = row[col];
  let lo = col;
  let hi = col;
  while (lo > 0 && row[lo - 1] === a) lo -= 1;
  while (hi < row.length - 1 && row[hi + 1] === a) hi += 1;
  return [lo, hi];
}

function totalsRule(chart: Chart, section: 'HARD' | 'SOFT', row: number, col: number): RegionRule {
  const table = chart[section];
  const a = table[row]![col]!;
  const [cLo, cHi] = horizontalRun(table[row]!, col);
  const covers = (r: number) => {
    const cells = table[r];
    if (!cells) return false;
    for (let c = cLo; c <= cHi; c++) if (cells[c] !== a) return false;
    return true;
  };
  const [min, max] = ROW_RANGE[section];
  let lo = row;
  let hi = row;
  while (lo - 1 >= min && covers(lo - 1)) lo -= 1;
  while (hi + 1 <= max && covers(hi + 1)) hi += 1;
  const rows: number[] = [];
  for (let r = lo; r <= hi; r++) rows.push(r);
  const ups = DEALER_UPCARDS.slice(cLo, cHi + 1);
  return {
    section,
    rows,
    ups,
    action: a,
    text: `${rowsLabel(section, lo, hi)} v ${upsText(ups)}: ${phraseFor(a)}.`,
  };
}

export function regionRuleFor(cellId: string, rules: RuleSet): RegionRule | null {
  const m = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cellId);
  if (!m) return null;
  const [, kind, rowRaw, upRaw] = m;
  const col = DEALER_UPCARDS.indexOf(upRaw as Rank);
  if (col < 0) return null;
  const chart = getChart(rules);
  if (kind === 'pair') {
    const rank = rowRaw as Rank;
    const cells = chart.PAIRS[rank];
    if (cells) {
      const [cLo, cHi] = horizontalRun(cells, col);
      const ups = DEALER_UPCARDS.slice(cLo, cHi + 1);
      const a = cells[col]!;
      return {
        section: 'PAIRS',
        rows: [rank],
        ups,
        action: a,
        text: `${rank},${rank} v ${upsText(ups)}: ${phraseFor(a)}.`,
      };
    }
    const value = rank === 'A' ? 11 : Number(rank);
    if (!Number.isFinite(value)) return null;
    const hard = totalsRule(chart, 'HARD', value * 2, col);
    return {
      ...hard,
      text: `${rank},${rank}: never split, play it as hard ${value * 2}. ${hard.text}`,
    };
  }
  const row = Number(rowRaw);
  const section = kind === 'hard' ? 'HARD' : 'SOFT';
  const [min, max] = ROW_RANGE[section];
  if (!Number.isInteger(row) || row < min || row > max) return null;
  return totalsRule(chart, section, row, col);
}
