import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './tabSettingsSheet.css';

/**
 * The sheet a tab's gear opens (#33).
 *
 * Not BottomSheet: that one is docked in the table's action-bar slot, in the
 * flow of the screen, for a question the hand is waiting on. This is opened
 * from a topbar on three different screens, so it is fixed to the bottom of
 * the viewport and portalled out of whatever topbar the gear sits in.
 *
 * It never covers the whole board. The device is passed round and glanced
 * at, so the sheet takes the lower part of the screen at most and the felt
 * stays readable above it. The area above is a clear (undimmed) scrim that
 * closes the sheet on a tap, so a tap meant to dismiss it cannot land on Hit.
 */
export function TabSettingsSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.focus();
    // Keys typed in the sheet are the sheet's. The drills listen for answer
    // keys on `window`, so without this a key pressed on a focused control
    // here would also be graded as an answer behind it.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') closeRef.current();
    };
    sheet.addEventListener('keydown', onKey);
    return () => sheet.removeEventListener('keydown', onKey);
  }, []);

  return createPortal(
    <>
      <div className="tab-sheet-scrim" data-testid="tab-sheet-scrim" onClick={onClose} />
      <section
        ref={sheetRef}
        className="tab-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="tab-sheet-head">
          <h2 className="tab-sheet-title">{title}</h2>
          <button type="button" className="tab-sheet-done" onClick={onClose}>
            Done
          </button>
        </header>
        <div className="tab-sheet-body">{children}</div>
      </section>
    </>,
    document.body,
  );
}
