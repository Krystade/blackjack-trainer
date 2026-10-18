import type { Deviation, DeviationId } from '../../engine/deviations';
import type { IndexDirection, TallyRW } from '../../store/types';
import { indexRows } from '../screens/indexRows';
import { pct } from '../screens/statsFormat';
import './indexTable.css';

/**
 * E7 (W2-16): the per-index table on Stats -- Play's Indexes section and the
 * Deviation quiz section use the same one, each with its own slice (D-R2).
 *
 * Four columns that fit 375px: the index in its published wording (R6),
 * accuracy, Early and Late. Worst first; indexes never answered are one line,
 * "N not seen yet", rather than a column of dashes.
 */
export function IndexTable({
  asked,
  tally,
  direction,
  testId,
}: {
  asked: readonly Deviation[];
  tally: Partial<Record<DeviationId, TallyRW>> | undefined;
  direction: Partial<Record<DeviationId, IndexDirection>> | undefined;
  testId: string;
}) {
  const { seen, unseen } = indexRows(asked, tally, direction);
  return (
    <div className="index-dir" data-testid={testId}>
      {seen.length > 0 && (
        <table className="index-table index-dir-table">
          <thead>
            <tr>
              <th scope="col">Index</th>
              <th scope="col">Accuracy</th>
              <th scope="col" title="Index play taken short of the index">Early</th>
              <th scope="col" title="Index reached, chart play taken anyway">Late</th>
            </tr>
          </thead>
          <tbody>
            {seen.map((row) => (
              <tr key={row.id} data-index-id={row.id}>
                <td>
                  <span className="index-dir-hand">{row.hand}</span>
                  {row.play && <span className="index-dir-play">{row.play}</span>}
                </td>
                <td data-col="accuracy">
                  <span className="index-dir-pct">{pct(row.right, row.answered)}</span>
                  <span className="index-dir-frac">
                    {row.right}/{row.answered}
                  </span>
                </td>
                <td data-col="early">{row.early}</td>
                <td data-col="late">{row.late}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unseen > 0 && (
        <p className="index-dir-unseen" data-testid="index-unseen">
          {unseen} not seen yet
        </p>
      )}
    </div>
  );
}
