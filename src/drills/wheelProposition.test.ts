import { describe, it, expect } from 'vitest';
import { mulberry32 } from '../engine/cards';
import { makeDefaultProfile } from '../store/profiles';
import { betSizingOptions, correctBetAnswer, gradeBetSizing } from './betSizing';
import {
  BET_UNIT_WORDS_MAX,
  betPropositionLabel,
  betPropositionVerdictText,
  betPropositionRow,
  narrateBetProposition,
  narrateBetVerdict,
  narrateSpeedPrompt,
  narrateYesNoVerdict,
  proposeBet,
} from './wheelProposition';
import type { SpeedQuestion } from './speedDrill';

const base = makeDefaultProfile();

describe('C-R1 bet proposition', () => {
  it('proposes the right bet about half the time, and wrong ones from the neighbours or Sit', () => {
    let right = 0;
    const N = 4000;
    const options = betSizingOptions(base.spread);
    for (let i = 0; i < N; i++) {
      const rng = mulberry32(i + 1);
      const tc = -3 + (i % 10);
      const p = proposeBet(rng, tc, base);
      expect(p.right).toBe(gradeBetSizing(p.proposed, tc, base));
      if (p.right) {
        right++;
        continue;
      }
      const k = options.indexOf(correctBetAnswer(tc, base.spread));
      const j = options.indexOf(p.proposed);
      // A neighbouring rung, or Sit.
      expect(p.proposed === 'sit' || Math.abs(j - k) === 1, `tc ${tc} proposed ${p.proposed}`).toBe(true);
    }
    expect(right / N).toBeGreaterThan(0.42);
    expect(right / N).toBeLessThan(0.62);
  });

  it('never proposes a "wrong" bet that cover bets would grade right', () => {
    const cover = { ...base, coverBets: true };
    for (let i = 0; i < 2000; i++) {
      const tc = -3 + (i % 10);
      const p = proposeBet(mulberry32(i + 7), tc, cover);
      expect(p.right).toBe(gradeBetSizing(p.proposed, tc, cover));
    }
  });

  it('speaks the count, the depth and the bet, in sentences the clips cover', () => {
    expect(narrateBetProposition({ rc: 3, cardsDealt: 4 * 52, totalDecks: 6 }, 4)).toBe(
      'Running count plus three. Two decks remaining. Bet four units?',
    );
    expect(narrateBetProposition({ rc: -2, cardsDealt: 52, totalDecks: 6 }, 'sit')).toBe(
      'Running count minus two. Five decks remaining. Sit out?',
    );
    expect(narrateBetProposition({ rc: 0, cardsDealt: 52, totalDecks: 6 }, 1)).toMatch(/Bet one unit\?$/);
    expect(BET_UNIT_WORDS_MAX).toBeGreaterThanOrEqual(12);
  });

  it('a yes to a right proposal and a no to a wrong one are both correct', () => {
    const s = { rc: 6, cardsDealt: 4 * 52, totalDecks: 6 }; // TC +3 -> 8u
    const yesRight = betPropositionRow(s, base, 8, true, 'd');
    expect(yesRight.ok).toBe(true);
    expect(yesRight.saidYes).toBe(true);
    expect(betPropositionRow(s, base, 4, false, 'd').ok).toBe(true);
    expect(betPropositionRow(s, base, 4, true, 'd').ok).toBe(false);
    expect(betPropositionRow(s, base, 8, false, 'd').ok).toBe(false);
    expect(betPropositionRow(s, base, 8, false, 'd').correct).toBe(8);
  });

  it('the verdict names the ramp\'s answer when wrong', () => {
    expect(narrateBetVerdict(true, 4)).toBe('Correct.');
    expect(narrateBetVerdict(false, 4)).toBe('Wrong. The ramp says four units.');
    expect(narrateBetVerdict(false, 1)).toBe('Wrong. The ramp says one unit.');
    expect(narrateBetVerdict(false, 'sit')).toBe('Wrong. The ramp says sit out.');
  });
});

describe('C-R1 bet proposition on screen', () => {
  it("asks and answers in the drill's own labels", () => {
    expect(betPropositionLabel(4)).toBe('Bet 4u?');
    expect(betPropositionLabel('sit')).toBe('Sit out?');
    expect(betPropositionVerdictText(4, false, 8, true)).toBe('Correct — You said no to 4u');
    expect(betPropositionVerdictText('sit', true, 2, false)).toBe('You said yes to sitting out · Right 2u');
  });
});

describe('C-R1 speed proposition', () => {
  const q = (over: Partial<SpeedQuestion>): SpeedQuestion => ({
    mode: 'surrender',
    cellId: 'hard-16-10',
    cards: [
      { rank: '10', suit: 's' },
      { rank: '6', suit: 'h' },
    ],
    up: '10',
    tc: null,
    answer: true,
    play: 'surrender',
    basic: 'surrender',
    ...over,
  });

  it('states the hand and asks the drill\'s own question', () => {
    expect(narrateSpeedPrompt(q({}))).toBe('You have sixteen. Dealer shows ten. Surrender?');
    expect(narrateSpeedPrompt(q({ mode: 'deviation', tc: -1 }))).toBe(
      'You have sixteen. Dealer shows ten. True count minus one. Deviation here?',
    );
  });

  it('says the right answer when wrong', () => {
    expect(narrateYesNoVerdict(true, true)).toBe('Correct.');
    expect(narrateYesNoVerdict(false, true)).toBe('Wrong. The answer is yes.');
    expect(narrateYesNoVerdict(false, false)).toBe('Wrong. The answer is no.');
  });
});
