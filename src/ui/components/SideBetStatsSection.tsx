import type { Stats } from '../../store/types';
import { sideBetStatsOf } from '../../store/sideBetStats';
import { BET_NAMES, SIDE_BET_IDS } from '../../engine/sideBets/payTables';
import { dollars } from '../sideBetFeedback';

/**
 * Wave L: side bets in Stats -- Play's calls per bet (right/wrong, how many
 * placed, net), and the side count drill's runs. Nothing recorded, nothing
 * shown but the line saying so.
 */
export function SideBetStatsSection({ stats }: { stats: Stats }) {
  const side = sideBetStatsOf(stats);
  const bets = SIDE_BET_IDS.filter((id) => side.play[id]);
  const drillRight = side.drill.reduce((n, r) => n + r.correct, 0);
  const drillAsked = side.drill.reduce((n, r) => n + r.checkpoints, 0);
  if (bets.length === 0 && side.drill.length === 0) {
    return <p className="stats-detail">No side bets played or drilled yet. Turn one on in your profile&rsquo;s Side bet section.</p>;
  }
  return (
    <ul className="mistake-list" data-testid="stats-side-bets">
      {bets.map((id) => {
        const t = side.play[id]!;
        const calls = t.right + t.wrong;
        return (
          <li key={id} className="mistake-row" data-testid="stats-side-row" data-bet={id}>
            <span>{BET_NAMES[id]}</span>
            <span>
              {t.right}/{calls} calls right · {t.placed} placed · {dollars(t.net)}
            </span>
          </li>
        );
      })}
      {side.drill.length > 0 && (
        <li className="mistake-row" data-testid="stats-side-drill">
          <span>Side count drill</span>
          <span>
            {side.drill.length} run{side.drill.length === 1 ? '' : 's'} · {drillRight}/{drillAsked} right
          </span>
        </li>
      )}
    </ul>
  );
}
