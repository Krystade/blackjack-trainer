import type { Rank } from '../engine/cards';
import type { CustomSelection, SelectionTier, Stats } from '../store/types';

/**
 * B2 (#9): the Custom drill's selection -- chart cells painted with a tier
 * (Off / Rare / Regular / Focus) -- as pure data and pure transforms.
 *
 * Cell ids are the flashcards' format ("hard-16-v-10", "soft-18-v-A",
 * "pair-8-v-A"), the same key B3's per-cell stats use, so a painted cell, a
 * drawn flashcard and its accuracy all name one thing.
 *
 * Off is represented by ABSENCE from `tiers`, so a selection only stores the
 * cells someone chose to drill.
 */

export type CellStats = Stats['cellStats'];
/** A brush: one of the three drilled tiers, or Off. */
export type Brush = SelectionTier | 'off';

export const TIERS: readonly SelectionTier[] = ['focus', 'regular', 'rare'];
export const DEFAULT_MIX: CustomSelection['mix'] = { focus: 60, regular: 30, rare: 10 };

/** Auto's thresholds (spec #9): Focus below 78% accuracy, Regular below 92%. */
export const AUTO_FOCUS_BELOW = 0.78;
export const AUTO_REGULAR_BELOW = 0.92;

/* ------------------------------------------------------------------ */
/* The painter's grid: the flashcard universe, laid out as the chart.  */
/* ------------------------------------------------------------------ */

/** Dealer columns, in chart order (2..10, A). */
export const PAINT_UPCARDS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

export type PaintSection = 'hard' | 'soft' | 'pair';

export interface PaintRow {
  section: PaintSection;
  /** The total (hard/soft) or the pair rank. */
  key: string;
  /** What the label column reads: '16', 'A,7', '8,8'. */
  label: string;
}

/**
 * Rows per section, highest first (the chart's default order). Exactly the
 * cells `generateAllCells` deals: hard 5-19, soft 13-20, every pair rank.
 */
export const PAINT_SECTIONS: readonly { section: PaintSection; title: string; rows: readonly PaintRow[] }[] = [
  {
    section: 'hard',
    title: 'Hard totals',
    rows: Array.from({ length: 15 }, (_, i) => {
      const total = String(19 - i);
      return { section: 'hard' as const, key: total, label: total };
    }),
  },
  {
    section: 'soft',
    title: 'Soft totals',
    rows: Array.from({ length: 8 }, (_, i) => {
      const total = 20 - i;
      return { section: 'soft' as const, key: String(total), label: `A,${total - 11}` };
    }),
  },
  {
    section: 'pair',
    title: 'Pairs',
    rows: (['A', '10', '9', '8', '7', '6', '5', '4', '3', '2'] as const).map((rank) => ({
      section: 'pair' as const,
      key: rank,
      label: `${rank},${rank}`,
    })),
  },
];

export function cellIdAt(row: PaintRow, up: Rank): string {
  return `${row.section}-${row.key}-v-${up}`;
}

/** Every paintable cell id, in grid order. */
export const ALL_PAINT_CELL_IDS: readonly string[] = PAINT_SECTIONS.flatMap((s) =>
  s.rows.flatMap((row) => PAINT_UPCARDS.map((up) => cellIdAt(row, up))),
);

/** A cell's place on the grid: its section, row index and column index. */
export interface GridPos {
  section: PaintSection;
  row: number;
  col: number;
}

const POSITIONS = new Map<string, GridPos>();
for (const s of PAINT_SECTIONS) {
  s.rows.forEach((row, r) => {
    PAINT_UPCARDS.forEach((up, c) => POSITIONS.set(cellIdAt(row, up), { section: s.section, row: r, col: c }));
  });
}

export function gridPos(cellId: string): GridPos | undefined {
  return POSITIONS.get(cellId);
}

function idAtPos(section: PaintSection, row: number, col: number): string | undefined {
  const s = PAINT_SECTIONS.find((x) => x.section === section);
  const r = s?.rows[row];
  const up = PAINT_UPCARDS[col];
  return r && up ? cellIdAt(r, up) : undefined;
}

