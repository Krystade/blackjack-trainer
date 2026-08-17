import { useEffect, useMemo, useRef, useState } from 'react';
import './charts.css';
import type { Screen } from '../App';
import type { Profile } from '../../store/types';
import { getChart } from '../../engine/charts';
import {
  ACTION_LEGEND,
  DEALER_UPCARDS,
  buildSectionRows,
  isHighlighted,
  normalizeRowOrder,
  parseHighlightParam,
  rulesetSummary,
} from './chartRows';
import type { ChartHighlight, ChartSection, RowOrder } from './chartRows';

export type { ChartHighlight, ChartSection, RowOrder } from './chartRows';
export { highlightForHand } from './chartRows';

/**
 * Viewable strategy charts (operator item #6).
 *
 * The tables are rendered straight out of getChart(activeProfile.rules) -- the
 * SAME assembled chart src/engine/strategy.ts grades against. Nothing here
 * authors, reorders or "fixes" a cell value; src/ui/screens/chartRows.ts does
 * the (pure, unit-tested) shaping and this file only paints it. That is what
 * makes the viewer trustworthy: if the chart on screen and the trainer's
 * grading ever disagreed, the operator would stop believing both.
 *
 * Row order is a reading preference, persisted under its own localStorage key
 * (CHART_ORDER_KEY) rather than in Settings -- it is not part of the game
 * definition, and it would be wrong to invalidate a saved profile over it.
 */

/** Its own key on purpose: not a Settings field, not part of a Profile. */
const CHART_ORDER_KEY = 'bjtrainer.chartOrder.v1';

const SECTIONS: readonly { id: ChartSection; title: string; blurb: string }[] = [
  { id: 'HARD', title: 'Hard totals', blurb: 'No ace, or an ace forced down to 1.' },
  { id: 'SOFT', title: 'Soft totals', blurb: 'An ace still counting as 11.' },
  { id: 'PAIRS', title: 'Pairs', blurb: 'Read before the totals — splitting decides first.' },
];

const LEGEND_TEXT = new Map(ACTION_LEGEND.map((entry) => [entry.code, entry.label]));

interface ChartsProps {
  onNavigate: (screen: Screen) => void;
  activeProfile: Profile;
  /**
   * Open scrolled to, and ringed around, exactly one cell.
   *
   * THIS IS THE INTEGRATION POINT for the graded-mistake panel: build the
   * descriptor with `highlightForHand(cards, dealerUp, rules, { canSplit })`
   * (re-exported above) and hand the result straight in --
   *
   *   const hit = highlightForHand(hand.cards, dealerUp, profile.rules);
   *   return hit ? <Charts ... highlight={hit} /> : <Charts ... />;
   *
   * highlightForHand returns null for a hand with no chart row (a bust
   * total); pass undefined in that case, and the screen simply opens
   * unhighlighted rather than pointing at an arbitrary neighbour.
   *
   * `row` may name a total that got folded into a collapsed row ('18+',
   * 'A,9-10') -- the row is resolved by membership, so hard 20 correctly
   * lights the 18+ row. `dealerUp` must be a column rank; highlightForHand
   * already normalizes J/Q/K to '10'.
   *
   * The ringed cell is scrolled into view on mount and whenever the
   * descriptor changes. Neighbours are never dimmed or hidden: the point of a
   * correction is seeing the decision against the ones either side of it.
   *
   * When omitted, the screen falls back to a `?cell=SECTION:ROW:UP` query
   * parameter (see parseHighlightParam) so the same view can be deep-linked.
   */
  highlight?: ChartHighlight;
}

