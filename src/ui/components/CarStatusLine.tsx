import type { CarStatus } from '../carStatus';
import './carStatus.css';

/**
 * F7: one row for the car -- hand, wheel, microphone, score. The hand gives
 * way first (ellipsis); the wheel, mic and score never shrink, because the
 * wheel text is what a glance at a red light is for.
 */
export function CarStatusLine({ hand, wheel, mic, score }: CarStatus) {
  return (
    <div className="car-status" data-testid="car-status" role="status">
      <span className="car-status-hand" data-part="hand">{hand}</span>
      <span className="car-status-wheel" data-part="wheel">{wheel}</span>
      <span className="car-status-mic" data-part="mic">{mic}</span>
      <span className="car-status-score" data-part="score">{score}</span>
    </div>
  );
}
