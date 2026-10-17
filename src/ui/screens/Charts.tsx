import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { TabSettingsButton } from '../components/TabSettingsButton';
import './charts.css';
import './chartsThemes.css';
import './chartIndexes.css';
import type { Screen } from '../App';
import type { Profile } from '../../store/types';
import { getChart } from '../../engine/charts';
import { FloatingBackPill } from '../components/FloatingBackPill';
import { strategyRulesFor } from '../../store/profiles';
import { hardCellAction, indexList, indexesAtCell, surrenderComesFirst } from './indexChart';
import type { IndexEntry } from './indexChart';
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
  { id: 'HARD', title: 'Hard totals', blurb: 'No ace, or an ace that has to count as 1.' },
  { id: 'SOFT', title: 'Soft totals', blurb: 'An ace counting as 11.' },
  { id: 'PAIRS', title: 'Pairs', blurb: 'Check these first: decide whether to split before reading the totals.' },
];

const LEGEND_TEXT = new Map(ACTION_LEGEND.map((entry) => [entry.code, entry.label]));

/**
 * Where a column's centre sits across the full table width, for the caret on
 * the index note. Mirrors charts.css's B4 tracks: a 15% label column, then ten
 * 8.5% dealer columns.
 */
function columnCentre(i: number): string {
  return `${15 + (i + 0.5) * 8.5}%`;
}

/** One index line, as in the Indexes list: '16 v 10 · TC ≥ 0 · Stand'. */
function IndexLine({ entry }: { entry: IndexEntry }) {
  return (
    <>
      {/* The separators are real text, hidden from sight, so the line reads
          (and copies) as "16 v 10 · TC ≥ 0 · Stand" while the eye gets three
          aligned columns. */}
      <span className="index-hand">
        {entry.hand} <span className="index-v">v</span> {entry.dealer}
      </span>
      <span className="index-sep"> · </span>
      <span className="index-tc">{entry.index}</span>
      <span className="index-sep"> · </span>
      <span className="index-play" data-family={entry.family}>
        {entry.play}
      </span>
    </>
  );
}

/**
 * The line under an index whose cell the chart surrenders: the grader settles
 * surrender first, so the index is the play only once surrender is gone.
 */
function surrenderFirstLine(plays: readonly string[]): string {
  const names = [...new Set(plays.map((p) => p.toLowerCase()))].join(' and ');
  return `Surrender comes first while it’s allowed. The ${names} index is for when it isn’t, e.g. after a hit.`;
}

const INDEX_GROUPS: readonly { id: IndexEntry['group']; title: string }[] = [
  { id: 'illustrious', title: 'Illustrious 18' },
  { id: 'fab4', title: 'Fab 4 surrenders' },
  { id: 'extra', title: 'BJA H17 extras' },
];

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
  /**
   * One line reconciling this chart with the correction it was opened over
   * -- see screens/chartNote.ts. Absent when the page is opened on its own,
   * or when the chart and the grade agree.
   */
  note?: string;
  /**
   * What the Back control does. Defaults to navigating Home, which is right
   * when Charts IS the screen.
   *
   * The mistake panel's "Show me the table" (#7) opens this same component as
   * an overlay ON TOP of a live drill instead, because navigating away would
   * discard the card being corrected — and returning to a fresh, unrelated
   * card is precisely the opposite of anchoring a correction. That caller
   * passes a closer, so Back dismisses the overlay and the learner lands back
   * on the hand they got wrong.
   */
  onBack?: () => void;
  /** Names the return target, e.g. "the Table". Defaults to Home. */
  backLabel?: string;
  /**
   * Where Back sits. 'topbar' (the default) is the Charts screen's own
   * header. 'floating' is the study overlay's (#2): a pill pinned
   * bottom-centre that stays on screen however far the grids are scrolled,
   * because the cell being studied is often PAIRS, a long way below a header
   * Back.
   */
  backPlacement?: 'topbar' | 'floating';
  /** B7: the Back button's whole label, in place of "Back to <backLabel>". */
  backText?: string;
}

