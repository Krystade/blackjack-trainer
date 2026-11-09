import { useEffect, useId, useRef, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { BottomSheet } from '../components/BottomSheet';
import { TERMS, type TermId } from './terms';
import { closeTerm, currentTerm, lastCloseWasByKey, openTerm, useOpenTerm } from './glossaryStore';
import './glossary.css';

/**
 * T2-2B: a word you can tap for a plain definition.
 *
 * Renders its children (or the term's label) as a button with a dotted
 * underline. Tapping it opens the definition in a BottomSheet fixed to the
 * foot of the screen -- never a centred modal: the device is passed round
 * and glanced at, so the board stays readable above it. A clear scrim above
 * the sheet closes it on a tap, so a tap meant to dismiss it cannot land on
 * an answer button behind it (the same rule as TabSettingsSheet).
 *
 * Inside a <label> (the profile's toggles) a tap must open the sheet and
 * NOT flip the checkbox, so the click is stopped and its default prevented.
 */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const owner = useId();
  const open = useOpenTerm();
  const isOpen = open?.owner === owner;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetId = `${owner}-sheet`;

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isOpen) closeTerm();
    else openTerm({ id, owner });
  };

  // Close with the screen it sits on: an open sheet whose word has gone
  // would otherwise stay up over the next screen.
  useEffect(
    () => () => {
      if (currentTerm()?.owner === owner) closeTerm();
    },
    [owner],
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="term"
        data-term={id}
        aria-expanded={isOpen}
        aria-controls={isOpen ? sheetId : undefined}
        onClick={onClick}
      >
        {children ?? TERMS[id].label}
      </button>
      {isOpen && <GlossarySheet id={id} sheetId={sheetId} returnTo={buttonRef} />}
    </>
  );
}

function GlossarySheet({
  id,
  sheetId,
  returnTo,
}: {
  id: TermId;
  sheetId: string;
  returnTo: RefObject<HTMLButtonElement | null>;
}) {
  const entry = TERMS[id];
  const layerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const layer = layerRef.current;
    // Keys typed here are the sheet's: the drills listen for answer keys on
    // `window`, and Escape behind the sheet would also leave the drill.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeTerm(true);
    };
    layer?.addEventListener('keydown', onKey);
    const back = returnTo.current;
    return () => {
      layer?.removeEventListener('keydown', onKey);
      // Focus goes back to the word after Escape, if it is still on screen.
      // After a tap, nothing keeps focus (see closeTerm).
      if (lastCloseWasByKey() && back && back.isConnected) back.focus({ preventScroll: true });
      else if (layer?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    };
  }, [returnTo]);

  return createPortal(
    <>
      <div className="glossary-scrim" data-testid="glossary-scrim" onClick={() => closeTerm()} />
      <div className="glossary-layer" id={sheetId} ref={layerRef} data-testid="glossary-sheet" data-term={id}>
        <BottomSheet title={entry.label}>
          <p className="glossary-def">{entry.def}</p>
          {entry.aka && <p className="glossary-aka">Also called {entry.aka.join(', ')}.</p>}
          <div className="glossary-actions">
            <button type="button" ref={closeRef} className="glossary-close" onClick={() => closeTerm()}>
              Close
            </button>
          </div>
        </BottomSheet>
      </div>
    </>,
    document.body,
  );
}
