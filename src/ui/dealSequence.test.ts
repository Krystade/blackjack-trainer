import { describe, expect, it } from 'vitest';
import { Game, type DealSlot } from '../engine/game';
import { DEALER_SEAT, casinoRoundSteps, roundMs, sitOutSteps, stepHoldMs, stepStarts, type DealStep } from './dealSequence';

const label = (s: DealStep): string => {
  switch (s.kind) {
    case 'card':
      return `${s.seat === DEALER_SEAT ? 'D' : `S${s.seat}`}${s.hand ? `h${s.hand}` : ''}.${s.card}`;
    case 'act':
      return `S${s.seat}-`;
    case 'reveal':
      return 'hole';
    case 'payout':
      return 'pay';
    case 'collect':
      return `take${s.seat === DEALER_SEAT ? 'D' : `S${s.seat}`}`;
  }
};

describe('casinoRoundSteps', () => {
  it('deals first base to third and the dealer, twice; then each seat draws, then the dealer turns and draws', () => {
    // Three seats: first base ends on 3 cards, the middle stands on 2, third base on 4. The dealer draws one.
    const steps = casinoRoundSteps([3, 2, 4], 3, { collect: false });
    expect(steps.map(label)).toEqual([
      'S0.0', 'S1.0', 'S2.0', 'D.0',
      'S0.1', 'S1.1', 'S2.1', 'D.1',
      'S0.2',
      'S2.2', 'S2.3',
      'hole',
      'D.2',
    ]);
  });

  it('with collect: a payout beat, then the cards come up from third base to first, and the dealer last', () => {
    const steps = casinoRoundSteps([2, 2, 2], 2, { collect: true });
    expect(steps.slice(-5).map(label)).toEqual(['pay', 'takeS2', 'takeS1', 'takeS0', 'takeD']);
    // Nothing collected before the payout, and the payout after the dealer's last card.
    const pay = steps.findIndex((s) => s.kind === 'payout');
    expect(steps.slice(0, pay).some((s) => s.kind === 'collect')).toBe(false);
    expect(steps[pay - 1]).toEqual({ kind: 'reveal' });
  });

  it('one card per step: every card a round shows is dealt exactly once', () => {
    const seats = [5, 2, 3, 2, 6];
    const steps = casinoRoundSteps(seats, 4, { collect: true });
    const cards = steps.filter((s) => s.kind === 'card').map(label);
    expect(new Set(cards).size).toBe(cards.length);
    expect(cards).toHaveLength(seats.reduce((a, b) => a + b, 0) + 4);
  });
});

describe('sitOutSteps', () => {
  it('follows the engine: the opening as dealt, each bot turn as played, then the hole and the draws', () => {
    const order: DealSlot[] = [
      { kind: 'bot', seatIndex: 1, handIndex: 0, cardIndex: 0 },
      { kind: 'bot', seatIndex: 2, handIndex: 0, cardIndex: 0 },
      { kind: 'dealer', cardIndex: 0 },
      { kind: 'bot', seatIndex: 1, handIndex: 0, cardIndex: 1 },
      { kind: 'bot', seatIndex: 2, handIndex: 0, cardIndex: 1 },
      { kind: 'dealer', cardIndex: 1 },
    ];
    const log = [
      { seat: 1, handIndex: 0, card: {} },
      { seat: 1, handIndex: 0 },
      { seat: 2, handIndex: 0, card: {} },
      { seat: 2, handIndex: 0, card: {} },
    ];
    expect(sitOutSteps(order, log, 3, true).map(label)).toEqual([
      'S1.0', 'S2.0', 'D.0', 'S1.1', 'S2.1', 'D.1',
      'S1.2', 'S1-', 'S2.2', 'S2.3',
      'hole', 'D.2',
    ]);
  });

  it('a hole the round never turned stays down: no reveal step', () => {
    const order: DealSlot[] = [{ kind: 'dealer', cardIndex: 0 }, { kind: 'dealer', cardIndex: 1 }];
    expect(sitOutSteps(order, [], 2, false).map(label)).toEqual(['D.0', 'D.1']);
  });

  it("a real round Out: one step per card the engine dealt, plus the hole and one per turn that took none", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const game = new Game({
        penetration: 0.75,
        betSpreadOn: false,
        spread: [{ minTc: -99, units: 1 }],
        bankrollStart: 100,
        countCheckEvery: 0,
        seats: { playerHands: 1, bots: 3, botMistakePct: 0, playerPosition: 0 },
        seed,
      });
      game.sitOut();
      const steps = sitOutSteps(game.dealOrder, game.botActionLog, game.dealerCards.length, game.holeRevealed);
      const botCards = game.seats.reduce((n, s) => n + (s.kind === 'bot' ? s.hands.reduce((m, h) => m + h.cards.length, 0) : 0), 0);
      const splits = game.botActionLog.filter((e) => e.action === 'split').length;
      // A split's two new second cards come with the split itself, not as steps of their own.
      const cardSteps = steps.filter((s) => s.kind === 'card').length;
      expect(cardSteps, `seed ${seed}`).toBe(botCards + game.dealerCards.length - 2 * splits);
      expect(steps.filter((s) => s.kind === 'act').length, `seed ${seed}`).toBe(
        game.botActionLog.filter((e) => !e.card).length,
      );
      expect(steps.filter((s) => s.kind === 'reveal').length, `seed ${seed}`).toBe(game.holeRevealed ? 1 : 0);
    }
  });
});

describe('pace', () => {
  const steps = casinoRoundSteps([2], 2, { collect: true });
  const pace = { cardMs: 300, payoutMs: 1500, collectMs: 200 };

  it('each step starts when the one before it has held its beat', () => {
    const starts = stepStarts(steps, pace);
    // S0.0 D.0 S0.1 D.1 hole pay takeS0 takeD
    expect(starts).toEqual([0, 300, 600, 900, 1200, 1500, 3000, 3200]);
    expect(roundMs(steps, pace)).toBe(3400);
    expect(stepHoldMs(steps, 5, pace)).toBe(1500);
    expect(stepHoldMs(steps, 99, pace)).toBe(0);
  });
});
