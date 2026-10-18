import { useMemo } from 'react';
import './cellPaintGrid.css';
import './paintTiersPaper.css';
import { getChart } from '../../engine/charts';
import type { RuleSet } from '../../engine/ruleset';
import type { CustomSelection } from '../../store/types';
import {
  PAINT_SECTIONS,
  PAINT_UPCARDS,
  cellIdAt,
  cellsInRect,
  tierOf,
} from '../../drills/cellSelection';
import { actionAt, familyOf } from '../../drills/chartFamily';
import { usePaintStroke } from './usePaintStroke';

/**
 * B2 + B4 (#9): the Custom drill's painter -- the chart, fit to the phone's
 * width, with each cell in its action colour and its tier laid over it.
 *
 * Tier overlay: brightness (Off is a ghost, Rare dim, Regular and Focus
 * full), pips (one to three), a brass ring on Focus, and a small corner dot
 * on a cell painted by hand (Auto leaves those alone).
 *
 * Painting: press a cell and drag; every cell the finger crosses takes the
 * brush (usePaintStroke, shared with the chart test). `touch-action: none`
 * sits on the CELLS only, so the page still scrolls from the row labels, the
 * headings and everything around the grid. Tapping a row label or a dealer
 * heading paints that whole row or column.
 */

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
  const strokeHandlers = usePaintStroke(onPaint, onStrokeEnd);

  const paintAll = (ids: string[]) => {
    onPaint(ids);
    onStrokeEnd();
  };

  return (
    <div className="cpg" {...strokeHandlers}>
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
