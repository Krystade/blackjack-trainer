import { useEffect, useMemo, useRef, useState } from "react";
import "./variantCharts.css";
import type { PresetId } from "../../engine/variants/rules";
import {
  PRESETS,
  PRESET_LABEL,
  presetSummary,
  presetsOf,
} from "../../engine/variants/rules";
import { chartRules } from "../../engine/variants/chartGen";
import type { GenTable, SectionId } from "../../engine/variants/chartGen";
import { evTable, switchChoice } from "../../engine/variants/ev";
import { SOURCES } from "../../engine/variants/published";
import {
  VARIANT_DATA,
  presetData,
  switchValueRows,
} from "../../engine/variants/strategy";
import { DEALER_UPCARDS } from "./chartRows";
import type { RowOrder } from "./chartRows";
import {
  MARK_TEXT,
  codeFamily,
  describeCode,
  disagreementGroups,
  disagreementLabel,
  formatSwitchValue,
  legendFor,
  rowHolds,
  variantSectionRows,
} from "./variantChartView";
import type { VariantHighlight } from "./variantChartView";

/**
 * Wave L: the Free Bet, Spanish 21 and Switch charts.
 *
 * Painted straight from engine/variants/generated.json, the same data the
 * variant drill grades with (engine/variants/strategy.ts). Every cell, the
 * house edge and the "where this differs from the published chart" list are
 * computed by scripts/variantCharts.test.ts; nothing here authors a value.
 */

const SECTIONS: readonly { id: SectionId; title: string }[] = [
  { id: "HARD", title: "Hard totals" },
  { id: "SOFT", title: "Soft totals" },
  { id: "PAIRS", title: "Pairs" },
];

const SOURCE_OF: Record<string, string> = SOURCES;

function pct(n: number): string {
  return `${n.toFixed(2)}%`;
}

