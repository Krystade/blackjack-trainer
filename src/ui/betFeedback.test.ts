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

describe('Wave J: the back-count entry miss', () => {
  const entry = (taken: 'watch' | 'sit-in', tc: number, wongInTc = 1): GradedEvent => ({
    source: 'table', kind: 'wongIn', category: 'wongIn', correct: false, classification: 'basic-error',
    taken, expected: taken === 'watch' ? 'sit-in' : 'watch', reason: `Back-count entry at tc ${tc} (enter at ${wongInTc})`, tc, wongInTc,
  });
  it('watching through a count at the entry point: sit in, and the recorded "ramp plays" line', () => {
    expect(betMissFeedback([entry('watch', 2)])).toEqual({
      text: 'TC +2 — sit in (you enter at +1)',
      spoken: 'Your ramp plays. True count plus two.',
    });
  });
  it('sitting in short of it: keep watching, and the recorded "ramp sits out" line', () => {
    expect(betMissFeedback([entry('sit-in', 0)])).toEqual({
      text: 'TC +0 — keep watching (you enter at +1)',
      spoken: 'Your ramp sits out. True count zero.',
    });
  });
  it('names the entry point the decision was graded at', () => {
    expect(betMissFeedback([entry('sit-in', 2, 3)])?.text).toBe('TC +2 — keep watching (you enter at +3)');
  });
  it('a right entry says nothing', () => {
    expect(betMissFeedback([{ ...entry('watch', 0), correct: true, classification: 'correct', expected: 'watch' }])).toBeNull();
  });
  it('leaving a back-count table above the exit point', () => {
    expect(betMissFeedback([wong('leave' as 'sit-out', 'play', 1)])).toEqual({
      text: 'Play at TC +1 — you left',
      spoken: 'Your ramp plays. True count plus one.',
    });
  });
});

describe('Wave J: a two-hand ramp names the hands', () => {
  const bet = (taken: string, expected: string, tc: number, handsTaken: number, handsExpected: number): GradedEvent => ({
    source: 'table', kind: 'bet', category: 'bet', correct: false, classification: 'basic-error',
    taken, expected, reason: `Spread bet at tc ${tc}`, tc, handsTaken, handsExpected,
  });
  it('one hand where the ramp spreads to two: the stake line, then the hand count on its own', () => {
    expect(betMissFeedback([bet('8', '8', 4, 1, 2)])).toEqual({
      text: 'Bet two hands of 8u at TC +4 — you bet one hand of 8u',
      spoken: 'Your ramp bets eight. True count plus four.',
      spokenAfter: 'Two hands.',
    });
  });
  it('two hands where the ramp plays one', () => {
    expect(betMissFeedback([bet('8', '8', 3, 2, 1)])).toEqual({
      text: 'Bet one hand of 8u at TC +3 — you bet two hands of 8u',
      spoken: 'Your ramp bets eight. True count plus three.',
      spokenAfter: 'One hand.',
    });
  });
  it('the right hands on the wrong stake: the stake line alone', () => {
    expect(betMissFeedback([bet('4', '12', 5, 2, 2)])).toEqual({
      text: 'Bet two hands of 12u at TC +5 — you bet two hands of 4u',
      spoken: 'Your ramp bets twelve. True count plus five.',
    });
  });
  it('one hand on both sides reads as any bet does', () => {
    expect(betMissFeedback([bet('4', '2', 1, 1, 1)])?.text).toBe('Bet 2u at TC +1 — you bet 4u');
  });
});
