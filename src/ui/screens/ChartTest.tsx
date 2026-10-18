import { useMemo, useState } from 'react';
import './chartTest.css';
import type { Action } from '../../engine/deviations';
import type { RuleSet } from '../../engine/ruleset';
import { PAINT_UPCARDS, cellIdAt, cellsInRect } from '../../drills/cellSelection';
import type { PaintSection } from '../../drills/cellSelection';
import { TEST_TABLES, gradeChartTest, recordChartTest, scoreLine, tableCellIds } from '../../drills/chartTest';
import type { ChartTestResult } from '../../drills/chartTest';
import { usePaintStroke } from '../components/usePaintStroke';

/**
 * F12 (W2-21, D3): Charts "Test me". A blank chart for the active profile's
 * rules, one table at a time; paint every cell from memory with the Custom
 * painter's own stroke (usePaintStroke: tap, or press and drag across cells;
 * a row label or a dealer heading paints the whole row or column) in the one
 * action palette (F8), then Check.
 *
 * Check grades every cell (drills/chartTest.ts): the misses are ringed and
 * show the right play in its colour, the score reads "Hard: 31/34", and each
 * miss goes to Review as a wrong answer, due now. Cells painted right are not
 * recorded -- see chartTestEvents.
 *
 * Check waits until every cell is painted. A blank is graded as a miss, and a
 * half-painted table checked by accident would put every blank into Review.
 *
 * Charts shows this only as its own screen and never in eyes-free: it is
 * nothing but looking.
 */

const BRUSHES: readonly { action: Action; letter: string; label: string }[] = [
  { action: 'hit', letter: 'H', label: 'Hit' },
  { action: 'stand', letter: 'S', label: 'Stand' },
  { action: 'double', letter: 'D', label: 'Double' },
  { action: 'split', letter: 'P', label: 'Split' },
  { action: 'surrender', letter: 'R', label: 'Surrender' },
];
const LETTER = Object.fromEntries(BRUSHES.map((b) => [b.action, b.letter])) as Record<Action, string>;
const LABEL = Object.fromEntries(BRUSHES.map((b) => [b.action, b.label])) as Record<Action, string>;

type Painted = Partial<Record<PaintSection, Record<string, Action>>>;

