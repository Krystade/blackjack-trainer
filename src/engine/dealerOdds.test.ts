import { describe, it, expect } from 'vitest';
import { dealerOdds, dealerBustChance } from './dealerOdds';
import type { DealerOdds } from './dealerOdds';
import { DEFAULT_RULES } from './ruleset';
import type { Rank } from './cards';

const H17 = DEFAULT_RULES; // s17: false
const S17 = { ...DEFAULT_RULES, s17: true };
const UPS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

/**
 * The oracle problem, and how it is solved here.
 *
 * The obvious way to test a probability table is to paste published constants
 * and compare -- which tests my memory of the literature, not the code, and
 * enshrines any misremembering as the expected value forever. So the real oracle
 * below is an INDEPENDENT Monte Carlo: a straightforward simulation sharing no
 * code with the recursion, drawing with replacement exactly as the infinite-deck
 * assumption says. Two implementations written differently agreeing to two
 * decimals is evidence; one remembered number is not.
 *
 * The named anchors after it are the handful of facts about this game that are
 * not in doubt (a six is the most bustable up card, a seven far less so), kept
 * because a simulation that is wrong the same way as the recursion is the one
 * failure a cross-check cannot catch.
 */

/** A tiny deterministic PRNG, so a failure is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One card from an infinite deck. 11 means an ace. */
function drawCard(rnd: () => number): number {
  const r = Math.floor(rnd() * 13);
  if (r === 0) return 11;
  if (r >= 9) return 10; // 10, J, Q, K
  return r + 1;
}

/**
 * Plays dealer hands the naive way -- a running hard total plus a count of aces,
 * hitting while the rules say to. Written to resemble the recursion as little as
 * possible, which is the point of it.
 */
function simulate(
  up: number,
  h17: boolean,
  trials: number,
  seed: number,
  excludeBlackjack: boolean,
): DealerOdds {
  const rnd = mulberry32(seed);
  const counts = { t17: 0, t18: 0, t19: 0, t20: 0, t21: 0, bust: 0, blackjack: 0 };
  let kept = 0;

  while (kept < trials) {
    const hole = drawCard(rnd);
    const natural = (up === 11 && hole === 10) || (up === 10 && hole === 11);
    if (natural) {
      if (excludeBlackjack) continue; // peeked away; deal another hand
      counts.t21 += 1;
      counts.blackjack += 1;
      kept += 1;
      continue;
    }

    let hard = 0;
    let aces = 0;
    for (const card of [up, hole]) {
      if (card === 11) aces += 1;
      else hard += card;
    }
    for (;;) {
      let total = hard + aces;
      let soft = false;
      if (aces > 0 && total + 10 <= 21) {
        total += 10;
        soft = true;
      }
      if (total > 21) {
        counts.bust += 1;
        break;
      }
      if (total >= 17 && !(h17 && soft && total === 17)) {
        if (total === 17) counts.t17 += 1;
        else if (total === 18) counts.t18 += 1;
        else if (total === 19) counts.t19 += 1;
        else if (total === 20) counts.t20 += 1;
        else counts.t21 += 1;
        break;
      }
      const card = drawCard(rnd);
      if (card === 11) aces += 1;
      else hard += card;
    }
    kept += 1;
  }

  return {
    t17: counts.t17 / trials,
    t18: counts.t18 / trials,
    t19: counts.t19 / trials,
    t20: counts.t20 / trials,
    t21: counts.t21 / trials,
    bust: counts.bust / trials,
    blackjack: counts.blackjack / trials,
  };
}

