import { describe, it, expect } from 'vitest';
import { mulberry32 } from './cards';
import { cutCardsFor, cutRngSeed, usesCutCards, CUT_VARY_DECKS } from './cut';

const six = { decks: 6 };
/** An rng that always returns `x`, to pin the vary to an exact place. */
const fixed = (x: number) => () => x;

describe('cutCardsFor (#39)', () => {
  it('uses cutDecks when set: cards behind the cut', () => {
    expect(cutCardsFor({ penetration: 0.75, cutDecks: 1, rules: six }, fixed(0.9))).toBe(52);
    expect(cutCardsFor({ penetration: 0.75, cutDecks: 1.25, rules: six }, fixed(0.9))).toBe(65);
  });

  it('absent cutDecks is derived from penetration, so a stored profile keeps its depth', () => {
    expect(cutCardsFor({ penetration: 0.75, rules: six }, fixed(0.9))).toBe(78); // 1.5 decks
    expect(cutCardsFor({ penetration: 0.5, rules: { decks: 2 } }, fixed(0.9))).toBe(52); // 1 deck
  });

  it('does not touch the rng unless cutVary is on', () => {
    let calls = 0;
    const rng = () => {
      calls += 1;
      return 0.5;
    };
    cutCardsFor({ penetration: 0.75, cutDecks: 1, rules: six }, rng);
    expect(calls).toBe(0);
    cutCardsFor({ penetration: 0.75, cutDecks: 1, cutVary: true, rules: six }, rng);
    expect(calls).toBe(1);
  });

  it('cutVary moves the cut by up to ±0.5 decks, linearly in the rng', () => {
    const spec = { penetration: 0.75, cutDecks: 1.5, cutVary: true, rules: six };
    expect(cutCardsFor(spec, fixed(0))).toBe(52); // 1.5 - 0.5
    expect(cutCardsFor(spec, fixed(0.5))).toBe(78); // centre
    expect(cutCardsFor(spec, fixed(0.75))).toBe(91); // 1.5 + 0.25
    expect(cutCardsFor(spec, fixed(0.9999999))).toBe(104); // ~1.5 + 0.5
  });

  it('a seeded vary spreads uniformly over the whole band and stays inside it', () => {
    const spec = { penetration: 0.75, cutDecks: 1.5, cutVary: true, rules: six };
    const rng = mulberry32(7);
    const seen: number[] = [];
    for (let i = 0; i < 2000; i++) seen.push(cutCardsFor(spec, rng));
    const lo = Math.round((1.5 - CUT_VARY_DECKS) * 52);
    const hi = Math.round((1.5 + CUT_VARY_DECKS) * 52);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(lo);
    expect(Math.max(...seen)).toBeLessThanOrEqual(hi);
    // Both ends of the band are actually reached, and neither half dominates.
    expect(Math.min(...seen)).toBeLessThanOrEqual(lo + 3);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(hi - 3);
    const below = seen.filter((c) => c < 78).length;
    const above = seen.filter((c) => c > 78).length;
    expect(Math.abs(below - above)).toBeLessThan(200);
  });

  it('the same seed places the same cuts', () => {
    const spec = { penetration: 0.75, cutDecks: 1, cutVary: true, rules: six };
    const a = mulberry32(3);
    const b = mulberry32(3);
    const runA = Array.from({ length: 20 }, () => cutCardsFor(spec, a));
    const runB = Array.from({ length: 20 }, () => cutCardsFor(spec, b));
    expect(runA).toEqual(runB);
  });

  it('clamps to [0.5, decks - 0.5] decks, varied or not', () => {
    // A 0.5-deck cut varied downward cannot go below half a deck...
    expect(cutCardsFor({ penetration: 0.75, cutDecks: 0.5, cutVary: true, rules: six }, fixed(0))).toBe(26);
    // ...a 2-deck shoe never cuts more than 1.5 decks off...
    expect(cutCardsFor({ penetration: 0.75, cutDecks: 3, rules: { decks: 2 } }, fixed(0.5))).toBe(78);
    expect(
      cutCardsFor({ penetration: 0.75, cutDecks: 1.5, cutVary: true, rules: { decks: 2 } }, fixed(0.9999)),
    ).toBe(78);
    // ...and a single deck always leaves exactly half of it.
    expect(cutCardsFor({ penetration: 0.75, cutVary: true, rules: { decks: 1 } }, fixed(0))).toBe(26);
    expect(cutCardsFor({ penetration: 0.75, cutVary: true, rules: { decks: 1 } }, fixed(0.99))).toBe(26);
  });
});

describe('usesCutCards', () => {
  it('only a profile that set cutDecks or turned on cutVary leaves the legacy cut', () => {
    expect(usesCutCards({})).toBe(false);
    expect(usesCutCards({ cutVary: false })).toBe(false);
    expect(usesCutCards({ cutDecks: 1 })).toBe(true);
    expect(usesCutCards({ cutVary: true })).toBe(true);
  });
});

describe('cutRngSeed', () => {
  it('is not the seed itself, so the cut stream is not the shuffle stream', () => {
    for (const s of [0, 1, 42, 123456]) expect(cutRngSeed(s)).not.toBe(s);
  });
});