export function ChartTest({ rules }: { rules: RuleSet }) {
  const [section, setSection] = useState<PaintSection>('hard');
  const [brush, setBrush] = useState<Action>('hit');
  const [painted, setPainted] = useState<Painted>({});
  const [results, setResults] = useState<Partial<Record<PaintSection, ChartTestResult>>>({});

  const table = TEST_TABLES.find((t) => t.section === section)!;
  const mine = painted[section] ?? {};
  const result = results[section];
  const ids = useMemo(() => tableCellIds(section), [section]);
  const left = ids.filter((id) => !mine[id]).length;
  const graded = useMemo(() => new Map(result?.cells.map((c) => [c.cellId, c])), [result]);

  const paint = (cellIds: string[]) => {
    if (result) return;
    setPainted((prev) => {
      const next = { ...(prev[section] ?? {}) };
      for (const id of cellIds) if (ids.includes(id)) next[id] = brush;
      return { ...prev, [section]: next };
    });
  };
  const strokeHandlers = usePaintStroke(paint, () => {});

  const check = () => {
    if (left > 0 || result) return;
    const r = gradeChartTest(mine, rules, section);
    recordChartTest(r, Date.now());
    setResults((prev) => ({ ...prev, [section]: r }));
  };

  const again = () => {
    setResults((prev) => ({ ...prev, [section]: undefined }));
    setPainted((prev) => ({ ...prev, [section]: {} }));
  };

  const first = table.rows[0]!;
  const last = table.rows[table.rows.length - 1]!;

  return (
    <div className="ct" data-testid="chart-test">
      <div className="ct-tables" role="group" aria-label="Table to test">
        {TEST_TABLES.map((t) => (
          <button
            key={t.section}
            type="button"
            className="ct-table-btn"
            aria-pressed={t.section === section}
            onClick={() => setSection(t.section)}
          >
            {t.title}
            {results[t.section] && <span className="ct-table-score"> {results[t.section]!.right}/{results[t.section]!.total}</span>}
          </button>
        ))}
      </div>

      <p className="ct-hint">
        {result
          ? 'Ringed cells were wrong; each shows the right play, and each is due for review now.'
          : 'Paint every cell from memory, then Check. Tap or drag across cells; tap a total or a dealer card to paint its whole row or column.'}
      </p>

      <div
        className="ct-grid"
        role="grid"
        aria-label={`${table.title}: paint each cell from memory`}
        data-section={section}
        data-checked={result ? 'true' : undefined}
        {...(result ? {} : strokeHandlers)}
      >
        <div className="ct-row" role="row">
          <span className="ct-corner" role="columnheader">
            Dealer
          </span>
          {PAINT_UPCARDS.map((up) => (
            <span className="ct-head" role="columnheader" key={up}>
              <button
                type="button"
                className="ct-up"
                disabled={Boolean(result)}
                aria-label={`Paint the dealer ${up} column`}
                onClick={() => paint(cellsInRect(cellIdAt(first, up), cellIdAt(last, up)))}
              >
                {up}
              </button>
            </span>
          ))}
        </div>
        {table.rows.map((row) => (
          <div className="ct-row" role="row" key={row.key} data-row={`${row.section}-${row.key}`}>
            <span className="ct-head" role="rowheader">
              <button
                type="button"
                className="ct-label"
                disabled={Boolean(result)}
                aria-label={`Paint the ${row.label} row`}
                onClick={() => paint(cellsInRect(cellIdAt(row, PAINT_UPCARDS[0]!), cellIdAt(row, PAINT_UPCARDS[9]!)))}
              >
                {row.label}
              </button>
            </span>
            {PAINT_UPCARDS.map((up) => {
              const id = cellIdAt(row, up);
              const g = graded.get(id);
              const miss = g ? !g.correct : false;
              // A miss shows the RIGHT play, ringed: what to remember, not
              // what was painted (that is in its label).
              const shown = miss ? g!.expected : mine[id];
              const label = !shown
                ? `${row.label} v ${up}: blank`
                : g
                  ? miss
                    ? `${row.label} v ${up}: wrong, you painted ${g.painted ? LABEL[g.painted] : 'nothing'}; correct is ${LABEL[g.expected]}`
                    : `${row.label} v ${up}: ${LABEL[shown]}, correct`
                  : `${row.label} v ${up}: ${LABEL[shown]}`;
              return (
                <div
                  key={up}
                  role="gridcell"
                  className="ct-cell"
                  data-cell={id}
                  data-act={shown}
                  data-miss={miss ? 'true' : undefined}
                  aria-label={label}
                >
                  <span aria-hidden="true">{shown ? LETTER[shown] : ''}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="ct-bar">
        {result ? (
          <div className="ct-done">
            <p className="ct-score" data-testid="chart-test-score" role="status">
              {scoreLine(result)}
            </p>
            <button type="button" className="ct-again" onClick={again}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="ct-brushes" role="radiogroup" aria-label="Brush">
              {BRUSHES.map((b) => (
                <button
                  key={b.action}
                  type="button"
                  role="radio"
                  aria-checked={brush === b.action}
                  aria-label={b.label}
                  className="ct-brush"
                  data-act={b.action}
                  onClick={() => setBrush(b.action)}
                >
                  {b.letter}
                </button>
              ))}
            </div>
            <div className="ct-check-row">
              <span className="ct-left" data-testid="chart-test-left">
                {left === 0 ? 'All painted' : `${left} left`}
              </span>
              <button type="button" className="ct-check" disabled={left > 0} onClick={check}>
                Check
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
