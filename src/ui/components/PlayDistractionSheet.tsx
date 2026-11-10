import { useEffect, useState, type CSSProperties } from 'react';
import { BottomSheet } from './BottomSheet';
import { NumPad } from './NumPad';
import { PlayingCard } from './PlayingCard';
import { withMinusSigns } from '../../drills/signed';
import type { OtherTable } from '../../drills/otherTable';
import { OTHER_TABLE_PROMPT } from '../playDistraction';

/**
 * T1-1B: a Play distraction, the same sheet-and-keypad as the count check.
 * The sum is answered, then (with count checks on) the running count is asked:
 * was it kept through the talk?
 *
 * Owner 2026-11-10: or another table, dealt off its own shoe, whose count is
 * asked instead of a sum (`table`). Expert turns its cards over after a few
 * seconds.
 */
export function PlayDistractionSheet({
  prompt,
  onSubmit,
  banner,
  halves = false,
  table,
}: {
  prompt: string;
  /** Expert's division: the keypad takes a .5. */
  halves?: boolean;
  onSubmit: (answer: number) => void;
  /** The settled round's result: the sheet covers the felt's copy, which is hidden while this shows. */
  banner: string | null;
  /** Owner 2026-11-10: the other table to count, in place of the sum. */
  table?: OtherTable;
}) {
  return (
    <BottomSheet title={table ? OTHER_TABLE_PROMPT : "Quick: what's this?"}>
      {banner !== null && (
        <p className="count-sheet-banner" data-testid="distraction-sheet-banner">
          {banner}
        </p>
      )}
      {table ? (
        <OtherTableView table={table} />
      ) : (
        <p className="play-distraction-prompt" data-testid="play-distraction-prompt">
          {withMinusSigns(prompt)}
        </p>
      )}
      <NumPad label="Enter the answer" onSubmit={onSubmit} halves={halves} />
    </BottomSheet>
  );
}

/**
 * The other table: the dealer's up-card, then the seats three to a row, each
 * hand fanned so every card's corner shows. Cards are sized to the longest
 * hand (otherTable.css), so a Hard table of four-card hands still fits 375px.
 */
function OtherTableView({ table }: { table: OtherTable }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setHidden(false);
    if (table.hideAfterMs === undefined) return;
    const t = window.setTimeout(() => setHidden(true), table.hideAfterMs);
    return () => window.clearTimeout(t);
  }, [table]);
  const longest = Math.max(...table.seats.map((s) => s.length));
  const style = { ['--ot-cards']: longest, ['--ot-hide-ms']: `${table.hideAfterMs ?? 0}ms` } as CSSProperties;
  return (
    <div className="other-table" data-testid="play-other-table" data-hidden={hidden} style={style}>
      <div className="other-table-dealer">
        <span className="other-table-label">Dealer</span>
        <div className="other-table-hand" data-testid="other-table-dealer">
          <PlayingCard card={table.dealer} faceDown={hidden} />
        </div>
        {table.hideAfterMs !== undefined && (
          <span className="other-table-hide-note" data-testid="other-table-hide-note">
            {hidden ? 'Turned over: answer from memory.' : `Turns over in ${Math.round(table.hideAfterMs / 1000)} seconds.`}
            {!hidden && <span className="other-table-timer" aria-hidden="true" />}
          </span>
        )}
      </div>
      <ol className="other-table-seats" aria-label="Players">
        {table.seats.map((hand, i) => (
          <li key={i} className="other-table-seat" data-testid="other-table-seat">
            <div className="other-table-hand">
              {hand.map((c, j) => (
                <PlayingCard key={j} card={c} faceDown={hidden} />
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
