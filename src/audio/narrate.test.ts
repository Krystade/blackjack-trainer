import { describe, it, expect } from 'vitest';
import type { Card } from '../engine/cards';
import type { GradedEvent } from '../engine/grade';
import {
  narrateCard, narrateCards, narrateTc, narrateAction, narrateBotAction,
  narrateResult, narrateHandResult, narrateCorrection, narrateCountAnswer,
  narrateFlashcardPrompt, narrateQuizPrompt, narrateTotal,
} from './narrate';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

describe('narrateCard — every rank and suit', () => {
  it('names face cards and suits', () => {
    expect(narrateCard(c('Q', 'h'))).toBe('queen of hearts');
    expect(narrateCard(c('A', 's'))).toBe('ace of spades');
    expect(narrateCard(c('10', 'd'))).toBe('ten of diamonds');
    expect(narrateCard(c('J', 'c'))).toBe('jack of clubs');
    expect(narrateCard(c('K', 'h'))).toBe('king of hearts');
    expect(narrateCard(c('2', 's'))).toBe('two of spades');
  });
  it('joins multiple cards with commas', () => {
    expect(narrateCards([c('Q', 'h'), c('4', 's')])).toBe('queen of hearts, four of spades');
  });
});

describe('narrateAction', () => {
  it('speaks each action verbatim', () => {
    expect(narrateAction('hit')).toBe('hit');
    expect(narrateAction('stand')).toBe('stand');
    expect(narrateAction('double')).toBe('double');
    expect(narrateAction('split')).toBe('split');
    expect(narrateAction('surrender')).toBe('surrender');
  });
});

describe('narrateTc — sign-correct wording', () => {
  it('speaks zero, plus and minus', () => {
    expect(narrateTc(0)).toBe('zero');
    expect(narrateTc(5)).toBe('plus five');
    expect(narrateTc(-3)).toBe('minus three');
    expect(narrateTc(1)).toBe('plus one');
  });
});

describe('narrateResult / narrateHandResult', () => {
  it('speaks each settlement kind', () => {
    expect(narrateResult('win', 2)).toBe('Win, plus two.');
    expect(narrateResult('lose', -1)).toBe('Lose, minus one.');
    expect(narrateResult('push', 0)).toBe('Push.');
    expect(narrateResult('blackjack', 1.5)).toBe('Blackjack! Plus one point five.');
    expect(narrateResult('surrender', -0.5)).toBe('Surrender, minus zero point five.');
  });
  it('prefixes the hand number only in multi-hand rounds', () => {
    expect(narrateHandResult(0, 2, 'win', 2)).toBe('Hand one: Win, plus two.');
    expect(narrateHandResult(1, 2, 'lose', -4)).toBe('Hand two: Lose, minus four.');
    expect(narrateHandResult(0, 1, 'win', 2)).toBe('Win, plus two.');
  });
});

describe('narrateCorrection', () => {
  const base: GradedEvent = {
    kind: 'action', category: 'hard', correct: false, classification: 'missed-deviation',
    taken: 'hit', expected: 'stand', reason: '16 v 10: stand at TC ≥ 0',
    deviationId: '16v10', tc: 5, hand: '10,6 v 10',
  };
  it('speaks the engine reason, the correct action, and the sign-correct TC', () => {
    expect(narrateCorrection(base)).toBe(
      'Wrong. 16 v 10: stand at TC ≥ 0 Correct play was stand. True count was plus five.',
    );
  });
  it('speaks a negative TC as "minus"', () => {
    expect(narrateCorrection({ ...base, tc: -3 })).toContain('True count was minus three.');
  });
  it('says just "Correct." for a correct event', () => {
    expect(narrateCorrection({ ...base, correct: true })).toBe('Correct.');
  });
});

describe('narrateBotAction', () => {
  it('speaks the seat, the action, and any drawn card', () => {
    expect(narrateBotAction('P2', 'hit', c('10', 'c'))).toBe('Player two hits, ten of clubs.');
    expect(narrateBotAction('P1', 'stand')).toBe('Player one stands.');
    expect(narrateBotAction('P3', 'double', c('9', 'h'))).toBe('Player three doubles, nine of hearts.');
    expect(narrateBotAction('P5', 'split')).toBe('Player five splits.');
  });
});

describe('drill prompts', () => {
  it('speaks a flashcard scenario', () => {
    expect(narrateFlashcardPrompt([c('10', 's'), c('4', 'h')], '10'))
      .toBe('You have fourteen. Dealer shows ten.');
  });
  it('speaks a soft flashcard total as soft', () => {
    expect(narrateFlashcardPrompt([c('A', 's'), c('7', 'h')], '9'))
      .toBe('You have soft eighteen. Dealer shows nine.');
  });
  it('speaks a pair as a pair', () => {
    expect(narrateFlashcardPrompt([c('8', 's'), c('8', 'h')], '10'))
      .toBe('You have a pair of eights. Dealer shows ten.');
  });
  it('appends the true count for quiz items', () => {
    expect(narrateQuizPrompt([c('10', 's'), c('6', 'h')], '10', 4))
      .toBe('You have sixteen. Dealer shows ten. True count plus four.');
  });
  it('speaks the insurance quiz variant (no player cards)', () => {
    expect(narrateQuizPrompt(null, 'A', 3))
      .toBe('Dealer shows ace. Insurance offered. True count plus three.');
  });
  it('speaks the count-drill answer', () => {
    expect(narrateCountAnswer(-3)).toBe('The count is minus three.');
    expect(narrateCountAnswer(0)).toBe('The count is zero.');
  });
  it('narrateTotal marks softness', () => {
    expect(narrateTotal(18, true)).toBe('soft eighteen');
    expect(narrateTotal(14, false)).toBe('fourteen');
  });
});
