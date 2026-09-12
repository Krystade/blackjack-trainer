import { shotClockOn } from '../../drills/shotClock';

/**
 * The countdown for R1's shot clock, shared by both hand drills so they cannot
 * drift apart.
 *
 * The bar is a pure CSS animation, not a JS ticker. A ticker would re-render the
 * whole drill view every frame (or every hundred milliseconds, and look like it)
 * for something the compositor draws for free, and it would keep running in a
 * backgrounded tab. The animation is `linear` and `forwards`, so a throttled tab
 * resumes at the right place and an expired bar stays empty rather than snapping
 * back to full.
 *
 * `key={restartKey}` is what makes it restart. A CSS animation does not replay
 * because a prop changed; the element has to be a new one. The caller passes
 * something that changes per card -- the run id both drills already keep for
 * their auto-advance guard -- and React remounts the bar with it.
 *
 * Renders nothing at all when the clock is off, rather than an empty track: an
 * inert progress bar sitting under every card is a permanent invitation to
 * wonder what it is measuring.
 */
export function ShotClockBar({
  limitMs,
  restartKey,
  paused = false,
}: {
  limitMs: number;
  restartKey: number | string;
  /** Freeze the bar where it is -- the answer is in, or a modal is over it. */
  paused?: boolean;
}) {
  if (!shotClockOn(limitMs)) return null;

  return (
    <div
      className="shot-clock"
      role="timer"
      aria-label={`${limitMs / 1000} second shot clock`}
      data-testid="shot-clock"
    >
      <div
        key={restartKey}
        className="shot-clock-fill"
        data-paused={paused ? 'true' : undefined}
        style={{ animationDuration: `${limitMs}ms` }}
      />
    </div>
  );
}