/**
 * The cells of the rectangle with corners `a` and `b` (inclusive). Both must
 * be in one section; across sections the rectangle is meaningless, so it is
 * just the two cells.
 */
export function cellsInRect(a: string, b: string): string[] {
  const pa = gridPos(a);
  const pb = gridPos(b);
  if (!pa || !pb) return [a, b].filter((id, i, all) => gridPos(id) && all.indexOf(id) === i);
  if (pa.section !== pb.section) return [a, b];
  const out: string[] = [];
  for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r++) {
    for (let c = Math.min(pa.col, pb.col); c <= Math.max(pa.col, pb.col); c++) {
      const id = idAtPos(pa.section, r, c);
      if (id) out.push(id);
    }
  }
  return out;
}

/**
 * The cells a straight stroke from `a` to `b` crosses, `a` and `b` included.
 * A fast drag delivers pointer moves several cells apart; painting only the
 * cells the events landed on would leave gaps the finger visibly passed
 * over. Across sections there is no straight path, so it is the two cells.
 */
export function cellsOnLine(a: string, b: string): string[] {
  const pa = gridPos(a);
  const pb = gridPos(b);
  if (!pa || !pb || pa.section !== pb.section) return a === b ? [a] : [a, b];
  const steps = Math.max(Math.abs(pb.row - pa.row), Math.abs(pb.col - pa.col));
  const out: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const id = idAtPos(pa.section, Math.round(pa.row + (pb.row - pa.row) * t), Math.round(pa.col + (pb.col - pa.col) * t));
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Selections                                                          */
/* ------------------------------------------------------------------ */

/**
 * The selection the editor starts from when none is saved: every cell
 * Regular, none hand-painted. It drills exactly like no selection at all
 * (every cell equally likely), so opening the editor changes nothing until
 * something is painted.
 */
export function defaultSelection(cellIds: readonly string[] = ALL_PAINT_CELL_IDS): CustomSelection {
  return {
    tiers: Object.fromEntries(cellIds.map((id) => [id, 'regular' as const])),
    painted: {},
    mix: { ...DEFAULT_MIX },
    favourMissed: false,
  };
}

/** The tier a cell is painted with, Off included. */
export function tierOf(sel: CustomSelection, cellId: string): Brush {
  return sel.tiers[cellId] ?? 'off';
}

/**
 * Paint `cellIds` with `brush`, marking each as hand-painted (Auto leaves
 * hand-painted cells alone -- including cells painted Off).
 */
export function paintCells(sel: CustomSelection, cellIds: readonly string[], brush: Brush): CustomSelection {
  const tiers = { ...sel.tiers };
  const painted = { ...(sel.painted ?? {}) };
  for (const id of cellIds) {
    if (brush === 'off') delete tiers[id];
    else tiers[id] = brush;
    painted[id] = true;
  }
  return { ...sel, tiers, painted };
}

export function paintCell(sel: CustomSelection, cellId: string, brush: Brush): CustomSelection {
  return paintCells(sel, [cellId], brush);
}

export function paintRect(sel: CustomSelection, a: string, b: string, brush: Brush): CustomSelection {
  return paintCells(sel, cellsInRect(a, b), brush);
}

/** Every cell Off and nothing hand-painted; the mix and the toggle are kept. */
export function clearSelection(sel: CustomSelection): CustomSelection {
  return { ...sel, tiers: {}, painted: {} };
}

/** right / (right + wrong), or undefined for a cell with no answers yet. */
export function accuracyOf(cellStats: CellStats, cellId: string): number | undefined {
  const t = cellStats?.[cellId];
  if (!t) return undefined;
  const n = t.right + t.wrong;
  return n > 0 ? t.right / n : undefined;
}

/** wrong / (right + wrong); 0 for a cell with no answers yet. */
export function missRateOf(cellStats: CellStats, cellId: string): number {
  const acc = accuracyOf(cellStats, cellId);
  return acc === undefined ? 0 : 1 - acc;
}

/**
 * Auto: a tier per cell from its accuracy -- Focus below 78%, Regular below
 * 92%, Rare at or above; a cell with no answers yet is Regular.
 *
 * Hand-painted cells are untouched: they keep their tier in `current` (or
 * stay Off when `current` has none for them). Returns the new `tiers`.
 */
export function autoTiers(
  cellIds: readonly string[],
  cellStats: CellStats,
  painted: CustomSelection['painted'],
  current: CustomSelection['tiers'] = {},
): CustomSelection['tiers'] {
  const out: CustomSelection['tiers'] = {};
  for (const id of cellIds) {
    if (painted?.[id]) {
      const kept = current[id];
      if (kept) out[id] = kept;
      continue;
    }
    const acc = accuracyOf(cellStats, id);
    if (acc === undefined) out[id] = 'regular';
    else if (acc < AUTO_FOCUS_BELOW) out[id] = 'focus';
    else if (acc < AUTO_REGULAR_BELOW) out[id] = 'regular';
    else out[id] = 'rare';
  }
  return out;
}

/**
 * Set one tier's share and rebalance the other two so the three still sum
 * to 100: the remainder is split between them in proportion to their current
 * shares (evenly when both are 0). Whole percents.
 */
export function setMixShare(
  mix: CustomSelection['mix'],
  tier: SelectionTier,
  value: number,
): CustomSelection['mix'] {
  const v = Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
  const [a, b] = TIERS.filter((t) => t !== tier) as [SelectionTier, SelectionTier];
  const rest = 100 - v;
  const pa = Math.max(0, mix[a]);
  const pb = Math.max(0, mix[b]);
  const shareA = pa + pb === 0 ? Math.round(rest / 2) : Math.round((rest * pa) / (pa + pb));
  return { ...mix, [tier]: v, [a]: shareA, [b]: rest - shareA } as CustomSelection['mix'];
}

/**
 * The selection as draw weights over `cellIds` (the cells the drill is
 * allowed to deal -- its scope).
 *
 * - Absent selection: every cell weighs 1.
 * - Off cells (and any cell not in `cellIds`) are omitted.
 * - Each tier's share of the session is `mix[tier]` percent, split evenly
 *   over that tier's cells. A tier with no cells in `cellIds` hands its
 *   share to the tiers that have cells, in proportion to their own shares.
 *   A tier whose share is 0 is not drawn, and its cells are omitted -- unless
 *   every tier with cells has a 0 share, in which case they split evenly
 *   rather than leave a painted selection undrawable.
 * - `favourMissed` multiplies each cell by (1 + its miss rate).
 *
 * Every returned weight is > 0. Weights are relative, not probabilities
 * (favourMissed makes the sum drift above the shares).
 */
export function customWeights(
  sel: CustomSelection | undefined,
  cellIds: readonly string[],
  cellStats?: CellStats,
): Map<string, number> {
  if (!sel) return new Map(cellIds.map((id) => [id, 1]));

  const byTier: Record<SelectionTier, string[]> = { focus: [], regular: [], rare: [] };
  for (const id of new Set(cellIds)) {
    const tier = sel.tiers[id];
    if (tier) byTier[tier].push(id);
  }
  const present = TIERS.filter((t) => byTier[t].length > 0);
  const share = (t: SelectionTier) => Math.max(0, sel.mix?.[t] ?? DEFAULT_MIX[t]);
  const total = present.reduce((sum, t) => sum + share(t), 0);

  const out = new Map<string, number>();
  for (const t of present) {
    const tierShare = total > 0 ? share(t) / total : 1 / present.length;
    if (tierShare <= 0) continue;
    const perCell = tierShare / byTier[t].length;
    for (const id of byTier[t]) {
      out.set(id, perCell * (sel.favourMissed ? 1 + missRateOf(cellStats, id) : 1));
    }
  }
  return out;
}
