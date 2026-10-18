import { discardTicks } from './discardTicks';
import './discardTray.css';
import './discardTrayBare.css';

interface DiscardTrayProps {
  cardsDealt: number;
  decks: number;
  /**
   * F6 (W2-18): draw the whole-deck marks. Play turns them off once deck
   * estimation is on target (ui/trayFade.ts); the drills always draw them.
   */
  marks?: boolean;
}

/**
 * The live discard tray (R6, #38). The fill shows how much of the shoe is in
 * the tray; a mark at every whole deck, labelled with decks dealt, lets depth
 * be read by eye for the true count, the way a dealer's tray is read. Still no
 * exact count of cards: the estimate is the skill.
 */
export function DiscardTray({ cardsDealt, decks, marks = true }: DiscardTrayProps) {
  const fillPct = Math.min(98, Math.max(1, (cardsDealt / (decks * 52)) * 100));
  return (
    <div
      className="table-discard-tray discard-tray--ticked"
      aria-label="Discard tray"
      data-marks={marks ? undefined : 'off'}
    >
      <span className="table-discard-label">Discards</span>
      <div className="discard-scale">
        <div className="table-discard-frame">
          <div className="table-discard-fill" style={{ width: `${fillPct}%` }} />
        </div>
        {marks && discardTicks(decks).map((t) => (
          <span
            key={t.decksDealt}
            className="discard-tick"
            data-decks={t.decksDealt}
            style={{ left: `${t.pct}%` }}
            aria-hidden="true"
          >
            <span className="discard-tick-label">{t.decksDealt}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
