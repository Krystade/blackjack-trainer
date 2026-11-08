import type { PlayerHand } from '../../engine/game';
import { circleAfter, dollars } from '../chips';
import { ChipStack } from './ChipStack';
import './chips.css';

/**
 * Track 3: a hand's betting circle in chips, in place of "Bet: 4". In play it
 * holds the stake (doubled included). Settled, the dealer's payout sits beside
 * it -- 3:2 on a natural, $187.50 on $125 -- a loss empties it and a surrender
 * leaves half. Read off the hand's net, so a dealer's mispay is what you see.
 */
export function BetCircle({ hand, unit }: { hand: Pick<PlayerHand, 'bet' | 'doubled' | 'result' | 'net'>; unit: number }) {
  const c = circleAfter(hand, unit);
  const outcome = c.live ? 'live' : (hand.result ?? 'live');
  let label: string;
  if (c.live) label = dollars(c.stake);
  else if (c.paid > 0) label = `paid ${dollars(c.paid)}`;
  else if (hand.result === 'push') label = `push ${dollars(c.stake)}`;
  else if (hand.result === 'surrender') label = `back ${dollars(c.back)}`;
  else label = `${dollars(-c.stake)}`;
  return (
    <div
      className="hand-bet bet-circle"
      data-testid="bet-circle"
      data-dollars={c.stake}
      data-outcome={outcome}
      {...(c.paid > 0 ? { 'data-paid': c.paid } : {})}
    >
      <span className="bet-circle-ring">{c.back > 0 && <ChipStack amount={c.back} />}</span>
      {c.paid > 0 && (
        <span className="bet-circle-paid" aria-hidden="true">
          +<ChipStack amount={c.paid} />
        </span>
      )}
      <span className="bet-circle-label">{label}</span>
    </div>
  );
}
