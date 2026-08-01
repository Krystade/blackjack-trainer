import { describe, it, expect } from 'vitest';
import {
  correctAction,
  makeBetSitLeaveScenario,
  T_BET,
  T_LEAVE_COUNT,
  D_LEAVE,
  type BetSitLeaveScenario,
} from './betSitLeave';

const sc = (trueCount: number, decksRemaining: number, freshShoe: boolean): BetSitLeaveScenario => ({
  trueCount,
  decksRemaining,
  freshShoe,
});

describe('correctAction (ET3 consensus rule)', () => {
  it('TC >= 0 is always BET, regardless of depth or a fresh shoe', () => {
    for (const tc of [0, 1, 3]) {
      for (const d of [0.5, 3, 6]) {
        for (const fresh of [true, false]) {
          expect(correctAction(sc(tc, d, fresh))).toBe('bet');
        }
      }
    }
  });

  it('an early, mild-negative shoe (TC -1, plenty of decks) is SIT — it can still turn', () => {
    expect(correctAction(sc(-1, 4, true))).toBe('sit');
    expect(correctAction(sc(-1, 4, false))).toBe('sit');
  });

  it('deep-negative (TC <= -2) with a fresh table open is LEAVE', () => {
    expect(correctAction(sc(-2, 5, true))).toBe('leave');
    expect(correctAction(sc(-4, 6, true))).toBe('leave');
  });

  it('late in a negative shoe (few decks left) with a fresh table is LEAVE, even at only TC -1', () => {
    expect(correctAction(sc(-1, 2.0, true))).toBe('leave'); // decksRemaining <= D_LEAVE
    expect(correctAction(sc(-1, 1.0, true))).toBe('leave');
  });

  it('leave is warranted but NO fresh table -> SIT (grind/wait; nowhere better to go)', () => {
    expect(correctAction(sc(-4, 6, false))).toBe('sit'); // deep-negative but no fresh shoe
    expect(correctAction(sc(-1, 1.0, false))).toBe('sit'); // late shoe but no fresh shoe
  });

  it('boundary: TC exactly T_BET (0) bets; one below sits/leaves per depth', () => {
    expect(correctAction(sc(T_BET, 4, true))).toBe('bet');
    expect(correctAction(sc(-1, 4, true))).toBe('sit'); // just-negative, early
  });

  it('boundary: decksRemaining exactly D_LEAVE counts as "late" (leave with fresh shoe)', () => {
    expect(correctAction(sc(-1, D_LEAVE, true))).toBe('leave');
    expect(correctAction(sc(-1, D_LEAVE + 0.5, true))).toBe('sit');
  });

  it('boundary: TC exactly T_LEAVE_COUNT (-2) is deep enough to leave (fresh shoe)', () => {
    expect(correctAction(sc(T_LEAVE_COUNT, 6, true))).toBe('leave');
    expect(correctAction(sc(T_LEAVE_COUNT + 1, 6, true))).toBe('sit'); // -1 early -> sit
  });
});

describe('makeBetSitLeaveScenario', () => {
  it('is deterministic for a seed', () => {
    expect(makeBetSitLeaveScenario(42)).toEqual(makeBetSitLeaveScenario(42));
  });

  it('draws TC in [-4, 3], decks in 0.5..6 (half steps), and a boolean fresh shoe', () => {
    for (let seed = 0; seed < 500; seed++) {
      const s = makeBetSitLeaveScenario(seed);
      expect(s.trueCount).toBeGreaterThanOrEqual(-4);
      expect(s.trueCount).toBeLessThanOrEqual(3);
      expect(Number.isInteger(s.trueCount)).toBe(true);
      expect(s.decksRemaining).toBeGreaterThanOrEqual(0.5);
      expect(s.decksRemaining).toBeLessThanOrEqual(6);
      expect((s.decksRemaining * 2) % 1).toBe(0); // half-deck increments
      expect(typeof s.freshShoe).toBe('boolean');
    }
  });

  it('surfaces all three correct actions across enough seeds (the drill trains all of bet/sit/leave)', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) seen.add(correctAction(makeBetSitLeaveScenario(seed)));
    expect(seen.has('bet')).toBe(true);
    expect(seen.has('sit')).toBe(true);
    expect(seen.has('leave')).toBe(true);
  });
});
