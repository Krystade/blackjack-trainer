import { describe, it, expect } from 'vitest';
import type { Card } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig } from './game';
import { correctPlay } from './strategy';
import {
  dealerErrorRate,
  toDealerMistakesMode,
  DEALER_ERROR_RATE,
  DEALER_ERROR_TRAINING_RATE,
  type DealerMistakesMode,
} from './dealerErrors';

/**
 * Wave I: Dealer mistakes is Off / Occasional (about one round in 30, G2's
 * rate) / Training (about one round in 5). Off still draws nothing.
 */

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    penetration: 0.75,
    betSpreadOn: false,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 7,
    ...overrides,
  };
}

function counting(inner: () => number): (() => number) & { calls: number } {
  const f = (() => {
    f.calls += 1;
    return inner();
  }) as (() => number) & { calls: number };
  f.calls = 0;
  return f;
}

function playOut(game: Game): void {
  for (let guard = 0; guard < 40 && game.phase !== 'settled'; guard++) {
    if (game.phase === 'insurance') {
      game.insuranceDecision(false);
      continue;
    }
    const hand = game.hands[game.active]!;
    const legal = game.legalActions();
    const advice = correctPlay(hand.cards, game.dealerCards[0]!.rank, game.trueCountNow, {
      canDouble: legal.includes('double'),
      canSplit: legal.includes('split'),
      canSurrender: legal.includes('surrender'),
    });
    game.act(legal.includes(advice.action) ? advice.action : 'stand');
  }
}

function errorRate(mode: DealerMistakesMode, seed: number, rounds: number): number {
  const game = new Game(cfg({ seed, dealerMistakes: mode }));
  for (let r = 0; r < rounds; r++) {
    game.startRound();
    playOut(game);
  }
  return game.dealerErrorTally.made / rounds;
}

const cardsOf = (cs: readonly Card[]) => cs.map((c) => `${c.rank}${c.suit}`).join(',');
const roundCards = (g: Game) =>
  [g.dealerCards, ...g.seats.flatMap((s) => s.hands.map((h) => h.cards))].map(cardsOf).join('|');

describe('Wave I: the mode', () => {
  it('reads G2 booleans: true is Occasional, false or absent is Off', () => {
    expect(toDealerMistakesMode(true)).toBe('occasional');
    expect(toDealerMistakesMode(false)).toBe('off');
    expect(toDealerMistakesMode(undefined)).toBe('off');
    expect(toDealerMistakesMode('training')).toBe('training');
    expect(toDealerMistakesMode('occasional')).toBe('occasional');
    expect(toDealerMistakesMode('nonsense')).toBe('off');
    expect(new Game(cfg({ dealerMistakes: true })).dealerMistakesMode).toBe('occasional');
    expect(new Game(cfg()).dealerMistakesMode).toBe('off');
  });

  it('Training rolls at a higher per-round chance than Occasional', () => {
    expect(dealerErrorRate('occasional')).toBe(DEALER_ERROR_RATE);
    expect(dealerErrorRate('training')).toBe(DEALER_ERROR_TRAINING_RATE);
    expect(DEALER_ERROR_TRAINING_RATE).toBeGreaterThan(DEALER_ERROR_RATE);
  });
});

describe('Wave I: rates over seeded play', () => {
  // Measured, not assumed: about half of all rounds have a hand an error can
  // be made on, so the per-eligible-round chance is roughly twice the target.
  for (const seed of [99, 2024, 31337]) {
    it(`seed ${seed}: Occasional lands near 1 in 30, Training near 1 in 5`, () => {
      const occasional = errorRate('occasional', seed, 6000);
      const training = errorRate('training', seed, 6000);
      expect(occasional).toBeGreaterThan(1 / 45);
      expect(occasional).toBeLessThan(1 / 22);
      expect(training).toBeGreaterThan(1 / 6.5);
      expect(training).toBeLessThan(1 / 4);
    });
  }

  it('true is the same stream as Occasional: identical errors on one seed', () => {
    const a = new Game(cfg({ seed: 555, dealerMistakes: true }));
    const b = new Game(cfg({ seed: 555, dealerMistakes: 'occasional' }));
    const kinds: string[][] = [[], []];
    for (let r = 0; r < 600; r++) {
      [a, b].forEach((g, i) => {
        g.startRound();
        playOut(g);
        if (g.dealerError) kinds[i]!.push(`${r}:${g.dealerError.kind}`);
      });
    }
    expect(kinds[0]!.length).toBeGreaterThan(0);
    expect(kinds[1]).toEqual(kinds[0]);
  });
});

describe('Wave I: Off stays silent', () => {
  it("'off' and false draw nothing, over hundreds of rounds", () => {
    for (const off of ['off', false] as const) {
      const rng = counting(() => 0);
      const game = new Game(cfg({ dealerMistakes: off, dealerErrorRng: rng }));
      for (let r = 0; r < 300; r++) {
        game.startRound();
        playOut(game);
      }
      expect(rng.calls).toBe(0);
      expect(game.dealerErrorTally.made).toBe(0);
      expect(game.dealerMistakesUsed).toBe(false);
    }
  });

  it('switched from Training to Off between rounds, the stream stops being drawn', () => {
    const rng = counting(() => 0.99);
    const game = new Game(cfg({ dealerMistakes: 'training', dealerErrorRng: rng }));
    for (let r = 0; r < 30; r++) {
      game.startRound();
      playOut(game);
    }
    const drawn = rng.calls;
    expect(drawn).toBeGreaterThan(0);
    game.setDealerMistakes('off');
    for (let r = 0; r < 200; r++) {
      game.startRound();
      playOut(game);
    }
    expect(rng.calls).toBe(drawn);
  });

  it('a seed deals the same cards with Training on as with it off', () => {
    const off = new Game(cfg({ seed: 4242 }));
    const training = new Game(cfg({ seed: 4242, dealerMistakes: 'training' }));
    for (let r = 0; r < 300; r++) {
      for (const g of [off, training]) {
        g.startRound();
        playOut(g);
      }
      expect(roundCards(training)).toBe(roundCards(off));
    }
    expect(training.dealerErrorTally.made).toBeGreaterThan(30);
  });
});

describe('Wave I: Training is recorded', () => {
  it('only a round settled on Training marks the game', () => {
    const game = new Game(cfg({ dealerMistakes: 'occasional' }));
    game.startRound();
    playOut(game);
    expect(game.dealerMistakesUsed).toBe(true);
    expect(game.dealerMistakesTrainingUsed).toBe(false);
    game.setDealerMistakes('training');
    // Set, but nothing settled on it yet.
    expect(game.dealerMistakesTrainingUsed).toBe(false);
    game.startRound();
    playOut(game);
    expect(game.dealerMistakesTrainingUsed).toBe(true);
  });
});
