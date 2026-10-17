import { describe, it, expect } from 'vitest';
import type { GradedEvent } from '../engine/grade';
import { betMissFeedback } from './betFeedback';

const bet = (taken: number, expected: number, tc: number): GradedEvent => ({
  source: 'table', kind: 'bet', category: 'bet', correct: taken === expected, classification: taken === expected ? 'correct' : 'basic-error',
  taken: String(taken), expected: String(expected), reason: `Spread bet at tc ${tc}`, tc,
});
const wong = (taken: 'play' | 'sit-out', expected: 'play' | 'sit-out', tc: number): GradedEvent => ({
  source: 'table', kind: 'wong', category: 'wong', correct: taken === expected, classification: taken === expected ? 'correct' : 'basic-error',
  taken, expected, reason: `Wong decision at tc ${tc}`, tc,
});

describe('betMissFeedback (B2 #13, R2)', () => {
  it('a bet off the ramp: what the ramp bets, at what count, and what was bet', () => {
    expect(betMissFeedback([bet(1, 8, 3), wong('play', 'play', 3)])).toEqual({
      text: 'Bet 8u at TC +3 — you bet 1u',
      spoken: 'Your ramp bets eight. True count plus three.',
    });
  });
  it('playing a count the ramp sits out names the sit-out first, with a real minus', () => {
    expect(betMissFeedback([bet(2, 1, -1), wong('play', 'sit-out', -1)])).toEqual({
      text: 'Sit out at TC −1 — you bet 2u',
      spoken: 'Your ramp sits out. True count minus one.',
    });
  });
  it('sitting out a count the ramp plays', () => {
    expect(betMissFeedback([wong('sit-out', 'play', 1)])).toEqual({
      text: 'Play at TC +1 — you sat out',
      spoken: 'Your ramp plays. True count plus one.',
    });
  });
  it('nothing for right decisions, plays, or no events', () => {
    expect(betMissFeedback([bet(1, 1, 0), wong('sit-out', 'sit-out', 0)])).toBeNull();
    expect(betMissFeedback([])).toBeNull();
    expect(
      betMissFeedback([{ ...bet(1, 1, 0), kind: 'action', category: 'hard', correct: false, taken: 'hit', expected: 'stand' }]),
    ).toBeNull();
  });
  it('a multi-hand deal reports the first wrong bet', () => {
    expect(betMissFeedback([bet(4, 4, 2), bet(1, 4, 2), wong('play', 'play', 2)])?.text).toBe('Bet 4u at TC +2 — you bet 1u');
  });
});