function VariantTable({
  table,
  order,
  highlight,
  showTitle,
  cellRef,
}: {
  table: GenTable;
  order: RowOrder;
  highlight?: VariantHighlight;
  showTitle: boolean;
  cellRef: React.MutableRefObject<HTMLTableCellElement | null>;
}) {
  return (
    <div className="variant-table" data-table={table.id}>
      {showTitle && <h2 className="variant-table-title">{table.title}</h2>}
      {SECTIONS.map((section) => {
        const rows = variantSectionRows(table, section.id, order);
        return (
          <section
            className="chart-section"
            data-section={section.id}
            key={section.id}
          >
            <h3 className="chart-section-title">{section.title}</h3>
            <div className="chart-frame">
              <div className="chart-grid">
                <table className="chart-table variant-chart-table">
                  <caption className="chart-caption">
                    {table.title}: {section.title}
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
                    {rows.map((row) => {
                      const rowHit =
                        highlight !== undefined &&
                        highlight.table === table.id &&
                        highlight.section === section.id &&
                        rowHolds(row, section.id, highlight.row);
                      return (
                        <tr data-row={row.id} key={row.id}>
                          <th scope="row" className="chart-rowlabel">
                            {row.label}
                          </th>
                          {row.actions.map((action, i) => {
                            const code = action as string;
                            const hit = rowHit && highlight!.col === i;
                            return (
                              <td
                                key={DEALER_UPCARDS[i]}
                                className="chart-cell variant-cell"
                                data-action={codeFamily(code)}
                                data-code={code}
                                data-long={code.length > 2 ? 'true' : undefined}
                                data-up={DEALER_UPCARDS[i]}
                                data-highlight={hit ? "true" : undefined}
                                aria-current={hit ? "true" : undefined}
                                ref={hit ? cellRef : undefined}
                                title={`${row.label} vs dealer ${DEALER_UPCARDS[i]}: ${describeCode(code)}${hit ? " — your hand" : ""}`}
                              >
                                {code}
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
          </section>
        );
      })}
    </div>
  );
}

/** Spanish 21 after a double: stand, rescue, or (redouble) double again. */
function AfterDoubleTable({ preset }: { preset: PresetId }) {
  const rows = presetData(preset).afterDouble ?? [];
  const rdd = PRESETS[preset].maxDoubles > 1;
  // Only the rows where the play is ever something other than stand.
  const shown = rows.filter((r) => r.cells.some((c) => c !== "S"));
  return (
    <section
      className="chart-section variant-after-double"
      data-testid="variant-after-double"
    >
      <h3 className="chart-section-title">
        After a double
        <span className="chart-section-blurb">
          {rdd
            ? "Doubled hands: stand, double again, or rescue (take back the double and the bet, lose half). Rows not shown: stand."
            : "Doubled hands: stand or rescue (take back the double, lose half the bet). Rows not shown: stand."}
        </span>
      </h3>
      <div className="chart-frame">
        <div className="chart-grid">
          <table className="chart-table variant-chart-table">
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
              {shown.map((r) => (
                <tr key={`${r.soft ? "s" : "h"}${r.key}`}>
                  <th scope="row" className="chart-rowlabel">
                    {r.soft ? `soft ${r.key}` : r.key}
                  </th>
                  {r.cells.map((c, i) => {
                    const code = c === "R" ? "R" : c === "D" ? "D" : "S";
                    return (
                      <td
                        key={i}
                        className="chart-cell variant-cell"
                        data-action={
                          code === "R" ? "Rs" : code === "D" ? "D" : "S"
                        }
                        data-code={code}
                      >
                        {code}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const SWITCH_CARDS: readonly { label: string; value: number }[] = [
  { label: "A", value: 11 },
  ...[2, 3, 4, 5, 6, 7, 8, 9].map((v) => ({ label: String(v), value: v })),
  { label: "10", value: 10 },
];

/** The two blackjack rows, short enough for the label column. */
const ROW_SHORT: Record<string, string> = { 'BJ (switched)': 'A,10', 'BJ (natural)': 'BJ' };

/** Switch: the hand values, and a checker for one deal. */
function SwitchGuide() {
  const rows = switchValueRows();
  const [cards, setCards] = useState<[number, number, number, number]>([
    10, 6, 11, 7,
  ]);
  const [up, setUp] = useState(10);
  const choice = useMemo(() => {
    const t = evTable(chartRules("switch"), up);
    return switchChoice(cards[0], cards[1], cards[2], cards[3], t);
  }, [cards, up]);
  const label = (v: number) => SWITCH_CARDS.find((c) => c.value === v)!.label;
  const setCard = (i: number, v: number) => {
    const next = [...cards] as [number, number, number, number];
    next[i] = v;
    setCards(next);
  };
  const select = (
    value: number,
    onChange: (v: number) => void,
    aria: string,
  ) => (
    <select
      className="variant-select"
      value={value}
      aria-label={aria}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {SWITCH_CARDS.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </select>
  );
  return (
    <section className="variant-switch" data-testid="variant-switch-guide">
      <h2 className="variant-table-title">When to switch</h2>
      <p className="variant-note">
        Switch the second cards when the two new hands are worth more than the
        two you were dealt. The table gives each hand&rsquo;s value against each
        dealer card, in hundredths of a bet; add the two values for each pairing
        and keep the larger. A dealt blackjack pays 1:1; a switched A,10 is only
        21.
      </p>
      <div className="variant-checker" data-testid="variant-switch-checker">
        <div className="variant-checker-row">
          <span>Hand 1</span>
          {select(cards[0], (v) => setCard(0, v), "Hand 1 first card")}
          {select(cards[1], (v) => setCard(1, v), "Hand 1 second card")}
          <span>Hand 2</span>
          {select(cards[2], (v) => setCard(2, v), "Hand 2 first card")}
          {select(cards[3], (v) => setCard(3, v), "Hand 2 second card")}
          <span>Dealer</span>
          {select(up, setUp, "Dealer up card")}
        </div>
        <p
          className="variant-checker-result"
          data-testid="variant-switch-result"
          data-switch={choice.switchIt}
        >
          {choice.switchIt
            ? `Switch: ${label(cards[0])},${label(cards[3])} and ${label(cards[2])},${label(cards[1])}`
            : `Keep: ${label(cards[0])},${label(cards[1])} and ${label(cards[2])},${label(cards[3])}`}{" "}
          <span className="variant-dim">
            (keep {formatSwitchValue(choice.keep)}, switch{" "}
            {formatSwitchValue(choice.swap)})
          </span>
        </p>
      </div>
      <div className="chart-frame">
        <div className="chart-grid">
          <table className="chart-table variant-values-table">
            <colgroup>
              <col className="chart-col-label" />
              {DEALER_UPCARDS.map((u) => (
                <col className="chart-col-up" key={u} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className="chart-corner">
                  Hand
                </th>
                {DEALER_UPCARDS.map((u) => (
                  <th scope="col" className="chart-up" key={u}>
                    {u}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="chart-rowlabel">
                    {ROW_SHORT[r.label] ?? r.label}
                  </th>
                  {r.values.map((v, i) => (
                    <td
                      key={i}
                      className="variant-value"
                      data-sign={v >= 0 ? "plus" : "minus"}
                    >
                      {formatSwitchValue(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function VariantNotes({ preset }: { preset: PresetId }) {
  const rules = PRESETS[preset];
  if (rules.variant === "freebet") {
    return (
      <ul className="variant-notes">
        <li>
          <strong>Free doubles</strong> on any hard 9, 10 or 11: the casino puts
          up the extra bet. A free double (FD) is never refused.
        </li>
        <li>
          <strong>Free splits</strong> on every pair but tens (FP). A hand a
          free split makes is a <em>free hand</em>: only the casino&rsquo;s
          token rides on it, so it plays from the second chart, more
          aggressively.
        </li>
        <li>
          <strong>Push 22:</strong> a dealer 22 pushes every hand still standing
          (a player blackjack still wins).
        </li>
      </ul>
    );
  }
  if (rules.variant === "spanish21") {
    return (
      <ul className="variant-notes">
        <li>
          <strong>Card counts:</strong> a number after a letter is a step: S4
          means stand, but hit once you hold four or more cards; D4 means
          double, but hit from four cards. The five-, six- and seven-card 21
          bonuses (3:2, 2:1, 3:1) are why.
        </li>
        <li>
          <strong>6-7-8 and 7-7-7</strong> pay a bonus, more when suited or in
          spades. A mark on a cell means play it differently when that bonus is
          still possible.
        </li>
        <li>
          <strong>Player 21 always wins</strong>, and late surrender is allowed.
          Double on any number of cards; after a double, see the rescue table.
        </li>
      </ul>
    );
  }
  return (
    <ul className="variant-notes">
      <li>
        <strong>Two hands, one switch:</strong> you may swap the second cards
        between your two hands before playing them.
      </li>
      <li>
        <strong>Blackjack pays 1:1</strong> and a dealer 22 pushes, so stiff
        hands stand less and doubles shrink.
      </li>
    </ul>
  );
}

export function VariantCharts({
  preset,
  order,
  highlight,
  onPreset,
}: {
  preset: PresetId;
  order: RowOrder;
  highlight?: VariantHighlight;
  /** Spanish 21's rule-set picker. Absent in the study overlay. */
  onPreset?: (preset: PresetId) => void;
}) {
  const data = presetData(preset);
  const rules = PRESETS[preset];
  const legend = useMemo(() => legendFor(data.tables), [data]);
  const groups = useMemo(
    () => disagreementGroups(VARIANT_DATA.disagreements, preset),
    [preset],
  );
  const siblings = presetsOf(rules.variant);
  const cellRef = useRef<HTMLTableCellElement | null>(null);
  const hlKey = highlight
    ? `${highlight.table}:${highlight.section}:${highlight.row}:${highlight.col}`
    : "";
  useEffect(() => {
    cellRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [hlKey]);

  return (
    <div
      className="variant-charts"
      data-testid="variant-charts"
      data-preset={preset}
    >
      {onPreset && siblings.length > 1 && (
        <div
          className="charts-modes variant-rules"
          role="group"
          aria-label="Rule set"
        >
          {siblings.map((id) => (
            <button
              key={id}
              type="button"
              className="charts-mode-btn"
              aria-pressed={id === preset}
              onClick={() => onPreset(id)}
            >
              {PRESET_LABEL[id].replace("Spanish 21, ", "")}
            </button>
          ))}
        </div>
      )}
      <p className="charts-ruleset">{presetSummary(rules)}</p>
      <p className="variant-edge" data-testid="variant-house-edge">
        House edge with this chart: <strong>{pct(data.houseEdge)}</strong>{" "}
        <span className="variant-dim">(computed, infinite deck)</span>
      </p>
      <VariantNotes preset={preset} />

      <div className="chart-legend">
        <h2 className="chart-legend-heading">Cell codes</h2>
        <ul className="chart-legend-list">
          {legend.entries.map((entry) => (
            <li className="chart-legend-item" key={entry.code}>
              <span
                className="chart-code variant-code"
                data-action={entry.family}
                data-code={entry.code}
                aria-hidden="true"
              >
                {entry.code}
              </span>
              <span className="chart-legend-text">{entry.label}</span>
            </li>
          ))}
        </ul>
        {legend.steps && (
          <p className="chart-legend-note">
            A digit is a card-count step: S5 means stand with up to four cards
            and hit with five or more.
          </p>
        )}
        {legend.marks.map((m) => (
          <p className="chart-legend-note" key={m}>
            <strong>{m}</strong> {MARK_TEXT[m]}
          </p>
        ))}
      </div>

      {data.tables.map((t) => (
        <VariantTable
          key={t.id}
          table={t}
          order={order}
          highlight={highlight}
          showTitle={data.tables.length > 1}
          cellRef={cellRef}
        />
      ))}
      {data.afterDouble && <AfterDoubleTable preset={preset} />}
      {rules.variant === "switch" && <SwitchGuide />}

      <section className="variant-differs" data-testid="variant-differs">
        <h2 className="variant-table-title">
          Where this differs from the published chart
        </h2>
        <p className="variant-note">
          Checked cell by cell against{" "}
          <a href={SOURCE_OF[rules.variant]} target="_blank" rel="noreferrer">
            Wizard of Odds
          </a>
          .{" "}
          {groups.length === 0
            ? "Every cell agrees."
            : "Each difference, and why:"}
        </p>
        {groups.map((g) => (
          <div className="variant-differs-group" key={g.reason}>
            <p className="variant-differs-reason">{g.reason}</p>
            <ul className="variant-differs-list">
              {g.cells.map((d) => (
                <li key={d.key}>
                  {disagreementLabel(d)}: published <code>{d.published}</code>,
                  computed <code>{d.computed}</code>
                  {d.margin !== null && (
                    <span className="variant-dim">
                      {" "}
                      ({d.margin.toFixed(4)} a bet)
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
