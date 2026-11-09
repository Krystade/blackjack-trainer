import type { DrillHandResult } from './drillMiss';
import './missHistory.css';

/**
 * T2-2B: the principle behind the chart's play, under a basic-strategy miss
 * ("Dealer busts 42% with a 6 up. Stand on your stiff..."). The strip says
 * what the play was; this says why, so the next hand like it is reasoned
 * rather than remembered.
 */
export function MissWhyLine({ result }: { result: DrillHandResult | null }) {
  if (!result || result.correct || result.undone || !result.why) return null;
  return (
    <div className="miss-why" data-testid="miss-why">
      <span className="miss-why-label">Why: </span>
      {result.why}
    </div>
  );
}
