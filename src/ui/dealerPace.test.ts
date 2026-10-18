import { describe, expect, it } from 'vitest';
import { dealerPaceMs, dealerPaceSec, isSlowDecision, slowDecisionsText } from './dealerPace';

describe('dealer-pace clock (F5)', () => {
  it('is off unless switched on', () => {
    expect(dealerPaceMs({}, false)).toBeNull();
    expect(dealerPaceMs({ dealerPaceOn: false, dealerPaceSec: 3 }, false)).toBeNull();
  });

  it('defaults to 4 s and keeps to 2..8 s', () => {
    expect(dealerPaceMs({ dealerPaceOn: true }, false)).toBe(4000);
    expect(dealerPaceMs({ dealerPaceOn: true, dealerPaceSec: 6 }, false)).toBe(6000);
    expect(dealerPaceSec({ dealerPaceSec: 1 })).toBe(2);
    expect(dealerPaceSec({ dealerPaceSec: 30 })).toBe(8);
    expect(dealerPaceSec({ dealerPaceSec: Number.NaN })).toBe(4);
  });

  it('is forced off eyes-free', () => {
    expect(dealerPaceMs({ dealerPaceOn: true, dealerPaceSec: 3 }, true)).toBeNull();
  });

  it('tags a decision slow at or past the limit, only while the clock runs', () => {
    expect(isSlowDecision(3999, 4000)).toBe(false);
    expect(isSlowDecision(4000, 4000)).toBe(true);
    expect(isSlowDecision(9000, 4000)).toBe(true);
    expect(isSlowDecision(9000, null)).toBe(false);
    expect(isSlowDecision(null, 4000)).toBe(false);
  });

  it('says the count', () => {
    expect(slowDecisionsText(0)).toBe('0 slow decisions');
    expect(slowDecisionsText(1)).toBe('1 slow decision');
    expect(slowDecisionsText(3)).toBe('3 slow decisions');
  });
});
