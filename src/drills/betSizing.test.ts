import { describe, it, expect } from 'vitest';
import { Game, DEFAULT_SPREAD } from '../engine/game';
import { RANKS, type Card } from '../engine/cards';
import { makeDefaultProfile } from '../store/profiles';
import { playConfigFor } from '../ui/playConfig';
import { EMPTY_STATS, type Profile, type Stats } from '../store/types';
import {
  appendBetSizingRow, betAnswerLabel, betSizingOptions, betSizingRow, betSizingWorking, correctBetAnswer,
  gradeBetSizing, makeBetSizingScenario, scenarioTc, trayFloorDecks, type BetAnswer,
} from './betSizing';

/** Play's own verdict on one pre-deal decision: every bet/wong event it grades is correct. */
function playVerdict(profile: Profile, rc: number, cardsDealt: number, taken: BetAnswer): boolean {
  const cfg = { ...playConfigFor({ ...profile, betSpreadOn: true }, 1000, 1), penetration: 1 };
  const cards: Card[] = Array.from({ length: profile.rules.decks * 52 }, (_, i) => ({ rank: RANKS[i % 13], suit: 's' }));
  const game = Game.withRiggedShoe(cfg, cards);
  game.discardRiggedCards(cardsDealt);
  game.runningCount = rc;
  if (taken === 'sit') game.sitOut();
  else game.startRound(taken);
  const graded = game.events.filter((e) => e.kind === 'bet' || e.kind === 'wong');
  expect(graded.length).toBeGreaterThan(0);
  return graded.every((e) => e.correct);
}

const base = makeDefaultProfile();
const PROFILES: [string, Profile][] = [
  ['default ramp', base],
  ['cover bets', { ...base, coverBets: true }],
  ['truncate rounding', { ...base, tcRounding: 'truncate' }],
  // Truncate and floor differ only on negative fractions, where the default ramp
  // sits either way. A ramp raising at 0 makes truncate change verdicts (RC −1
  // at 2.5 decks: TC 0 bets, TC −1 sits), so dropping rounding fails here too.
  ['truncate, ramp raising at 0', { ...base, tcRounding: 'truncate', spread: [{ minTc: -99, units: 1 }, { minTc: 0, units: 2 }, { minTc: 2, units: 4 }] }],
  ['round rounding', { ...base, tcRounding: 'round' }],
  ['no floor row', { ...base, spread: [{ minTc: 0, units: 2 }, { minTc: 3, units: 5 }] }],
  ['unsorted ramp', { ...base, spread: [{ minTc: 3, units: 6 }, { minTc: -99, units: 1 }, { minTc: 1, units: 3 }, { minTc: 2, units: 3 }] }],
  ['one deck', { ...base, rules: { ...base.rules, decks: 1 } }],
  ['two decks', { ...base, rules: { ...base.rules, decks: 2 } }],
  ['eight decks', { ...base, rules: { ...base.rules, decks: 8 } }],
];
const RCS = [-12, -7, -4, -2, -1, 0, 1, 2, 3, 5, 8, 12];

describe('Bet sizing grades exactly as Play (D1, contract 1)', () => {
  it.each(PROFILES)('%s: same verdict as a real Game for every (RC, depth, answer)', (_, profile) => {
    const totalDecks = profile.rules.decks;
    let right = 0;
    let wrong = 0;
    // Step 17 is deliberately off the half-deck grid: Play snaps depth, the drill must too.
    for (let cardsDealt = 0; cardsDealt <= totalDecks * 52 - 26; cardsDealt += 17) {
      for (const rc of RCS) {
        const tc = scenarioTc({ rc, cardsDealt, totalDecks }, profile.tcRounding);
        for (const taken of betSizingOptions(profile.spread)) {
          const drill = gradeBetSizing(taken, tc, profile);
          expect(drill, `rc ${rc} dealt ${cardsDealt} taken ${taken}`).toBe(playVerdict(profile, rc, cardsDealt, taken));
          if (drill) right++;
          else wrong++;
        }
      }
    }
    expect(right).toBeGreaterThan(0);
    expect(wrong).toBeGreaterThan(0);
  });

  it('vacuity: cover and rounding really change some verdicts in the sweep', () => {
    let coverDiffers = 0;
    let roundingDiffers = 0;
    for (let cardsDealt = 0; cardsDealt <= 286; cardsDealt += 17) {
      for (const rc of RCS) {
        const s = { rc, cardsDealt, totalDecks: 6 };
        if (scenarioTc(s, 'truncate') !== scenarioTc(s)) roundingDiffers++;
        for (const t of betSizingOptions(DEFAULT_SPREAD)) {
          if (gradeBetSizing(t, scenarioTc(s), base) !== gradeBetSizing(t, scenarioTc(s), { ...base, coverBets: true })) coverDiffers++;
        }
      }
    }
    expect(coverDiffers).toBeGreaterThan(0);
    expect(roundingDiffers).toBeGreaterThan(0);
  });
});

