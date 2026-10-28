import { segmentDef } from '../../../guided/plan';
import type { GuidedSession, GuidedSummary } from '../../../guided/session';
import { deltaText, pctText } from './guidedFormat';

/**
 * Wave L (lane v): the end of a guided session -- each segment's answers and
 * accuracy, against the last guided session that ran it, the overall figure,
 * and the best and most improved segments in words.
 */
export function GuidedSummaryPanel({
  session,
  summary,
  onDone,
  onAgain,
}: {
  session: GuidedSession;
  summary: GuidedSummary;
  onDone: () => void;
  onAgain: () => void;
}) {
  const ended = session.outcome === 'ended';
  return (
    <div className="guided-panel guided-summary" data-testid="guided-summary" data-outcome={session.outcome ?? ''}>
      <header className="guided-panel-head">
        <span className="guided-kicker">
          Guided session · {session.preset} min{session.drive ? ' · Drive' : ''}
        </span>
      </header>
      <section className="guided-summary-hero">
        <h1 className="guided-summary-title">{ended ? 'Session ended' : 'Session done'}</h1>
        <div className="guided-summary-overall">
          <span className="guided-summary-pct" data-testid="guided-summary-pct">
            {pctText(summary.pct)}
          </span>
          <span className="guided-summary-sub">
            {summary.answers === 0 ? 'No answers this time' : `${summary.right} of ${summary.answers} right`}
          </span>
        </div>
        {(summary.best || summary.improved) && (
          <p className="guided-summary-notes">
            {summary.best && (
              <span>
                Best: <strong>{segmentDef(summary.best).label}</strong>
              </span>
            )}
            {summary.improved && (
              <span data-testid="guided-summary-improved">
                Most improved: <strong>{segmentDef(summary.improved).label}</strong>
              </span>
            )}
          </p>
        )}
      </section>
      <table className="guided-summary-table">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Right</th>
            <th scope="col">Acc.</th>
            <th scope="col">vs last</th>
          </tr>
        </thead>
        <tbody>
          {summary.rows.map((r) => {
            const d = deltaText(r.delta);
            return (
              <tr key={r.id} data-segment={r.id} data-skipped={r.skipped ? 'true' : undefined}>
                <th scope="row">
                  {r.label}
                  {r.skipped && <span className="guided-summary-tag">skipped</span>}
                </th>
                <td>{r.answers === 0 ? '—' : `${r.right}/${r.answers}`}</td>
                <td>{pctText(r.pct)}</td>
                <td data-sign={r.delta === null ? undefined : r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : 'flat'}>{d ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="guided-actions">
        <button type="button" className="u-btn u-btn-primary guided-main-btn" onClick={onDone}>
          Done
        </button>
        <div className="guided-actions-row">
          <button type="button" className="u-btn guided-small-btn" onClick={onAgain}>
            Another {session.preset} min
          </button>
        </div>
      </div>
    </div>
  );
}
