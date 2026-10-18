import { useState, type ReactNode } from 'react';
import './controlsSummary.css';

/**
 * W2-7: once the first answer of a session is in, a hand drill's "what to
 * deal" controls (scope chips and deck, the goal line; the quiz's Ask and
 * Index) fold into one summary line -- a disclosure button, closed. A tap
 * opens them again, and closes them again; the choice holds for the rest of
 * the session. Before the first answer nothing changes: that is when the
 * controls are being set.
 *
 * Unmounted rather than hidden while closed, so nothing in them can take a
 * tap or a keypress meant for the hand.
 */
export function ControlsSummary({
  answered,
  summary,
  children,
}: {
  /** True once the session has graded an answer. */
  answered: boolean;
  summary: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!answered) return <>{children}</>;
  return (
    <>
      <button
        type="button"
        className="controls-summary"
        data-testid="controls-summary"
        aria-expanded={expanded}
        onClick={() => setExpanded((on) => !on)}
      >
        <span className="controls-summary-text">{summary}</span>
        <span className="controls-summary-chevron" aria-hidden="true" />
      </button>
      {expanded && children}
    </>
  );
}
