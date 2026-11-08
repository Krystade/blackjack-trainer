import { useState } from 'react';
import { cutOffText, resumeTitle, type ResumeFacts } from '../resumeCopy';
import './resumedShoeNote.css';

/**
 * Track 3: the line a resumed Play shows -- which round the shoe picks up
 * after, a round cut off, and a way out (New shoe). An inline strip, not a
 * modal: the table is there to be played, and a dismiss is a tap.
 */
export function ResumedShoeNote({ facts, onNewShoe }: { facts: ResumeFacts; onNewShoe: () => void }) {
  const [shown, setShown] = useState(true);
  // Read once: the age is when the table came back, not a ticking clock.
  const [now] = useState(() => Date.now());
  if (!shown) return null;
  const cut = cutOffText(facts);
  return (
    <div className="resumed-shoe-note" role="status" data-testid="resumed-shoe-note">
      <div className="resumed-shoe-text">
        <span>{resumeTitle(facts, now)}</span>
        {cut && <span className="resumed-shoe-cut" data-testid="resumed-shoe-cut">{cut}</span>}
      </div>
      <div className="resumed-shoe-actions">
        <button type="button" className="resumed-shoe-btn" onClick={onNewShoe} data-testid="resumed-new-shoe">
          New shoe
        </button>
        <button type="button" className="resumed-shoe-btn resumed-shoe-ok" onClick={() => setShown(false)} aria-label="Dismiss">
          OK
        </button>
      </div>
    </div>
  );
}
