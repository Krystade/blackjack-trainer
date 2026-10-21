import { describe, it, expect } from 'vitest';
import { FiniteShoe, FREE_BET_GAME, S21_GAME } from './finiteShoe';
import type { FiniteGame } from './finiteShoe';
import { DISAGREEMENT_GRADES } from '../src/engine/variants/published';
import { PRESETS } from '../src/engine/variants/rules';
import type { PresetId } from '../src/engine/variants/rules';
import generated from '../src/engine/variants/generated.json' with { type: 'json' };

/**
 * Wave L, review B1: the cells graded 'published' are graded so because a
 * six-deck shoe plays them the published way, though the infinite-deck engine
 * does not. This checks that claim, cell by cell, with an independent
 * composition-dependent evaluator (finiteShoe.ts), and checks that evaluator
 * against the engine at a deck count large enough to be the infinite deck.
 */

interface Case {
  key: string;
  game: FiniteGame;
  cards: number[];
  up: number;
  /** The published play, and the computed play it beats at six decks. */
  pub: 'S' | 'D';
  comp: 'H';
}

const FB = FREE_BET_GAME; // Switch's per-hand rules are the same: H17, dealer 22 pushes, no Spanish deck.
const H = S21_GAME(true);
const S = S21_GAME(false);

const CASES: Case[] = [
  { key: 'freebet:real:SOFT:16:6', game: FB, cards: [1, 5], up: 6, pub: 'D', comp: 'H' },
  { key: 'freebet:real:SOFT:17:5', game: FB, cards: [1, 6], up: 5, pub: 'D', comp: 'H' },
  { key: 'switch:main:SOFT:16:6', game: FB, cards: [1, 5], up: 6, pub: 'D', comp: 'H' },
  { key: 'switch:main:SOFT:17:5', game: FB, cards: [1, 6], up: 5, pub: 'D', comp: 'H' },
  { key: 'switch:main:HARD:9:5', game: FB, cards: [5, 4], up: 5, pub: 'D', comp: 'H' },
  { key: 'switch:main:HARD:9:5', game: FB, cards: [6, 3], up: 5, pub: 'D', comp: 'H' },
  { key: 's21-h17:main:SOFT:16:5', game: H, cards: [1, 5], up: 5, pub: 'D', comp: 'H' },
  { key: 's21-s17:main:HARD:9:6', game: S, cards: [6, 3], up: 6, pub: 'D', comp: 'H' },
  { key: 's21-s17:main:HARD:9:6', game: S, cards: [5, 4], up: 6, pub: 'D', comp: 'H' },
  { key: 's21-h17:main:HARD:15:6', game: H, cards: [2, 2, 2, 3, 3, 3], up: 6, pub: 'S', comp: 'H' },
  { key: 's21-h17:main:HARD:14:6', game: H, cards: [2, 2, 3, 3, 4], up: 6, pub: 'S', comp: 'H' },
  { key: 's21-h17:main:HARD:16:2', game: H, cards: [2, 3, 3, 4, 4], up: 2, pub: 'S', comp: 'H' },
  { key: 's21-h17:main:HARD:10:4', game: H, cards: [2, 2, 2, 2, 2], up: 4, pub: 'D', comp: 'H' },
  { key: 's21-h17:main:HARD:9:6', game: H, cards: [2, 3, 4], up: 6, pub: 'D', comp: 'H' },
];

describe('finite six-deck shoe backs every published-graded cell tested', () => {
  for (const c of CASES) {
    it(`${c.key} (${c.cards.join(',')}): six decks play ${c.pub}`, () => {
      expect(DISAGREEMENT_GRADES[c.key]).toBe('published');
      const preset = c.key.split(':')[0] as PresetId;
      expect(PRESETS[preset].decks).toBe(6);
      const o = new FiniteShoe(c.game, 6).options(c.cards, c.up);
      expect(o[c.pub]!).toBeGreaterThan(o[c.comp]);
    });
  }

  it('the published grades are tied to six-deck presets', () => {
    for (const [key, grade] of Object.entries(DISAGREEMENT_GRADES)) {
      if (grade === 'published') expect(PRESETS[key.split(':')[0] as PresetId].decks).toBe(6);
    }
  });
});

describe('the finite evaluator agrees with the engine at a huge deck count', () => {
  const margin = (key: string) =>
    (generated as { disagreements: { key: string; margin: number | null }[] }).disagreements.find((d) => d.key === key)!.margin!;

  it('Free Bet A,5 v 6: hit beats double by the engine\'s infinite-deck margin', () => {
    const o = new FiniteShoe(FB, 6000).options([1, 5], 6);
    expect(o.H - o.D!).toBeCloseTo(margin('freebet:real:SOFT:16:6'), 3);
  });

  it('Spanish 21 H17 9 v 6 with 2,3,4: hit beats double by the engine margin', () => {
    const o = new FiniteShoe(H, 6000).options([2, 3, 4], 6);
    expect(o.H - o.D!).toBeCloseTo(margin('s21-h17:main:HARD:9:6'), 3);
  });
});

describe('the six-deck flips are deck-count effects', () => {
  it('at eight decks the 6-card 15 v 6 goes back to the computed hit', () => {
    const o = new FiniteShoe(H, 8).options([2, 2, 2, 3, 3, 3], 6);
    expect(o.H).toBeGreaterThan(o.S);
  });
});