export function Charts({ onNavigate, activeProfile, highlight }: ChartsProps) {
  const [order, setOrder] = useState<RowOrder>(() => {
    if (typeof window === 'undefined') return 'descending';
    try {
      return normalizeRowOrder(window.localStorage.getItem(CHART_ORDER_KEY));
    } catch {
      // Private-mode / blocked storage: the screen still works, it just
      // forgets the choice. Never let a preference read break the chart.
      return 'descending';
    }
  });

  // Prop wins; the query parameter is the deep-link/e2e fallback. Read once --
  // the app is a single mounted tree with no router, so the search string
  // cannot change under us without a full reload.
  const activeHighlight = useMemo(() => {
    if (highlight) return highlight;
    if (typeof window === 'undefined') return undefined;
    return parseHighlightParam(new URLSearchParams(window.location.search).get('cell'));
  }, [highlight]);

  const chart = useMemo(() => getChart(activeProfile.rules), [activeProfile.rules]);
  const rowsBySection = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        rows: buildSectionRows(chart, section.id, order),
      })),
    [chart, order],
  );

  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const scrollerRefs = useRef(new Map<ChartSection, HTMLDivElement | null>());

  const chooseOrder = (next: RowOrder) => {
    setOrder(next);
    try {
      window.localStorage.setItem(CHART_ORDER_KEY, next);
    } catch {
      // Same reasoning as the read above: a storage failure is not a reason
      // to refuse the toggle.
    }
  };

  // Horizontal centring is done by hand rather than via scrollIntoView's
  // `inline` option: the row-label column is position:sticky, so the browser
  // considers a cell "visible" while it is actually sitting UNDER the label.
  // Centring the cell in the scroller sidesteps that entirely, and then the
  // vertical scrollIntoView is asked for `inline: 'nearest'` so it does not
  // undo the centring it cannot reason about.
  const highlightKey = activeHighlight
    ? `${activeHighlight.section}:${activeHighlight.row}:${activeHighlight.dealerUp}`
    : '';
  useEffect(() => {
    const cell = cellRef.current;
    if (!cell || !activeHighlight) return;

    const scroller = scrollerRefs.current.get(activeHighlight.section);
    if (scroller) {
      const frame = scroller.getBoundingClientRect();
      const target = cell.getBoundingClientRect();
      scroller.scrollLeft += target.left - frame.left - (frame.width - target.width) / 2;
    }
    cell.scrollIntoView({ block: 'center', inline: 'nearest' });
    // highlightKey is the value identity of activeHighlight; re-running on the
    // object reference alone would re-scroll on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey]);

  return (
    <div className="charts-screen">
      <div className="charts-topbar">
        <button type="button" className="charts-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="charts-heading">Strategy Charts</div>
      </div>

      <p className="charts-ruleset">{rulesetSummary(activeProfile.rules)}</p>
      <p className="charts-provenance">Exactly the chart the trainer grades you against.</p>

      <div className="charts-order" role="group" aria-label="Row order">
        <span className="charts-order-label">Row order</span>
        <div className="charts-order-group">
          {(['descending', 'ascending'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`charts-order-btn${order === value ? ' charts-order-btn-active' : ''}`}
              aria-pressed={order === value}
              onClick={() => chooseOrder(value)}
            >
              {value === 'descending' ? 'Descending' : 'Ascending'}
            </button>
          ))}
        </div>
        <p className="charts-order-hint">
          {order === 'descending'
            ? 'Highest totals at the top, the way the printed charts read.'
            : 'Lowest totals at the top, counting up.'}
        </p>
      </div>

      <div className="chart-legend">
        <h2 className="chart-legend-heading">Cell codes</h2>
        <ul className="chart-legend-list">
          {ACTION_LEGEND.map((entry) => (
            <li className="chart-legend-item" key={entry.code}>
              <span className="chart-code" data-action={entry.code} aria-hidden="true">
                {entry.code}
              </span>
              <span className="chart-legend-text">{entry.label}</span>
            </li>
          ))}
        </ul>
        <p className="chart-legend-note">
          A second letter is the fallback, marked by the sliver down the cell&rsquo;s left edge.
        </p>
      </div>

      {rowsBySection.map((section) => (
        <section className="chart-section" data-section={section.id} key={section.id}>
          <h2 className="chart-section-title">
            {section.title}
            <span className="chart-section-blurb">{section.blurb}</span>
          </h2>

          <div className="chart-frame">
            <div
              className="chart-scroller"
              tabIndex={0}
              role="region"
              aria-label={`${section.title} chart, scrolls sideways`}
              ref={(el) => {
                scrollerRefs.current.set(section.id, el);
              }}
            >
              <table className="chart-table">
                <caption className="chart-caption">
                  {section.title} — {rulesetSummary(activeProfile.rules)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="chart-corner">
                      Dealer
                    </th>
                    {DEALER_UPCARDS.map((up) => (
                      <th scope="col" className="chart-up" key={up}>
                        {up}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => {
                    const rowHit = isHighlighted(row, section.id, activeHighlight);
                    return (
                      <tr key={row.id} data-row={row.id}>
                        <th scope="row" className="chart-rowlabel">
                          {row.label}
                        </th>
                        {row.actions.map((action, i) => {
                          const up = DEALER_UPCARDS[i];
                          const hit = rowHit && activeHighlight!.dealerUp === up;
                          return (
                            <td
                              key={up}
                              className="chart-cell"
                              data-action={action}
                              data-up={up}
                              data-highlight={hit ? 'true' : undefined}
                              // aria-current, not an extra hidden span: a cell's
                              // text content must stay exactly its code, so any
                              // reader (or test) can take it at face value.
                              aria-current={hit ? 'true' : undefined}
                              ref={hit ? cellRef : undefined}
                              title={`${row.label} vs dealer ${up}: ${LEGEND_TEXT.get(action) ?? action}${
                                hit ? ' — the hand under review' : ''
                              }`}
                            >
                              {action}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {section.id === 'PAIRS' && (
            <p className="chart-section-note">
              5,5 and 10,10 have no rows here on purpose: never split them. Play 5,5 as hard 10 and 10,10 as hard
              20.
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
