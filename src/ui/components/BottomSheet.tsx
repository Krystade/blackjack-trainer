import type { ReactNode } from 'react';
import './bottomSheet.css';

interface BottomSheetProps {
  title: string;
  children: ReactNode;
}

/**
 * A question docked in the action-bar area (#37). Unlike Modal it has no
 * backdrop and covers nothing above it: the board and the player's hand stay
 * in view while the count check or insurance is answered. The device is
 * passed around and glanced at, so a centred overlay over the cards is out.
 */
export function BottomSheet({ title, children }: BottomSheetProps) {
  return (
    <section className="bottom-sheet" role="region" aria-label={title}>
      <h2 className="bottom-sheet-title">{title}</h2>
      <div className="bottom-sheet-body">{children}</div>
    </section>
  );
}
