import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MarkerColour, Settings } from '../../store/types';
import { MARKER_COLOURS, MARKER_NAME, markerOf, withMarker } from '../../drills/markers';
import { plainCellLabel } from '../../drills/cellLabel';
import { saveSettings } from '../../store/persist';
import { useLongPress } from '../useLongPress';
import './markableHand.css';

/**
 * #31: the player's hand in Flashcards and Mastery, which a long press marks.
 *
 * Holding the hand for half a second opens a small picker of four colours and
 * "none"; the choice is kept per chart cell in `settings.drill.markers`, shows
 * as a dot in the hand's top corner whenever that cell is dealt, and feeds the
 * 'marked' deck.
 *
 * A long press must never answer the hand. The hand itself takes no answers,
 * and while the picker is open a backdrop sits over the whole screen -- the
 * answer bar included -- so the tap that dismisses it lands nowhere, and the
 * number keys are held back from the drill's keyboard handler.
 */
export function MarkableHand({
  cellId,
  handKey,
  settings,
  onSettingsChange,
  children,
}: {
  cellId: string;
  /** Changes whenever a new hand is dealt, even of the same cell. */
  handKey: unknown;
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  children: ReactNode;
}) {
  // The hand the picker was opened on: it closes by itself when the next
  // hand is dealt (even a repeat of the same cell), without an effect
  // writing state.
  const [openFor, setOpenFor] = useState<{ key: unknown } | null>(null);
  const open = openFor !== null && Object.is(openFor.key, handKey);
  const marker = markerOf(settings.drill, cellId);
  // On touch, lifting the finger that held the hand sends a click to
  // whatever is under it by then: the backdrop that just opened. Only a
  // press that STARTS on the backdrop dismisses the picker.
  const dismissArmed = useRef(false);
  const press = useLongPress(() => {
    dismissArmed.current = false;
    setOpenFor({ key: handKey });
  });

  // While the picker is up, keys belong to it: Escape closes it, and nothing
  // reaches the drill (whose 1-5 would answer the hand behind it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === 'Escape') setOpenFor(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const choose = (colour: MarkerColour | null) => {
    const next = withMarker(settings, cellId, colour);
    saveSettings(next);
    onSettingsChange(next);
    setOpenFor(null);
  };

  return (
    <div className="player-hand markable-hand" data-marker={marker ?? 'none'} {...press}>
      {children}
      {marker && (
        <span
          className={`marker-dot marker-${marker}`}
          role="img"
          aria-label={`${MARKER_NAME[marker]} marker`}
          data-testid="marker-dot"
        />
      )}
      {open && (
        <>
          <div
            className="marker-backdrop"
            data-testid="marker-backdrop"
            onPointerDown={(e) => {
              e.stopPropagation();
              dismissArmed.current = true;
            }}
            onClick={() => {
              if (dismissArmed.current) setOpenFor(null);
            }}
          />
          <div
            className="marker-picker"
            role="dialog"
            aria-label={`Marker for ${plainCellLabel(cellId)}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {MARKER_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                className={`marker-swatch marker-${c}`}
                aria-label={`${MARKER_NAME[c]} marker`}
                aria-pressed={marker === c}
                onClick={() => choose(c)}
              />
            ))}
            <button
              type="button"
              className="marker-swatch marker-none"
              aria-label="No marker"
              aria-pressed={marker === undefined}
              onClick={() => choose(null)}
            >
              None
            </button>
          </div>
        </>
      )}
    </div>
  );
}
