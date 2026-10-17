import { describe, it, expect } from 'vitest';
import { cardArrival, DEAL_IN_MS, BLANK_MAX_MS } from './cardArrive';
import { RAMP_FLOOR_MS } from './countSpeed';

/**
 * Wave A review (s04): every flashed count card visibly arrives, but the
 * arrival must not eat the card's time on screen. At Timed Challenge's 150ms
 * floor a fixed 220ms fade replaced each card before it was fully opaque.
 */
describe('how a flashed count card arrives', () => {
  it('a slow card gets the full deal-in and the full blank', () => {
    expect(cardArrival(2000)).toEqual({ arriveMs: DEAL_IN_MS, blankMs: BLANK_MAX_MS });
  });
  it('at the Timed Challenge floor the card is fully shown for most of its time', () => {
    const { arriveMs, blankMs } = cardArrival(RAMP_FLOOR_MS);
    expect(arriveMs).toBeLessThanOrEqual(RAMP_FLOOR_MS / 4);
    expect(blankMs).toBeLessThanOrEqual(RAMP_FLOOR_MS / 4);
    // Still something to see: at least two frames.
    expect(blankMs).toBeGreaterThanOrEqual(30);
  });
  it('a card with no limit (manual taps) arrives at the normal pace', () => {
    expect(cardArrival(Infinity)).toEqual({ arriveMs: DEAL_IN_MS, blankMs: BLANK_MAX_MS });
  });
});
