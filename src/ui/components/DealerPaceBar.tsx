import './dealerPaceBar.css';

/**
 * F5 (W2-17): the dealer-pace clock, a thin bar draining over one decision.
 *
 * A CSS animation, like the drills' ShotClockBar and for the same reasons: no
 * ticker re-rendering the table every frame, and a throttled tab resumes at
 * the right place. `restartKey` changes per decision, which remounts the fill
 * and restarts the animation. When it runs out the track turns to the miss
 * colour and stays there -- nothing is played for you; the decision is only
 * tagged slow when it is taken (the measurement, not this bar, decides).
 */
export function DealerPaceBar({
  limitMs,
  restartKey,
  paused = false,
}: {
  limitMs: number;
  restartKey: string;
  /** A modal is over the hand: hold the bar where it is, as the clock holds. */
  paused?: boolean;
}) {
  return (
    <div
      key={restartKey}
      className="dealer-pace"
      role="timer"
      aria-label={`Dealer pace, ${limitMs / 1000} seconds`}
      data-testid="dealer-pace"
      data-paused={paused ? 'true' : undefined}
      style={{ ['--pace-ms' as string]: `${limitMs}ms` }}
    >
      <div className="dealer-pace-fill" />
    </div>
  );
}
