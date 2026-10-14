import { ResultStrip } from './ResultStrip';
import { plainCellLabel } from '../../drills/cellLabel';
import { CLASS_COPY } from '../mistakeCopy';
import {
  correctLine,
  isTimeout,
  progressLostLine,
  resultHandLine,
  resultPlayLabel,
  type HandResult,
} from '../handResult';
import './handResultStrip.css';

/**
 * B1 `HandResultStrip`: the previous hand's result, shown while the next hand
 * is already up (#8, #14, #17), built on the shared ResultStrip shell.
 *
 * Everything printed comes from `result`, a snapshot taken when the answer
 * was graded (ui/handResult.ts) -- never from the hand now on screen. "Show
 * on chart" hands that snapshot back to the caller for the same reason (#10).
 *
 * - Correct: one line, "Correct! A,2 v 7 — Hit", fading after 2.5s.
 * - Wrong: the exact cards, what you played, the right play, the reason, and
 *   in mastery the progress the miss cost. It stays until the next answer.
 */
export function HandResultStrip({
  result,
  onShowChart,
}: {
  result: HandResult;
  /** Opens the chart on the ANSWERED hand. Omitted when there is no chart
   *  cell for it (an insurance question). */
  onShowChart?: (result: HandResult) => void;
}) {
  const sr = result.sr ? (
    <div className="feedback-sr hand-result-sr" data-box={result.sr.box}>
      {result.sr.text}
    </div>
  ) : null;

  if (result.correct) {
    return (
      <ResultStrip id={result.id} tone="ok">
        <div className="hand-result" data-cell-id={result.cellId} data-result-id={result.id}>
          <div className="hand-result-ok result-correct">{correctLine(result)}</div>
          {result.label && <div className="hand-result-label quiz-label">{result.label}</div>}
          {/* Right or wrong, the table this was asked for is worth saying. */}
          {result.note && <p className="hand-result-note quiz-table-note">{result.note}</p>}
          {sr}
        </div>
      </ResultStrip>
    );
  }

  const copy =
    result.classification && result.classification !== 'correct'
      ? CLASS_COPY[result.classification]
      : undefined;
  const reason = plainCellLabel(result.reason);

  return (
    <ResultStrip id={result.id} tone="miss">
      <div className="hand-result" data-cell-id={result.cellId} data-result-id={result.id}>
        <div className="hand-result-head">
          {/* `result-wrong` is the app-wide hook for a graded miss. */}
          <span className="hand-result-verdict result-wrong">{isTimeout(result) ? 'Too slow' : 'Wrong'}</span>
          <span className="hand-result-hand" data-testid="hand-result-hand">
            {resultHandLine(result)}
          </span>
        </div>
        {result.progressLost && (
          <div className="hand-result-lost mastery-reset-banner" role="alert">
            {progressLostLine(result.progressLost)}
          </div>
        )}
        <div className="hand-result-plays">
          <span className="hand-result-play">
            You played <strong data-testid="hand-result-taken">{resultPlayLabel(result.taken)}</strong>
          </span>
          <span className="hand-result-play">
            Right play <strong data-testid="hand-result-expected">{resultPlayLabel(result.expected)}</strong>
          </span>
        </div>
        <div className="hand-result-foot">
          <p className="hand-result-reason">
            {copy && <span className="hand-result-class">{copy.label}. </span>}
            {reason}
          </p>
          {onShowChart && (
            <button type="button" className="hand-result-chart-btn" onClick={() => onShowChart(result)}>
              Show on chart
            </button>
          )}
        </div>
        {/* No table note on a miss: at 375x812 it pushed the next hand's
            answer buttons below the fold. The rules chip (#26) has already
            said, before the answer, that surrender was off, and "Show on
            chart" opens the overlay's own note reconciling the graded play
            with the chart cell. */}
        {sr}
      </div>
    </ResultStrip>
  );
}
