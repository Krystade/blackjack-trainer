import { describe, it, expect } from 'vitest';
import type { Card, Rank } from './cards';
import { Game, DEFAULT_SPREAD } from './game';
import type { GameConfig } from './game';
import type { RuleSet } from './ruleset';

function rig(...ranks: Rank[]): Card[] {
  return ranks.map((rank) => ({ rank, suit: 's' }) as Card);
}

function cfg(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    penetration: 0.75,
    betSpreadOn: false,
    spread: DEFAULT_SPREAD,
    bankrollStart: 100,
    countCheckEvery: 0,
    seed: 1,
    ...overrides,
  };
}

describe('payout audit — table-driven settlement paths', () => {
  // Each row: { description, shoe, actions, expectedDelta }
  // expectedDelta = final bankroll - initial bankroll

  interface PayoutRow {
    description: string;
    shoe: Rank[];
    actions: string[]; // 'stand', 'hit', 'double', 'split', 'surrender', 'insurance:take', 'insurance:decline'
    expectedDelta: number;
    rules?: RuleSet;
  }

  const scenarios: PayoutRow[] = [
    {
      description: 'natural BJ 3:2 (P A,K vs D 9,8) with bj65:false',
      shoe: ['A', '9', 'K', '8'],
      actions: [],
      expectedDelta: 1.5,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'natural BJ 6:5 (P A,K vs D 9,8) with bj65:true',
      shoe: ['A', '9', 'K', '8'],
      actions: [],
      expectedDelta: 1.2,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: true },
    },
    {
      description: 'player win +1 (P 20 vs D 17)',
      shoe: ['10', '9', '6', '8', '4'],
      actions: ['hit', 'stand'], // P: 10,6,4=20; D: 9,8=17
      expectedDelta: 1,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'player lose -1 (P 16 hits to bust vs D up 9)',
      shoe: ['10', '9', '6', '8', 'K'],
      actions: ['hit'], // P: 10,6,K=bust; instant lose
      expectedDelta: -1,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'push 0 (P 17 vs D 17)',
      shoe: ['9', '10', '8', '7', '2'],
      actions: ['stand'], // P: 9,8=17; D: 10,7=17
      expectedDelta: 0,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'double win +2 (P double 5,6=11→10 vs D 17)',
      shoe: ['5', '9', '6', '8', '10'],
      actions: ['double'], // P: 5,6,10=21; D: 9,8=17
      expectedDelta: 2,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'double lose -2 (P double 5,6=11→3 vs D 17)',
      shoe: ['5', '9', '6', '8', '3'],
      actions: ['double'], // P: 5,6,3=14; D: 9,8=17
      expectedDelta: -2,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'surrender -0.5 (P 16 vs D up 9)',
      shoe: ['10', '9', '6', '2'],
      actions: ['surrender'], // P: 10,6=16; instant -0.5
      expectedDelta: -0.5,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'split pair (5,5): both hands play independently',
      shoe: ['5', '8', '5', '6', '10', '3', '7'],
      actions: ['split', 'stand', 'stand'], // P: hand0 5,10=15; hand1 5,3=8; D: 8,6=14,hit 7=21; both lose
      expectedDelta: -2, // Both hands lose to dealer 21
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    // Insurance audit tests
    {
      description: 'insurance taken + dealer BJ (delta 0 for insurance)',
      shoe: ['10', 'A', 'K', 'K'],
      actions: ['insurance:take'], // P: 10,K=20; D: A(up), K(hole)=BJ; insurance wins 1.0, hand loses 1.0, net = 0
      expectedDelta: 0,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'insurance taken + dealer no BJ (delta −1.5 for simple case)',
      shoe: ['10', 'A', 'K', '5', '5'],
      actions: ['insurance:take', 'stand'], // P: 10,K=20; D: A(up), 5(hole)=soft 16, hits 5=soft 21; dealer wins, insurance loses
      expectedDelta: -1.5,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
    {
      description: 'insurance declined + dealer BJ (delta −1)',
      shoe: ['10', 'A', 'K', 'K'],
      actions: ['insurance:decline'], // P: 10,K=20; D: A(up), K(hole)=BJ; no insurance, hand loses 1.0
      expectedDelta: -1,
      rules: { decks: 6, s17: false, das: true, ls: true, rsa: false, bj65: false },
    },
  ];

  scenarios.forEach((scenario) => {
    it(scenario.description, () => {
      const game = Game.withRiggedShoe(cfg({ rules: scenario.rules }), rig(...scenario.shoe));
      const initialBankroll = game.bankroll;

      // Start round before processing any actions
      game.startRound();

      // Execute actions in order
      for (const action of scenario.actions) {
        if (action === 'insurance:take') {
          if (game.phase === 'insurance') {
            game.insuranceDecision(true);
          }
        } else if (action === 'insurance:decline') {
          if (game.phase === 'insurance') {
            game.insuranceDecision(false);
          }
        } else {
          // Regular action
          if (game.phase === 'player') {
            game.act(action as any);
          }
        }
      }

      // Handle insurance phase if not already handled
      if (game.phase === 'insurance') {
        game.insuranceDecision(false);
      }

      // Drain remaining actions until settled
      while (game.phase === 'player') {
        game.act('stand');
      }

      const finalDelta = game.bankroll - initialBankroll;
      expect(finalDelta).toBeCloseTo(scenario.expectedDelta, 5);
    });
  });
});