describe('dealerOdds', () => {
  it('is a probability distribution for every up card and both soft-17 rules', () => {
    for (const rules of [H17, S17]) {
      for (const up of UPS) {
        const odds = dealerOdds(up, rules);
        const total = odds.t17 + odds.t18 + odds.t19 + odds.t20 + odds.t21 + odds.bust;
        expect(total, `${up} under ${rules.s17 ? 'S17' : 'H17'}`).toBeCloseTo(1, 10);
        for (const p of [odds.t17, odds.t18, odds.t19, odds.t20, odds.t21, odds.bust]) {
          expect(p).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  /** The real oracle: an independent simulation, sharing no code with the recursion. */
  it('matches an independent Monte Carlo simulation', () => {
    const TRIALS = 300_000;
    let seed = 12345;
    for (const rules of [H17, S17]) {
      for (const up of UPS) {
        const exact = dealerOdds(up, rules);
        const sim = simulate(up === 'A' ? 11 : Number(up), !rules.s17, TRIALS, (seed += 7), false);
        const where = `${up} under ${rules.s17 ? 'S17' : 'H17'}`;
        expect(exact.bust, `bust, ${where}`).toBeCloseTo(sim.bust, 2);
        expect(exact.t17, `17, ${where}`).toBeCloseTo(sim.t17, 2);
        expect(exact.t18, `18, ${where}`).toBeCloseTo(sim.t18, 2);
        expect(exact.t19, `19, ${where}`).toBeCloseTo(sim.t19, 2);
        expect(exact.t20, `20, ${where}`).toBeCloseTo(sim.t20, 2);
        expect(exact.t21, `21, ${where}`).toBeCloseTo(sim.t21, 2);
      }
    }
  });

  /** And with the naturals peeked away, which is the state a player decides in. */
  it('matches the simulation once peek has removed the naturals', () => {
    for (const up of ['A', '10'] as Rank[]) {
      const exact = dealerOdds(up, H17, { excludeBlackjack: true });
      const sim = simulate(up === 'A' ? 11 : 10, true, 300_000, 999, true);
      expect(exact.bust, `bust, ${up} peeked`).toBeCloseTo(sim.bust, 2);
      expect(exact.t20, `20, ${up} peeked`).toBeCloseTo(sim.t20, 2);
      expect(exact.blackjack).toBe(0);
    }
  });

  /**
   * Peek is not a rounding detail. Against a ten, the hole cards that would have
   * made 21 are gone, so every surviving outcome must rise.
   */
  it('raises every surviving outcome when peek removes the naturals', () => {
    const raw = dealerOdds('10', H17);
    const peeked = dealerOdds('10', H17, { excludeBlackjack: true });
    expect(raw.blackjack).toBeCloseTo(1 / 13, 10);
    expect(peeked.bust).toBeGreaterThan(raw.bust);
    expect(peeked.t20).toBeGreaterThan(raw.t20);
    // The 21s go the other way: that is precisely what was removed.
    expect(peeked.t21).toBeLessThan(raw.t21);
  });

  /** An ace up can pair with any of the four ten-ranks; a ten only with the ace. */
  it('prices an ace-up natural at four times a ten-up one', () => {
    expect(dealerOdds('A', H17).blackjack).toBeCloseTo(4 / 13, 10);
    expect(dealerOdds('10', H17).blackjack).toBeCloseTo(1 / 13, 10);
  });

  /**
   * Hitting soft 17 can only move the dealer OFF seventeen, so H17 must empty
   * some of that bucket into everything else -- busts included, which is why the
   * rule costs the player about two tenths of a percent.
   */
  it('leaves fewer seventeens and more busts when the dealer hits soft 17', () => {
    for (const up of UPS) {
      const h17 = dealerOdds(up, H17);
      const s17 = dealerOdds(up, S17);
      expect(h17.t17, `17s on ${up}`).toBeLessThanOrEqual(s17.t17);
      expect(h17.bust, `busts on ${up}`).toBeGreaterThanOrEqual(s17.bust);
    }
  });

  /**
   * The shape of the bust curve, which every counter knows by heart: small cards
   * are the dealer's problem, and the curve turns at six.
   */
  it('busts most on a six and least on an ace', () => {
    const bust = (up: Rank) => dealerBustChance(up, H17, { excludeBlackjack: true });
    expect(bust('5')).toBeGreaterThan(bust('4'));
    expect(bust('6')).toBeGreaterThan(bust('7'));
    expect(bust('7')).toBeGreaterThan(bust('8'));
    expect(bust('8')).toBeGreaterThan(bust('9'));
    expect(bust('6')).toBeGreaterThan(0.35);
    expect(bust('7')).toBeLessThan(0.3);
    expect(bust('A')).toBeLessThan(bust('9'));
  });
});
