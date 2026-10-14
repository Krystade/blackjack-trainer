import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig } from './game';
import { DEFAULT_RULES } from './ruleset';
import { basicPlay } from './strategy';
import { priceMistake } from './mistakeCost';
import { buildFlashcardEvent } from '../drills/gradeAnswer';

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}
const cfg = (o: Partial<GameConfig> = {}): GameConfig => ({
  penetration: 0.75,
  betSpreadOn: false,
  spread: DEFAULT_SPREAD,
  bankrollStart: 100,
  countCheckEvery: 0,
  seed: 1,
  ...o,
});

describe('priceMistake (#25)', () => {
  const ctx = { canDouble: true, canSplit: true, canSurrender: true };

  it('prices only a basic error', () => {
    const cards = rig('10', '7');
    const expected = basicPlay(cards, '6', ctx, DEFAULT_RULES);
    expect(expected.action).toBe('stand');
    expect(expected.source).toBe('basic');
    expect(priceMistake(cards, '6', ctx, DEFAULT_RULES, expected, 'hit', 'basic-error')).toBeGreaterThan(0);
    for (const c of ['correct', 'missed-deviation', 'phantom-deviation', 'wrong-anyway'] as const) {
      expect(priceMistake(cards, '6', ctx, DEFAULT_RULES, expected, 'hit', c)).toBeUndefined();
    }
  });

  it('gives the same number the flashcard drill does for the same hand', () => {
    const cards = rig('10', '7') as [Card, Card];
    const drill = buildFlashcardEvent(
      { cards, up: '6', correct: 'stand', cellId: 'hard-17-v-6' },
      'hit',
      DEFAULT_RULES,
      1000,
    ).event.evCost;
    const expected = basicPlay(cards, '6', ctx, DEFAULT_RULES);
    expect(drill).toBeGreaterThan(0);
    expect(priceMistake(cards, '6', ctx, DEFAULT_RULES, expected, 'hit', 'basic-error')).toBe(drill);
  });
});

describe('Play prices its basic errors (#25)', () => {
  it('a basic error at the table carries evCost, the drills\' figure for that hand', () => {
    // P(10,7) v 6: basic stands, with no index either way; hitting is a basic error.
    const game = Game.withRiggedShoe(cfg(), rig('10', '6', '7', '10', '2', '9'));
    game.startRound();
    game.act('hit');
    const ev = game.events.find((e) => e.kind === 'action')!;
    expect(ev.classification).toBe('basic-error');
    const drill = buildFlashcardEvent(
      { cards: rig('10', '7') as [Card, Card], up: '6', correct: 'stand', cellId: 'hard-17-v-6' },
      'hit',
      DEFAULT_RULES,
      1000,
    ).event.evCost;
    expect(ev.evCost).toBe(drill);
  });

  it('is priced on the hand at the decision, not after the card it drew', () => {
    // P(10,7) v 6 hits, then (10,7,2)=19 hits again: that second play is
    // priced as 19 v 6, a different (and dearer) cost than 17 v 6.
    const game = Game.withRiggedShoe(cfg(), rig('10', '6', '7', '10', '2', 'A', '9'));
    game.startRound();
    game.act('hit');
    game.act('hit');
    const [first, second] = game.events.filter((e) => e.kind === 'action');
    expect(first.hand).toBe('10,7 v 6');
    expect(second.hand).toBe('10,7,2 v 6');
    expect(first.classification).toBe('basic-error');
    expect(second.classification).toBe('basic-error');
    expect(second.evCost).toBeGreaterThan(first.evCost!);
  });

  it('a correct play and a missed index are left unpriced', () => {
    const ok = Game.withRiggedShoe(cfg(), rig('10', '6', '7', '10', '2', '9'));
    ok.startRound();
    ok.act('stand');
    expect('evCost' in ok.events.find((e) => e.kind === 'action')!).toBe(false);

    // Split 9,9 v 10 -> 9,7 v 10 at tc 0 hits: a missed 16v10 index.
    const missed = Game.withRiggedShoe(cfg(), rig('9', '10', '9', '7', '7', '2', '5'));
    missed.startRound();
    missed.act('split');
    missed.act('hit');
    const ev = missed.events[missed.events.length - 1];
    expect(ev.classification).toBe('missed-deviation');
    expect(ev.evCost).toBeUndefined();
  });
});
