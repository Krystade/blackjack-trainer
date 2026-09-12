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

  it('draws an integer TC in [-6, 6], decks in 0.5..6 (half steps), and a boolean fresh shoe', () => {
    for (let seed = 0; seed < 500; seed++) {
      const s = makeBetSitLeaveScenario(seed);
      expect(s.trueCount).toBeGreaterThanOrEqual(-6);
      expect(s.trueCount).toBeLessThanOrEqual(6);
      expect(Number.isInteger(s.trueCount)).toBe(true);
      expect(s.decksRemaining).toBeGreaterThanOrEqual(0.5);
      expect(s.decksRemaining).toBeLessThanOrEqual(6);
      expect((s.decksRemaining * 2) % 1).toBe(0); // half-deck increments
      expect(typeof s.freshShoe).toBe('boolean');
    }
  });

  it('is physically plausible (V3-3): big |TC| only occurs deep in the shoe — no "TC -4 at a near-full shoe"', () => {
    for (let seed = 0; seed < 800; seed++) {
      const s = makeBetSitLeaveScenario(seed);
      // The running count can only have swung ~±2 per dealt deck, so |TC| is
      // depth-limited: near-full shoes stay neutral; extreme counts need depth.
      if (s.decksRemaining >= 5) expect(Math.abs(s.trueCount)).toBeLessThanOrEqual(1);
      if (s.decksRemaining >= 3) expect(Math.abs(s.trueCount)).toBeLessThanOrEqual(3);
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

describe('makeBetSitLeaveScenario across shoe sizes (V4-3)', () => {
  const SHOES = [1, 2, 6, 8];

  it('depth stays inside the profile\'s own shoe', () => {
    for (const totalDecks of SHOES) {
      for (let seed = 0; seed < 300; seed++) {
        const s = makeBetSitLeaveScenario(seed, totalDecks);
        expect(s.decksRemaining, `${totalDecks}-deck seed ${seed}`).toBeGreaterThanOrEqual(0.5);
        expect(s.decksRemaining, `${totalDecks}-deck seed ${seed}`).toBeLessThanOrEqual(totalDecks);
        expect((s.decksRemaining * 2) % 1).toBe(0);
      }
    }
  });

  it('the count stays sane in a small shoe — the dealt count can never go negative', () => {
    // Regression guard: the depth draw was a SECOND hardcoded six (as a
    // literal 12 half-deck steps). Parameterising only `decksDealt` would have
    // left a 1-deck shoe dealing up to 6 decks, i.e. decksDealt of -5, which
    // feeds rcMax = round(2 * decksDealt) + 1 = -9 and inverts the whole
    // running-count draw.
    for (const totalDecks of [1, 2]) {
      for (let seed = 0; seed < 400; seed++) {
        const s = makeBetSitLeaveScenario(seed, totalDecks);
        const decksDealt = totalDecks - s.decksRemaining;
        expect(decksDealt, `${totalDecks}-deck seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(s.trueCount)).toBe(true);
        expect(Math.abs(s.trueCount)).toBeLessThanOrEqual(6);
      }
    }
  });

  it('physical plausibility scales with the shoe, not with six', () => {
    // The V3-3 property, restated relative to the shoe instead of to 6.
    for (const totalDecks of SHOES) {
      for (let seed = 0; seed < 800; seed++) {
        const s = makeBetSitLeaveScenario(seed, totalDecks);
        // An untouched shoe cannot have swung: no cards are dealt yet.
        if (s.decksRemaining === totalDecks) {
          expect(Math.abs(s.trueCount), `${totalDecks}-deck seed ${seed}`).toBeLessThanOrEqual(1);
        }
        // An extreme count needs at least half the shoe behind it, whatever
        // the shoe is -- the same shape as the 6-deck assertion above.
        if (Math.abs(s.trueCount) >= 4) {
          expect(totalDecks - s.decksRemaining, `${totalDecks}-deck seed ${seed}`).toBeGreaterThanOrEqual(
            totalDecks / 2,
          );
        }
      }
    }
  });

  it('each shoe spans its own full depth range', () => {
    for (const totalDecks of SHOES) {
      const seen = new Set<number>();
      for (let seed = 0; seed < 600; seed++) seen.add(makeBetSitLeaveScenario(seed, totalDecks).decksRemaining);
      expect(seen.size, `${totalDecks}-deck spread`).toBe(totalDecks * 2);
      expect(seen.has(totalDecks), `${totalDecks}-deck ceiling`).toBe(true);
    }
  });

  it('omitting the shoe size is byte-identical to the old hardcoded six', () => {
    for (let seed = 0; seed < 100; seed++) {
      expect(makeBetSitLeaveScenario(seed)).toEqual(makeBetSitLeaveScenario(seed, 6));
    }
    const differs = [];
    for (let seed = 0; seed < 100; seed++) {
      if (makeBetSitLeaveScenario(seed).decksRemaining !== makeBetSitLeaveScenario(seed, 2).decksRemaining) {
        differs.push(seed);
      }
    }
    expect(differs.length).toBeGreaterThan(50);
  });

  it('a small shoe still trains all three actions', () => {
    for (const totalDecks of [1, 2]) {
      const seen = new Set();
      for (let seed = 0; seed < 600; seed++) seen.add(correctAction(makeBetSitLeaveScenario(seed, totalDecks)));
      expect(seen.has('bet'), `${totalDecks}-deck bet`).toBe(true);
      expect(seen.has('sit'), `${totalDecks}-deck sit`).toBe(true);
      expect(seen.has('leave'), `${totalDecks}-deck leave`).toBe(true);
    }
  });
});