describe('answers', () => {
  it('sits wherever the default ramp bets its minimum, else bets the rung', () => {
    expect(correctBetAnswer(-3, DEFAULT_SPREAD)).toBe('sit');
    expect(correctBetAnswer(0, DEFAULT_SPREAD)).toBe('sit');
    expect(correctBetAnswer(1, DEFAULT_SPREAD)).toBe(2);
    expect(correctBetAnswer(2, DEFAULT_SPREAD)).toBe(4);
    expect(correctBetAnswer(5, DEFAULT_SPREAD)).toBe(12);
    expect(correctBetAnswer(9, DEFAULT_SPREAD)).toBe(12);
  });
  it('offers Sit then every distinct rung ascending, even from a hand-edited spread', () => {
    expect(betSizingOptions(DEFAULT_SPREAD)).toEqual(['sit', 1, 2, 4, 8, 10, 12]);
    expect(betSizingOptions([{ minTc: 3, units: 5 }, { minTc: 0, units: 2 }, { minTc: 5, units: 5 }])).toEqual(['sit', 2, 5]);
  });
  it('labels', () => {
    expect(betAnswerLabel('sit')).toBe('Sit');
    expect(betAnswerLabel(4)).toBe('4u');
  });
  it('shows RC ÷ decks → TC → rung with real minus signs', () => {
    expect(betSizingWorking({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base)).toBe('RC +7 ÷ 2.5 decks → TC +2 → 4u');
    expect(betSizingWorking({ rc: -3, cardsDealt: 156, totalDecks: 6 }, base)).toBe('RC −3 ÷ 3 decks → TC −1 → Sit');
    expect(betSizingWorking({ rc: 2, cardsDealt: 260, totalDecks: 6 }, base)).toBe('RC +2 ÷ 1 deck → TC +2 → 4u');
  });
});

describe('makeBetSizingScenario', () => {
  it('is seeded', () => {
    expect(makeBetSizingScenario(42, 6, DEFAULT_SPREAD)).toEqual(makeBetSizingScenario(42, 6, DEFAULT_SPREAD));
  });
  it.each([1, 2, 6, 8])('%i decks: a half-deck tray and a count the dealt cards could produce', (decks) => {
    for (let seed = 0; seed < 300; seed++) {
      const s = makeBetSizingScenario(seed, decks, DEFAULT_SPREAD);
      expect(s.totalDecks).toBe(decks);
      expect(s.cardsDealt % 26).toBe(0);
      expect(s.cardsDealt).toBeGreaterThanOrEqual(0);
      expect(s.cardsDealt).toBeLessThan(decks * 52);
      expect(Math.abs(s.rc)).toBeLessThanOrEqual(Math.round((2 * s.cardsDealt) / 52) + 1);
    }
  });
  it.each([2, 6, 8])('%i decks: every answer the ramp can call comes up, and Sit is no free pass', (decks) => {
    const counts = new Map<BetAnswer, number>();
    for (let seed = 0; seed < 600; seed++) {
      const a = correctBetAnswer(scenarioTc(makeBetSizingScenario(seed, decks, DEFAULT_SPREAD)), DEFAULT_SPREAD);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    for (const a of ['sit', 2, 4, 8, 10, 12] as const) expect(counts.get(a) ?? 0).toBeGreaterThanOrEqual(48);
    expect(counts.get('sit') ?? 0).toBeLessThanOrEqual(240);
    expect(counts.get(1) ?? 0).toBe(0); // D1: the minimum rung is never the answer, Sit is
  });
  it('single-row ramp: terminates and always asks Sit', () => {
    const flat = [{ minTc: -99, units: 1 }];
    for (let seed = 0; seed < 50; seed++) {
      expect(correctBetAnswer(scenarioTc(makeBetSizingScenario(seed, 6, flat)), flat)).toBe('sit');
    }
  });
});

describe('stats row (contract 1)', () => {
  it('builds the row the drill records', () => {
    expect(betSizingRow({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base, 2, '2026-10-17T00:00:00.000Z')).toEqual({
      date: '2026-10-17T00:00:00.000Z', rc: 7, decksRemaining: 2.5, tc: 2, taken: 2, correct: 4, ok: false,
    });
  });
  it('starts the history when absent, appends after, leaves Bet or sit history alone, and is pure', () => {
    const old: Stats = {
      ...structuredClone(EMPTY_STATS),
      betSitLeave: { history: [{ date: 'x', taken: 'bet', correctAction: 'bet', correct: true }] },
    };
    const row = betSizingRow({ rc: 7, cardsDealt: 182, totalDecks: 6 }, base, 4, '2026-10-17T00:00:00.000Z');
    const next = appendBetSizingRow(old, row);
    expect(next.betSizing).toEqual({ history: [row] });
    expect(next.betSitLeave).toEqual(old.betSitLeave);
    expect(appendBetSizingRow(next, { ...row, ok: false }).betSizing!.history).toHaveLength(2);
    expect(old.betSizing).toBeUndefined();
  });
});

describe('Wave B2 #17: only trays the profile\'s shoe can reach', () => {
  const deepest = (p: Profile, n = 1500) => {
    let min = Infinity;
    const counts = new Map<BetAnswer, number>();
    for (let seed = 0; seed < n; seed++) {
      const s = makeBetSizingScenario(seed, p.rules.decks, p.spread, trayFloorDecks(p));
      min = Math.min(min, s.totalDecks - s.cardsDealt / 52);
      const a = correctBetAnswer(scenarioTc(s), p.spread);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    return { min, counts };
  };
  it('the default profile (6 decks, 75%) never deals past its cut: at least 1.5 decks left', () => {
    expect(trayFloorDecks(base)).toBe(1.5);
    const { min, counts } = deepest(base);
    expect(min).toBe(1.5);
    // Every answer the ramp calls still comes up from reachable trays.
    for (const a of ['sit', 2, 4, 8, 10, 12] as const) expect(counts.get(a) ?? 0).toBeGreaterThan(50);
  });
  it('the cut card setting moves the floor, rounded up to the half deck', () => {
    expect(trayFloorDecks({ ...base, cutDecks: 1 })).toBe(1);
    expect(trayFloorDecks({ ...base, cutDecks: 2.2 })).toBe(2.5);
    expect(deepest({ ...base, cutDecks: 2.5 }).min).toBe(2.5);
    expect(trayFloorDecks({ ...base, penetration: 0.5, rules: { ...base.rules, decks: 2 } })).toBe(1);
  });
  it('a varied cut can come half a deck closer, never into the last half deck', () => {
    expect(trayFloorDecks({ ...base, cutDecks: 1.5, cutVary: true })).toBe(1);
    expect(trayFloorDecks({ ...base, cutDecks: 0.5, cutVary: true })).toBe(0.5);
  });
  it('without a floor the draw is unchanged (seed-stable)', () => {
    for (let seed = 0; seed < 50; seed++) {
      expect(makeBetSizingScenario(seed, 6, DEFAULT_SPREAD, 0.5)).toEqual(makeBetSizingScenario(seed, 6, DEFAULT_SPREAD));
    }
  });
});
