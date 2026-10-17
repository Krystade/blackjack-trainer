import { describe, it, expect } from 'vitest';
import {
  correctAction,
  explainAction,
  makeBetSitLeaveScenario,
  type BetSitLeaveScenario,
} from './betSitLeave';
import { Game, DEFAULT_SPREAD, type GameConfig } from '../engine/game';

const sc = (trueCount: number, decksRemaining: number): BetSitLeaveScenario => ({ trueCount, decksRemaining });

describe('correctAction follows the profile spread, as Play does (Wave A, D1)', () => {
  it('default ramp: bets from TC +1 (where it raises), sits at 0 and below, at any depth', () => {
    for (const tc of [1, 3]) for (const d of [0.5, 3, 6]) expect(correctAction(sc(tc, d))).toBe('bet');
    for (const tc of [0, -1, -2, -6]) for (const d of [0.5, 1, 6]) expect(correctAction(sc(tc, d))).toBe('sit');
  });

  it('moving the ramp moves the line', () => {
    const early = [
      { minTc: -99, units: 1 },
      { minTc: -1, units: 2 },
    ];
    expect(correctAction(sc(-1, 3), early)).toBe('bet');
    expect(correctAction(sc(-2, 3), early)).toBe('sit');
  });

  it('agrees with the wong grading in Play at every count, for the default ramp and another', () => {
    const ramps = [DEFAULT_SPREAD, [{ minTc: -99, units: 1 }, { minTc: 2, units: 3 }]];
    for (const spread of ramps)
      for (let tc = -6; tc <= 6; tc++) {
        const cfg: GameConfig = {
          penetration: 0.75,
          betSpreadOn: true,
          spread,
          bankrollStart: 100,
          countCheckEvery: 0,
          seed: 1,
        };
        const game = new Game(cfg);
        // Fix the count Play grades the sit-out against.
        Object.defineProperty(game, 'trueCountNow', { get: () => tc });
        game.sitOut();
        const wong = game.events.find((e) => e.kind === 'wong')!;
        expect(correctAction(sc(tc, 3), spread), `tc ${tc}`).toBe(wong.correct ? 'sit' : 'bet');
      }
  });

  it('explains the line by the ramp, with a real minus sign', () => {
    expect(explainAction(sc(0, 3))).toBe('Your ramp raises from TC +1: below that, sit out.');
    expect(explainAction(sc(2, 3))).toBe('Your ramp bets above its minimum here: play.');
    expect(explainAction(sc(-3, 3), [{ minTc: -99, units: 1 }, { minTc: -2, units: 2 }])).toBe(
      'Your ramp raises from TC −2: below that, sit out.',
    );
  });
});

describe('makeBetSitLeaveScenario', () => {
  it('is deterministic for a seed', () => {
    expect(makeBetSitLeaveScenario(42)).toEqual(makeBetSitLeaveScenario(42));
  });

  it('draws an integer TC in [-6, 6] and decks in 0.5..6 (half steps), with no fresh-shoe field', () => {
    for (let seed = 0; seed < 500; seed++) {
      const s = makeBetSitLeaveScenario(seed);
      expect(s.trueCount).toBeGreaterThanOrEqual(-6);
      expect(s.trueCount).toBeLessThanOrEqual(6);
      expect(Number.isInteger(s.trueCount)).toBe(true);
      expect(s.decksRemaining).toBeGreaterThanOrEqual(0.5);
      expect(s.decksRemaining).toBeLessThanOrEqual(6);
      expect((s.decksRemaining * 2) % 1).toBe(0); // half-deck increments
      expect(Object.keys(s).sort()).toEqual(['decksRemaining', 'trueCount']);
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

  it('surfaces exactly the two answers, bet and sit, across enough seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 500; seed++) seen.add(correctAction(makeBetSitLeaveScenario(seed)));
    expect([...seen].sort()).toEqual(['bet', 'sit']);
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

  it('a small shoe still trains both actions', () => {
    for (const totalDecks of [1, 2]) {
      const seen = new Set();
      for (let seed = 0; seed < 600; seed++) seen.add(correctAction(makeBetSitLeaveScenario(seed, totalDecks)));
      expect(seen.has('bet'), `${totalDecks}-deck bet`).toBe(true);
      expect(seen.has('sit'), `${totalDecks}-deck sit`).toBe(true);
    }
  });
});
