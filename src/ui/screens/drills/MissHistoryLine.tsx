import type { DrillHandResult } from './drillMiss';
import './missHistory.css';

/** B6: the band under a miss strip -- cost, which miss on the cell, last five. */
export function MissHistoryLine({ result }: { result: DrillHandResult | null }) {
  if (!result || result.correct || result.undone || !result.missLine) return null;
  return (
    <div className="miss-history" data-testid="miss-history">
      {result.missLine}
    </div>
  );
}
