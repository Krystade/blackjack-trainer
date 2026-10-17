/**
 * B6: the line under a hand-drill miss strip -- what the mistake cost, which
 * miss this is on the chart cell, and how many of the cell's last five went
 * wrong. Parts that cannot be said honestly (no price, fewer than five
 * results) are dropped rather than guessed.
 */
import type { GradedEvent } from '../engine/grade';
import { cellAfter, type CellTally } from '../store/cellStats';
import { tallyCellIdFor } from '../store/stats';
import { MINUS } from './signed';

/** `hard-16-v-10` → `16 v 10`; `soft-18-v-9` → `A,7 v 9`; `pair-8-v-4` → `8,8 v 4`. */
export function shortCellLabel(cellId: string): string {
  const m = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cellId);
  if (!m) return cellId;
  const [, kind, total, up] = m;
  if (kind === 'pair') return `${total},${total} v ${up}`;
  if (kind === 'soft') return `A,${Number(total) - 11} v ${up}`;
  return `${total} v ${up}`;
}

/** 1st 2nd 3rd 4th … 11th 12th 13th … 21st. */
export function ordinal(n: number): string {
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}

const WINDOW = 5;

export function missHistoryLine(event: GradedEvent, cellBefore: CellTally | null): string | null {
  if (event.correct) return null;
  const id = tallyCellIdFor(event);
  if (id === null) return null;
  const after = cellAfter(cellBefore ?? undefined, event);
  const evCost = event.evCost;
  let cost = '';
  if (typeof evCost === 'number' && evCost >= 0) {
    cost = evCost >= 0.005 ? `${MINUS}${evCost.toFixed(2)} u · ` : 'under 0.01 u · ';
  }
  const recent = after.recent ?? '';
  let win = '';
  if (recent.length >= WINDOW) {
    const misses = [...recent.slice(-WINDOW)].filter((c) => c === '0').length;
    win = `, ${misses} of last ${WINDOW}`;
  }
  return `${cost}${ordinal(after.wrong)} miss on ${shortCellLabel(id)}${win}`;
}
