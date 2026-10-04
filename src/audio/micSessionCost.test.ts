import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetMicSessionCostForTest,
  markMicSessionOpened,
  micSessionCostPaid,
} from './micSessionCost';

/**
 * The one property that matters, and the reason this is a module and not a
 * piece of component state: the cost is NOT refunded.
 *
 * Jack, asked directly on 2026-10-03 whether turning voice back off brings the
 * loud speaker back: "No -- stays on the earpiece." So a flag that cleared when
 * the recogniser closed would describe a phone that does not exist, and the
 * notice would vanish exactly when the operator was looking for the reason the
 * sound had gone quiet.
 */
describe('the price of opening the microphone', () => {
  beforeEach(() => {
    _resetMicSessionCostForTest();
  });

  it('is unpaid on a fresh page', () => {
    expect(micSessionCostPaid()).toBe(false);
  });

  it('is paid once the microphone opens', () => {
    markMicSessionOpened();
    expect(micSessionCostPaid()).toBe(true);
  });

  it('stays paid after the microphone closes, because the earpiece does', () => {
    markMicSessionOpened();
    // Nothing closes it: there is no `markMicSessionClosed`, deliberately.
    // Opening it again must not change the answer either.
    markMicSessionOpened();
    expect(micSessionCostPaid()).toBe(true);
  });

  it('is unpaid again only on a new page', () => {
    markMicSessionOpened();
    _resetMicSessionCostForTest();
    expect(micSessionCostPaid()).toBe(false);
  });
});
