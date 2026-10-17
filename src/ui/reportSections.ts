/**
 * Wave B, B6/W12: the session report's figures. Mistakes grouped into rows,
 * split into Plays / Count checks / Bets, plays sorted by units lost, and the
 * chart cells "Drill these hands" hands to Custom.
 */
import type { GradedEvent } from '../engine/grade';
import { tallyCellIdFor } from '../store/stats';
import { ALL_PAINT_CELL_IDS } from '../drills/cellSelection';
import { signed, MINUS } from '../drills/signed';
import { playLabel } from './playLabel';

export interface MistakeRow {
  mistake: GradedEvent;
  count: number;
  /** Total evCost over the grouped events, or null when none was priced. */
  unitsTotal: number | null;
  /** The Custom-grid chart cell, or null (index play, insurance, no grid row). */
  cellId: string | null;
}

const PAINT = new Set(ALL_PAINT_CELL_IDS);

/**
 * Collapse repeats: two entries that display identically ARE the same finding,
 * and the first occurrence keeps its place (moved from Table.tsx).
 */
export function groupMistakes(mistakes: readonly GradedEvent[]): MistakeRow[] {
  const out: MistakeRow[] = [];
  const seen = new Map<string, MistakeRow>();
  for (const m of mistakes) {
    const key = [m.hand ?? m.kind, m.tc, m.taken, m.expected, m.reason].join('|');
    const hit = seen.get(key);
    if (hit) {
      hit.count += 1;
      if (m.evCost !== undefined) hit.unitsTotal = (hit.unitsTotal ?? 0) + m.evCost;
      continue;
    }
    const id = tallyCellIdFor(m);
    const row: MistakeRow = {
      mistake: m,
      count: 1,
      unitsTotal: m.evCost !== undefined ? m.evCost : null,
      cellId: id !== null && PAINT.has(id) ? id : null,
    };
    seen.set(key, row);
    out.push(row);
  }
  return out;
}

export function reportSections(mistakes: readonly GradedEvent[]): {
  plays: MistakeRow[];
  counts: MistakeRow[];
  bets: MistakeRow[];
} {
  const rows = groupMistakes(mistakes);
  const of = (...kinds: GradedEvent['kind'][]) => rows.filter((r) => kinds.includes(r.mistake.kind));
  const playRows = of('action', 'insurance');
  const priced = playRows.filter((r) => r.unitsTotal !== null).sort((a, b) => (b.unitsTotal ?? 0) - (a.unitsTotal ?? 0));
  const unpriced = playRows.filter((r) => r.unitsTotal === null);
  return {
    plays: [...priced, ...unpriced],
    counts: of('countCheck'),
    bets: [...of('bet'), ...of('wong')],
  };
}

/** "RC off by 2 · you said +2 · it was 0", or "RC not answered · it was −4". */
export function countMissText(m: GradedEvent): string {
  const label = /true/i.test(m.reason) ? 'TC' : 'RC';
  const expected = Number(m.expected);
  const was = Number.isFinite(expected) ? signed(expected) : m.expected.replace(/-/g, MINUS);
  const taken = m.taken.trim() === '' ? NaN : Number(m.taken);
  if (!Number.isFinite(taken) || !Number.isFinite(expected)) return `${label} not answered · it was ${was}`;
  return `${label} off by ${Math.abs(taken - expected)} · you said ${signed(taken)} · it was ${was}`;
}

/** Unique cell ids in row order. */
export function drillCellIds(rows: readonly MistakeRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (r.cellId !== null && !out.includes(r.cellId)) out.push(r.cellId);
  return out;
}

/** Units lost to priced mistakes: the sum of evCost. */
export function mistakeUnits(events: readonly GradedEvent[]): number {
  return events.reduce((sum, e) => sum + (e.evCost ?? 0), 0);
}

/** "+2", "+0", "−3": the report's signed numbers, real minus. */
const tcText = (n: number) => signed(n, { plusZero: true });

/** Insurance as the play rows print an action (B2 #49). */
const INSURANCE_LABEL: Record<string, string> = { take: 'Take', decline: 'Decline' };

/**
 * A Plays row: "{hand} · TC ±n · you played X · correct Y — reason". An
 * insurance row drops the reason (B2 #49): it only repeated the dealer card
 * and the TC, in lowercase with an ASCII hyphen.
 */
export function playRowText(m: GradedEvent): string {
  if (m.kind === 'insurance') {
    const label = (v: string) => INSURANCE_LABEL[v] ?? playLabel(v);
    return `${m.hand ?? 'Insurance'} · TC ${tcText(m.tc)} · you played ${label(m.taken)} · correct ${label(m.expected)}`;
  }
  return `${m.hand ?? m.kind} · TC ${tcText(m.tc)} · you played ${playLabel(m.taken)} · correct ${playLabel(m.expected)} — ${m.reason}`;
}

/**
 * A Bets row in plain words (B2 #15): "TC +0 · you bet 2u · your ramp bets
 * 1u", "TC −2 · you played · your ramp sits out". It used to print the raw
 * event -- "wong · TC +0 · you played play · correct sit-out — Wong decision
 * at tc 0".
 */
export function betRowText(m: GradedEvent): string {
  const tc = `TC ${tcText(m.tc)}`;
  if (m.kind === 'wong') {
    return m.taken === 'sit-out' ? `${tc} · you sat out · your ramp plays` : `${tc} · you played · your ramp sits out`;
  }
  const cover = /cover/i.test(m.reason) ? ' (one rung either side allowed)' : '';
  return `${tc} · you bet ${m.taken}u · your ramp bets ${m.expected}u${cover}`;
}

/** "Plus 1 index or insurance miss with no price." (B2 #49: singular for one). */
export function unpricedNote(n: number): string {
  return `Plus ${n} index or insurance ${n === 1 ? 'miss' : 'misses'} with no price.`;
}
