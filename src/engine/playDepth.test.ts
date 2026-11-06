import { describe, expect, it } from 'vitest';
import { Game, playDecksRemaining, playDepthStep } from './game';

describe('Play deck estimation step (owner 2026-11-06)', () => {
  const shoe = (cardsRemaining: number) => ({ cardsRemaining, decksRemaining: Math.max(0.5, Math.round(cardsRemaining / 26) / 2) });

  it('whole decks round to the nearest deck, never below one', () => {
    expect(playDecksRemaining(shoe(104), 'whole')).toBe(2);
    expect(playDecksRemaining(shoe(130), 'whole')).toBe(3); // 2.5 rounds up
    expect(playDecksRemaining(shoe(20), 'whole')).toBe(1);
  });

  it('quarters read the quarter, and half is the shoe as before', () => {
    expect(playDecksRemaining(shoe(91), 'quarter')).toBe(1.75);
    expect(playDecksRemaining(shoe(91), 'half')).toBe(shoe(91).decksRemaining);
    expect(playDecksRemaining(shoe(91), undefined)).toBe(shoe(91).decksRemaining);
  });

  it('the grading slack is one step', () => {
    expect([playDepthStep('whole'), playDepthStep('half'), playDepthStep('quarter'), playDepthStep(undefined)]).toEqual([1, 0.5, 0.25, 0.5]);
  });

  it("Play's true count divides by the chosen step", () => {
    const g = new Game({ penetration: 0.75, betSpreadOn: false, spread: [{ minTc: -99, units: 1 }], playDepth: 'whole' } as never);
    for (let i = 0; i < 312 - 91; i++) g.shoe.draw(); // 1.75 decks left
    g.runningCount = 6;
    expect(g.trueCountNow).toBe(3); // 6 / 2
    const q = new Game({ penetration: 0.75, betSpreadOn: false, spread: [{ minTc: -99, units: 1 }], playDepth: 'quarter' } as never);
    for (let i = 0; i < 312 - 91; i++) q.shoe.draw();
    q.runningCount = 6;
    expect(q.trueCountNow).toBe(3); // floor(6 / 1.75 = 3.43)
    q.runningCount = 7;
    expect(q.trueCountNow).toBe(4); // 7 / 1.75 = 4
  });
});
