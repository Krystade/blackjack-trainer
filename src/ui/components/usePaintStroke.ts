import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { cellsOnLine } from '../../drills/cellSelection';

/**
 * The painter's stroke: press a cell and drag, and every cell the finger
 * crosses is painted. Lifted out of CellPaintGrid (B2 + B4, #9) unchanged so
 * the chart test (F12) paints with exactly the same hand.
 *
 * The stroke is captured to the grid (setPointerCapture) and the cell under
 * the finger is found with elementFromPoint, because a captured pointer's
 * events all target the capturing element. A tap is a one-cell stroke. A fast
 * drag skips cells between pointer events, so each step paints the straight
 * line from the last cell (cellsOnLine). Cells are found by `data-cell`.
 *
 * Spread the returned handlers on the element that contains the cells.
 */
export function usePaintStroke(onPaint: (cellIds: string[]) => void, onStrokeEnd: () => void) {
  const stroke = useRef<{ pointerId: number; last: string } | null>(null);

  const cellUnder = (x: number, y: number): string | undefined => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('[data-cell]') as HTMLElement | null)?.dataset.cell;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
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

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const id = cellUnder(e.clientX, e.clientY);
    if (!id || id === s.last) return;
    onPaint(cellsOnLine(s.last, id));
    s.last = id;
  };

  const endStroke = (e: ReactPointerEvent<HTMLElement>) => {
    const s = stroke.current;
    if (!s || s.pointerId !== e.pointerId) return;
    stroke.current = null;
    onStrokeEnd();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: endStroke,
    onPointerCancel: endStroke,
    onLostPointerCapture: endStroke,
  };
}
