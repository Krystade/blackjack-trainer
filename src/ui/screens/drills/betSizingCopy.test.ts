import { describe, expect, it } from 'vitest';
import { CATEGORY_LABELS } from '../categoryLabels';
import { BET_SIZING_DRILL, BET_SIZING_INTRO, BET_SIZING_PICKER } from './betSizingCopy';

/**
 * Wave B2 #14: Play grades the size of a bet and whether to play at all as two
 * rows; the drill grades both in one answer. The same words must not name two
 * different measures, and the drill says how its one answer maps onto Play's two.
 */
describe('Bet sizing copy (#14)', () => {
  it("Play's bet row is not called by the drill's name", () => {
    expect(BET_SIZING_DRILL).toBe('Bet sizing');
    expect(CATEGORY_LABELS.bet).not.toBe(BET_SIZING_DRILL);
    expect(CATEGORY_LABELS.bet).toBe('Bet size when playing');
  });
  it("the drill names both of Play's rows its one answer covers", () => {
    expect(BET_SIZING_INTRO).toContain(CATEGORY_LABELS.wong);
    expect(BET_SIZING_INTRO).toContain(CATEGORY_LABELS.bet);
    expect(BET_SIZING_PICKER).toMatch(/sit out or bet/i);
  });
});
