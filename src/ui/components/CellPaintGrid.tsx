import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import './cellPaintGrid.css';
import './paintTiersPaper.css';
import { getChart } from '../../engine/charts';
import type { Chart, ChartAction } from '../../engine/charts';
import type { RuleSet } from '../../engine/ruleset';
import type { Rank } from '../../engine/cards';
import type { CustomSelection } from '../../store/types';
import {
  PAINT_SECTIONS,
  PAINT_UPCARDS,
  cellIdAt,
  cellsInRect,
  cellsOnLine,
  tierOf,
} from '../../drills/cellSelection';
import type { PaintRow } from '../../drills/cellSelection';

/**
 * B2 + B4 (#9): the Custom drill's painter -- the chart, fit to the phone's
 * width, with each cell in its action colour and its tier laid over it.
 *
 * Tier overlay: brightness (Off is a ghost, Rare dim, Regular and Focus
 * full), pips (one to three), a brass ring on Focus, and a small corner dot
 * on a cell painted by hand (Auto leaves those alone).
 *
 * Painting: press a cell and drag; every cell the finger crosses takes the
 * brush. `touch-action: none` sits on the CELLS only, so the page still
 * scrolls from the row labels, the headings and everything around the grid.
 * The stroke is captured to the grid (setPointerCapture) and the cell under
 * the finger is found with elementFromPoint, because a captured pointer's
 * events all target the capturing element. A tap is a one-cell stroke.
 * Tapping a row label or a dealer heading paints that whole row or column.
 */

type Family = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

function familyOf(action: ChartAction): Family {
  switch (action) {
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
    case 'Dh':
    case 'Ds':
      return 'double';
    case 'P':
    case 'Ph':
    case 'Pd':
    case 'Ps':
      return 'split';
    default:
      return 'surrender';
  }
}

/**
 * The chart action governing a painter cell. A pair rank with no PAIRS row
 * (5,5 and 10,10 in every shipped chart) plays as its hard total, as the
 * engine does.
 */
function actionAt(chart: Chart, row: PaintRow, col: number): ChartAction {
  if (row.section === 'pair') {
    const pairRow = chart.PAIRS[row.key as Rank];
    if (pairRow) return pairRow[col]!;
    const v = row.key === 'A' ? 11 : Number(row.key);
    return chart.HARD[v * 2]?.[col] ?? 'S';
  }
  const table = row.section === 'hard' ? chart.HARD : chart.SOFT;
  return table[Number(row.key)]?.[col] ?? 'S';
}

const PIPS = { off: 0, rare: 1, regular: 2, focus: 3 } as const;
const TIER_NAME = { off: 'Off', rare: 'Rare', regular: 'Regular', focus: 'Focus' } as const;

export function CellPaintGrid({
  selection,
  rules,
  onPaint,
  onStrokeEnd,
}: {
  selection: CustomSelection;
  rules: RuleSet;
  /** Paint these cells with the current brush (called as the stroke grows). */
  onPaint: (cellIds: string[]) => void;
  /** The stroke (or a row/column tap) is finished: commit it. */
  onStrokeEnd: () => void;
}) {
  const chart = useMemo(() => getChart(rules), [rules]);
  const stroke = useRef<{ pointerId: number; last: string } | null>(null);

  const cellUnder = (x: number, y: number): string | undefined => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('[data-cell]') as HTMLElement | null)?.dataset.cell;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const id = ((e.target as Element).closest('[data-cell]') as HTMLElement | null)?.dataset.cell;
    if (!id) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic or already-released pointer: painting still works */
    }
    stroke.current = { pointerId: e.pointerId, last: id };
    onPaint([id]);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const id = cellUnder(e.clientX, e.clientY);
    if (!id || id === s.last) return;
    onPaint(cellsOnLine(s.last, id));
    s.last = id;
  };

  const endStroke = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    stroke.current = null;
    onStrokeEnd();
  };

  const paintAll = (ids: string[]) => {
    onPaint(ids);
    onStrokeEnd();
  };

  return (
    <div
      className="cpg"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onLostPointerCapture={endStroke}
    >
      {PAINT_SECTIONS.map((section) => {
        const first = section.rows[0]!;
        const last = section.rows[section.rows.length - 1]!;
        return (
          <section className="cpg-section" key={section.section} data-section={section.section}>
            <h3 className="cpg-title">{section.title}</h3>
            <div className="cpg-grid" role="grid" aria-label={`${section.title}: paint cells with the brush`}>
              <div className="cpg-row" role="row">
                <span className="cpg-corner" role="columnheader">
                  Dealer
                </span>
                {PAINT_UPCARDS.map((up) => (
                  <span className="cpg-head" role="columnheader" key={up}>
                    <button
                      type="button"
                      className="cpg-up"
                      aria-label={`Paint ${section.title.toLowerCase()} against dealer ${up}`}
                      onClick={() => paintAll(cellsInRect(cellIdAt(first, up), cellIdAt(last, up)))}
                    >
                      {up}
                    </button>
                  </span>
                ))}
              </div>
              {section.rows.map((row) => (
                <div className="cpg-row" role="row" key={row.key} data-row={`${row.section}-${row.key}`}>
                  <span className="cpg-head" role="rowheader">
                    <button
                      type="button"
                      className="cpg-label"
                      aria-label={`Paint the ${row.label} row`}
                      onClick={() =>
                        paintAll(cellsInRect(cellIdAt(row, PAINT_UPCARDS[0]!), cellIdAt(row, PAINT_UPCARDS[9]!)))
                      }
                    >
                      {row.label}
                    </button>
                  </span>
                  {PAINT_UPCARDS.map((up, col) => {
                    const id = cellIdAt(row, up);
                    const tier = tierOf(selection, id);
                    const action = actionAt(chart, row, col);
                    const painted = selection.painted?.[id] === true;
                    return (
                      <div
                        key={up}
                        role="gridcell"
                        className="cpg-cell"
                        data-cell={id}
                        data-tier={tier}
                        data-act={familyOf(action)}
                        data-painted={painted ? 'true' : undefined}
                        aria-label={`${row.label} v ${up}: ${TIER_NAME[tier]}${painted ? ', painted' : ''}`}
                      >
                        <span className="cpg-code" aria-hidden="true">
                          {action}
                        </span>
                        {PIPS[tier] > 0 && (
                          <span className="cpg-pips" aria-hidden="true">
                            {Array.from({ length: PIPS[tier] }, (_, i) => (
                              <span className="cpg-pip" key={i} />
                            ))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