export function Charts({
  onNavigate,
  activeProfile,
  highlight,
  note,
  onBack,
  backLabel,
  backPlacement = 'topbar',
  backText: backTextProp,
}: ChartsProps) {
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

  // #23: the indexes the trainer GRADES with -- strategyRulesFor, not the bare
  // rules, because the Fab 4 are a profile choice and need surrender on.
  const indexes = useMemo(() => indexList(strategyRulesFor(activeProfile)), [activeProfile]);
  // The list's entries that sit on a surrender cell (see surrenderComesFirst).
  const surrenderFirst = useMemo(() => {
    const hardRows = rowsBySection.find((s) => s.id === 'HARD')?.rows ?? [];
    return indexes.entries.filter((e) => surrenderComesFirst(e, hardCellAction(e, hardRows)));
  }, [indexes, rowsBySection]);

  const cellRef = useRef<HTMLTableCellElement | null>(null);

  /*
   * #23: the one index note open on the grid, keyed `rowId:up`, or null.
   *
   * An inline row under the tapped cell's row rather than a floating popover:
   * it pushes the rows below down instead of covering them, so the cells
   * either side of the one being read stay visible -- the same reason the
   * highlight never dims its neighbours. One open at a time.
   */
  const [openIndexCell, setOpenIndexCell] = useState<string | null>(null);
  const indexNoteId = useId();

  useEffect(() => {
    if (!openIndexCell) return;
    // Any tap outside the note and the marked cells closes it. Capture phase,
    // so a tap that lands on something else (Back, the order toggle) still
    // does its own job as well. A tap on another marked cell is left to that
    // cell's click, which moves the note there.
    //
    // A TAP, not a touch: it closes on the pointerup. A finger put down to
    // scroll gets a pointercancel instead once the page starts panning, so
    // scrolling to read the rest of the note (or the rows it pushed down)
    // leaves it open.
    let outsidePointer: number | null = null;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      outsidePointer = target?.closest('.chart-index-note, [data-index-cell]') ? null : event.pointerId;
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== outsidePointer) return;
      outsidePointer = null;
      setOpenIndexCell(null);
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (event.pointerId === outsidePointer) outsidePointer = null;
    };
    // Escape closes it and puts focus back on the cell that opened it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const opener = [...document.querySelectorAll<HTMLElement>('[data-index-cell]')].find(
        (el) => el.dataset.indexCell === openIndexCell,
      );
      setOpenIndexCell(null);
      opener?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openIndexCell]);

  const chooseOrder = (next: RowOrder) => {
    setOrder(next);
    try {
      window.localStorage.setItem(CHART_ORDER_KEY, next);
    } catch {
      // Same reasoning as the read above: a storage failure is not a reason
      // to refuse the toggle.
    }
  };

  // B4: the grid fits the screen width, so only the vertical position needs
  // finding -- every column of the ringed cell's row is already on screen.
  const highlightKey = activeHighlight
    ? `${activeHighlight.section}:${activeHighlight.row}:${activeHighlight.dealerUp}`
    : '';
  useEffect(() => {
    const cell = cellRef.current;
    if (!cell || !activeHighlight) return;
    cell.scrollIntoView({ block: 'center', inline: 'nearest' });
    // highlightKey is the value identity of activeHighlight; re-running on the
    // object reference alone would re-scroll on every unrelated render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightKey]);

  const goBack = () => (onBack ? onBack() : onNavigate('home'));
  const backText = backTextProp ?? `Back to ${backLabel ?? 'Home'}`;

  return (
    <div className="charts-screen">
      <div className="charts-topbar">
        {/* Named after where you actually came from: Charts is reachable at
            any moment, and a hardcoded "Back to Home" threw away whatever
            drill or table you left to go and check a cell. */}
        {backPlacement === 'topbar' && (
          <button type="button" className="charts-back-btn" onClick={goBack}>
            {backText}
          </button>
        )}
        <div className="charts-heading">Strategy charts</div>
        {/* Only on the Charts screen itself. Over a live drill or table (the
            study overlay) a rules change would rebuild the game underneath. */}
        {backPlacement === 'topbar' && <TabSettingsButton tab="charts" />}
      </div>
      {backPlacement === 'floating' && <FloatingBackPill label={backText} onClick={goBack} />}

      <p className="charts-ruleset">{rulesetSummary(activeProfile.rules)}</p>
      {/* WHAT IT IS, rather than a promise it cannot keep. The old line --
          "Exactly the chart the trainer grades you against." -- is true of
          basic strategy and false of every counted hand, and this page is
          reached from corrections, including the deviations that contradict
          the cell being rung. */}
      <p className="charts-provenance">
        The basic strategy chart the trainer grades you against. A cell with a corner mark has a
        count index that can change it: tap the cell to see it. Every index is listed under
        Indexes, below the charts.
      </p>
      {note && <p className="charts-note">{note}</p>}

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
              {value === 'descending' ? 'Highest first' : 'Lowest first'}
            </button>
          ))}
        </div>
        <p className="charts-order-hint">
          {order === 'descending'
            ? 'Highest totals at the top, like most printed charts.'
            : 'Lowest totals at the top.'}
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
          A second letter is the play to make when the first isn&rsquo;t allowed. Those cells have a
          stripe down the left edge.
        </p>
        <p className="chart-legend-note chart-legend-mark">
          <span className="chart-code chart-code-indexed" data-action="S" aria-hidden="true">
            S
          </span>
          <span>A corner mark means the count can change that cell. Tap it to see the index.</span>
        </p>
      </div>

      {rowsBySection.map((section) => (
        <section className="chart-section" data-section={section.id} key={section.id}>
          <h2 className="chart-section-title">
            {section.title}
            <span className="chart-section-blurb">{section.blurb}</span>
          </h2>

          <div className="chart-frame">
            {/* B4: ten dealer columns and the row label fit the width of the
                phone (fixed layout, percentage columns), so nothing scrolls
                sideways and no column hides behind a fade. */}
            <div className="chart-grid">
              <table className="chart-table">
                <caption className="chart-caption">
                  {section.title} — {rulesetSummary(activeProfile.rules)}
                </caption>
                <colgroup>
                  <col className="chart-col-label" />
                  {DEALER_UPCARDS.map((up) => (
                    <col className="chart-col-up" key={up} />
                  ))}
                </colgroup>
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
                    const noteUp = DEALER_UPCARDS.findIndex((up) => openIndexCell === `${row.id}:${up}`);
                    const noteEntries =
                      noteUp >= 0 ? indexesAtCell(indexes.entries, section.id, row, DEALER_UPCARDS[noteUp]) : [];
                    const noteSurrenderFirst = noteEntries.filter((e) =>
                      surrenderComesFirst(e, row.actions[noteUp] ?? null),
                    );
                    return (
                      <Fragment key={row.id}>
                        <tr data-row={row.id}>
                          <th scope="row" className="chart-rowlabel">
                            {row.label}
                          </th>
                          {row.actions.map((action, i) => {
                            const up = DEALER_UPCARDS[i];
                            const hit = rowHit && activeHighlight!.dealerUp === up;
                            const cellKey = `${row.id}:${up}`;
                            const indexed = indexesAtCell(indexes.entries, section.id, row, up).length > 0;
                            const open = openIndexCell === cellKey;
                            const description = `${row.label} vs dealer ${up}: ${LEGEND_TEXT.get(action) ?? action}`;
                            return (
                              <td
                                key={up}
                                className="chart-cell"
                                data-action={action}
                                data-up={up}
                                data-highlight={hit ? 'true' : undefined}
                                data-index={indexed ? 'true' : undefined}
                                // aria-current, not an extra hidden span: a cell's
                                // text content must stay exactly its code, so any
                                // reader (or test) can take it at face value.
                                aria-current={hit ? 'true' : undefined}
                                ref={hit ? cellRef : undefined}
                                title={`${description}${indexed ? ' — has a count index' : ''}${
                                  hit ? ' — your hand' : ''
                                }`}
                              >
                                {indexed ? (
                                  // #23: only an indexed cell is a control, and its
                                  // text is still exactly the code.
                                  <button
                                    type="button"
                                    className="chart-cell-btn"
                                    data-index-cell={cellKey}
                                    aria-expanded={open}
                                    aria-controls={open ? indexNoteId : undefined}
                                    aria-label={`${description}. Show its count index`}
                                    onClick={() => setOpenIndexCell(open ? null : cellKey)}
                                  >
                                    {action}
                                  </button>
                                ) : (
                                  action
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {noteEntries.length > 0 && (
                          <tr className="chart-index-note-row">
                            <td colSpan={DEALER_UPCARDS.length + 1} className="chart-index-note-cell">
                              <div
                                className="chart-index-note"
                                id={indexNoteId}
                                role="note"
                                data-testid="chart-index-note"
                                style={{ '--caret': columnCentre(noteUp) } as CSSProperties}
                              >
                                <ul className="index-list">
                                  {noteEntries.map((e) => (
                                    <li className="index-item" key={e.id} data-index-id={e.id}>
                                      <IndexLine entry={e} />
                                    </li>
                                  ))}
                                </ul>
                                {noteSurrenderFirst.length > 0 && (
                                  <p className="chart-index-aside" data-testid="chart-index-surrender-first">
                                    {surrenderFirstLine(noteSurrenderFirst.map((e) => e.play))}
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {section.id === 'PAIRS' && (
            <p className="chart-section-note">
              5,5 and 10,10 aren&rsquo;t listed because you never split them. Play 5,5 as hard 10 and 10,10 as
              hard 20.
            </p>
          )}
        </section>
      ))}

      <section className="chart-indexes" aria-labelledby="chart-indexes-title" data-testid="chart-indexes">
        <h2 className="chart-section-title" id="chart-indexes-title">
          Indexes
          <span className="chart-section-blurb">
            Plays the true count changes. Once the count reaches the index, make that play;
            otherwise play the chart.
          </span>
        </h2>
        {INDEX_GROUPS.map((group) => {
          const entries = indexes.entries.filter((e) => e.group === group.id);
          if (entries.length === 0) return null;
          return (
            <div className="index-group" key={group.id} data-group={group.id}>
              <h3 className="index-group-title">{group.title}</h3>
              <ul className="index-list">
                {entries.map((e) => (
                  <li className="index-item" key={e.id} data-index-id={e.id}>
                    <IndexLine entry={e} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {surrenderFirst.length > 0 && (
          <p className="chart-section-note" data-testid="chart-indexes-surrender-first">
            {surrenderFirst.map((e) => `${e.hand} v ${e.dealer}`).join(', ')} sit on cells the chart
            surrenders. Surrender comes first while it&rsquo;s allowed; those indexes are for when it
            isn&rsquo;t, e.g. after a hit.
          </p>
        )}
        {indexes.inactive.map((line) => (
          <p className="chart-section-note" key={line}>
            {line}
          </p>
        ))}
      </section>
    </div>
  );
}
