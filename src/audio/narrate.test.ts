import { describe, it, expect } from 'vitest';
import type { Card } from '../engine/cards';
import type { GradedEvent } from '../engine/grade';
import type { Stats } from '../store/types';
import { EMPTY_STATS } from '../store/types';
import {
  narrateCard, narrateCards, narrateTc, narrateAction, narrateBotAction,
  narrateResult, narrateHandResult, narrateCorrection, narrateCountAnswer,
  narrateFlashcardPrompt, narrateQuizPrompt, narrateTotal, narrateStatsSummary,
  narrateHandPhrase, narrateReason,
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

describe('narrateCard / narrateCards — detail levels', () => {
  it('omitting detail defaults to "full" and stays byte-identical to today\'s output', () => {
    expect(narrateCard(c('Q', 'h'))).toBe('queen of hearts');
    expect(narrateCard(c('A', 's'))).toBe('ace of spades');
    expect(narrateCard(c('10', 'd'))).toBe('ten of diamonds');
    expect(narrateCards([c('Q', 'h'), c('4', 's')])).toBe('queen of hearts, four of spades');
  });

  it('detail "full" is identical to the default', () => {
    expect(narrateCard(c('Q', 'h'), 'full')).toBe('queen of hearts');
    expect(narrateCard(c('10', 'd'), 'full')).toBe('ten of diamonds');
    expect(narrateCards([c('Q', 'h'), c('4', 's')], 'full')).toBe('queen of hearts, four of spades');
  });

  it('detail "rank" drops the suit for every rank', () => {
    expect(narrateCard(c('Q', 'h'), 'rank')).toBe('queen');
    expect(narrateCard(c('A', 's'), 'rank')).toBe('ace');
    expect(narrateCard(c('10', 'd'), 'rank')).toBe('ten');
    expect(narrateCard(c('J', 'c'), 'rank')).toBe('jack');
    expect(narrateCard(c('K', 'h'), 'rank')).toBe('king');
    expect(narrateCard(c('7', 's'), 'rank')).toBe('seven');
    expect(narrateCards([c('Q', 'h'), c('4', 's')], 'rank')).toBe('queen, four');
  });

  it('detail "face" collapses every ten-value rank (10/J/Q/K) to "ten"', () => {
    expect(narrateCard(c('10', 'd'), 'face')).toBe('ten');
    expect(narrateCard(c('J', 'c'), 'face')).toBe('ten');
    expect(narrateCard(c('Q', 'h'), 'face')).toBe('ten');
    expect(narrateCard(c('K', 's'), 'face')).toBe('ten');
  });

  it('detail "face" leaves non-ten ranks the same as "rank"', () => {
    expect(narrateCard(c('A', 's'), 'face')).toBe('ace');
    expect(narrateCard(c('7', 'h'), 'face')).toBe('seven');
    expect(narrateCard(c('2', 'd'), 'face')).toBe('two');
    expect(narrateCard(c('9', 'c'), 'face')).toBe('nine');
  });

  it('"rank" and "face" remain distinct for ten-value cards', () => {
    expect(narrateCard(c('K', 'h'), 'rank')).toBe('king');
    expect(narrateCard(c('K', 'h'), 'face')).toBe('ten');
    expect(narrateCard(c('J', 'h'), 'rank')).toBe('jack');
    expect(narrateCard(c('J', 'h'), 'face')).toBe('ten');
  });

  it('narrateCards forwards the detail level to every card', () => {
    expect(narrateCards([c('K', 'h'), c('J', 's'), c('7', 'd')], 'face')).toBe('ten, ten, seven');
    expect(narrateCards([c('K', 'h'), c('J', 's'), c('7', 'd')], 'rank')).toBe('king, jack, seven');
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
    // The reason goes through narrateReason: the raw index label is written to
    // be read in a table, and spoken verbatim it is both unintelligible and
    // unclippable (see narrateReason's own comment).
    expect(narrateCorrection(base)).toBe(
      'Wrong. Sixteen versus ten: stand at true count zero or higher. Correct play was stand. True count was plus five.',
    );
  });

  it('leaves no comparison symbol anywhere in a spoken correction', () => {
    expect(narrateCorrection(base)).not.toMatch(/[≥≤]/);
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

/* ------------------------------------------------------------------------ */
/* narrateHandPhrase — 'cards' vs 'total' hand announcement                 */
/* ------------------------------------------------------------------------ */

describe("narrateHandPhrase — 'cards' (the default)", () => {
  it('speaks a soft non-pair hand card by card, not as a soft total', () => {
    // "ace, three" tells the learner WHICH soft hand it is; "soft fourteen"
    // makes them re-derive the composition that decides the play.
    expect(narrateHandPhrase([c('A', 's'), c('3', 'h')], 'cards')).toBe('ace, three');
  });
  it('speaks the cards in the order they were dealt', () => {
    expect(narrateHandPhrase([c('7', 'd'), c('A', 'c')], 'cards')).toBe('seven, ace');
  });
  it('never includes suits, even though the cards carry them', () => {
    expect(narrateHandPhrase([c('A', 's'), c('6', 's')], 'cards')).toBe('ace, six');
  });
  it('leaves a hard hand as its total — composition changes nothing there', () => {
    expect(narrateHandPhrase([c('10', 's'), c('6', 'h')], 'cards')).toBe('sixteen');
  });
  it('leaves a pair as "a pair of ..." — pairs already name their composition', () => {
    expect(narrateHandPhrase([c('8', 's'), c('8', 'h')], 'cards')).toBe('a pair of eights');
  });
  it('treats a pair of aces as a pair, not as a soft card list', () => {
    expect(narrateHandPhrase([c('A', 's'), c('A', 'h')], 'cards')).toBe('a pair of aces');
  });
  it('defaults to the cards style when no style is passed', () => {
    expect(narrateHandPhrase([c('A', 's'), c('3', 'h')])).toBe('ace, three');
  });
});

describe("narrateHandPhrase — 'total' (the pre-existing behavior)", () => {
  it('speaks a soft hand as a soft total', () => {
    expect(narrateHandPhrase([c('A', 's'), c('3', 'h')], 'total')).toBe('soft fourteen');
  });
  it('speaks a hard hand as its total', () => {
    expect(narrateHandPhrase([c('10', 's'), c('6', 'h')], 'total')).toBe('sixteen');
  });
  it('speaks a pair as a pair', () => {
    expect(narrateHandPhrase([c('8', 's'), c('8', 'h')], 'total')).toBe('a pair of eights');
  });
});

describe('drill prompts', () => {
  it('speaks a flashcard scenario', () => {
    expect(narrateFlashcardPrompt([c('10', 's'), c('4', 'h')], '10'))
      .toBe('You have fourteen. Dealer shows ten.');
  });
  it('speaks a soft flashcard hand card by card by default', () => {
    expect(narrateFlashcardPrompt([c('A', 's'), c('7', 'h')], '9'))
      .toBe('You have ace, seven. Dealer shows nine.');
  });
  it("speaks a soft flashcard total as soft under the 'total' style", () => {
    expect(narrateFlashcardPrompt([c('A', 's'), c('7', 'h')], '9', 'total'))
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
  it('threads the hand style through the quiz prompt too', () => {
    expect(narrateQuizPrompt([c('A', 's'), c('7', 'h')], '10', 4))
      .toBe('You have ace, seven. Dealer shows ten. True count plus four.');
    expect(narrateQuizPrompt([c('A', 's'), c('7', 'h')], '10', 4, 'total'))
      .toBe('You have soft eighteen. Dealer shows ten. True count plus four.');
  });
  it('ignores the hand style for the insurance quiz variant (no player cards)', () => {
    expect(narrateQuizPrompt(null, 'A', 3, 'cards'))
      .toBe('Dealer shows ace. Insurance offered. True count plus three.');
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

describe('narrateStatsSummary', () => {
  const statsWith = (mistakes: Partial<Stats['mistakes']>): Stats => ({
    ...EMPTY_STATS,
    mistakes: { ...EMPTY_STATS.mistakes, ...mistakes },
  });

  it('summarizes total decisions and nonzero mistake types', () => {
    expect(
      narrateStatsSummary(statsWith({ correct: 38, 'basic-error': 3, 'missed-deviation': 1 })),
    ).toBe('This session: 42 decisions, 3 basic errors, 1 missed deviation.');
  });

  it('uses singular wording for exactly one decision and one mistake', () => {
    expect(narrateStatsSummary(statsWith({ 'basic-error': 1 }))).toBe(
      'This session: 1 decision, 1 basic error.',
    );
  });

  it('says "no mistakes" when every mistake tally is zero', () => {
    expect(narrateStatsSummary(statsWith({ correct: 10 }))).toBe('This session: 10 decisions, no mistakes.');
  });

  it('reports zero decisions on empty stats', () => {
    expect(narrateStatsSummary(EMPTY_STATS)).toBe('This session: 0 decisions, no mistakes.');
  });

  it('lists mistake types in a fixed order regardless of magnitude', () => {
    expect(
      narrateStatsSummary(
        statsWith({ 'wrong-anyway': 2, 'phantom-deviation': 1, 'missed-deviation': 4, 'basic-error': 1 }),
      ),
    ).toBe(
      'This session: 8 decisions, 1 basic error, 4 missed deviations, 1 phantom deviation, 2 wrong-anyway plays.',
    );
  });
});

/* ------------------------------------------------------------------ */
/* narrateReason — index labels and basic reasons into speakable prose */
/* ------------------------------------------------------------------ */

describe('narrateReason', () => {
  it('speaks the "v" in a matchup as "versus"', () => {
    expect(narrateReason('16 v 10: stand at TC ≥ 0')).toContain('versus');
  });

  it('never leaves a comparison symbol in the output', () => {
    // The whole point: these reach the ear via TTS (and the clip cascade,
    // which cannot match a symbol at all).
    const spoken = narrateReason('16 v 10: stand at TC ≥ 0');
    expect(spoken).not.toMatch(/[≥≤]/);
  });

  it('turns a "greater or equal" threshold into "or higher"', () => {
    expect(narrateReason('16 v 10: stand at TC ≥ 0')).toBe(
      'Sixteen versus ten: stand at true count zero or higher.',
    );
  });

  it('turns a "less or equal" threshold into "or lower"', () => {
    expect(narrateReason('13 v 3: hit at TC ≤ -2')).toBe(
      'Thirteen versus three: hit at true count minus two or lower.',
    );
  });

  it('handles the unicode minus sign the deviation table actually uses', () => {
    // deviations.ts writes U+2212, not ASCII hyphen. A naive parser drops it
    // and inverts the meaning of the index.
    expect(narrateReason('13 v 2: hit at TC ≤ −1')).toBe(
      'Thirteen versus two: hit at true count minus one or lower.',
    );
  });

  it('speaks a signed positive threshold as "plus"', () => {
    expect(narrateReason('15 v 10: stand at TC ≥ +4')).toBe(
      'Fifteen versus ten: stand at true count plus four or higher.',
    );
  });

  it('speaks a pair matchup as a pair rather than two numbers', () => {
    expect(narrateReason('10,10 v 5: split at TC ≥ +5')).toBe(
      'A pair of tens versus five: split at true count plus five or higher.',
    );
  });

  it('expands the dealer-rule suffix instead of spelling out "H17"', () => {
    expect(narrateReason('16 v 9: stand at TC ≥ +4 (H17)')).toBe(
      'Sixteen versus nine: stand at true count plus four or higher, when the dealer hits soft seventeen.',
    );
  });

  it('expands the S17 suffix too', () => {
    expect(narrateReason('11 v A: double at TC ≥ +1 (S17)')).toBe(
      'Eleven versus ace: double at true count plus one or higher, when the dealer stands soft seventeen.',
    );
  });

  it('speaks a dealer ace as "ace", not the letter A', () => {
    expect(narrateReason('11 v A: double at TC ≥ +1 (S17)')).toContain('versus ace');
  });

  it('handles the insurance index, which has no hand on the left', () => {
    expect(narrateReason('Insurance: take at TC ≥ +3')).toBe(
      'Insurance: take at true count plus three or higher.',
    );
  });

  it('handles a prose index with no numeric threshold at all', () => {
    expect(narrateReason('12 v 4: hit at any negative TC')).toBe(
      'Twelve versus four: hit at any negative true count.',
    );
  });

  it('speaks a plain basic-strategy reason without mangling it', () => {
    expect(narrateReason('Basic hit vs dealer 9')).toBe('Basic hit versus dealer nine.');
  });

  it('keeps a parenthetical availability note readable', () => {
    expect(narrateReason('Basic stand (double unavailable) vs dealer 6')).toBe(
      'Basic stand (double unavailable) versus dealer six.',
    );
  });

  it('leaves an already-clean sentence alone apart from terminal punctuation', () => {
    expect(narrateReason('Basic surrender vs dealer 10')).toBe('Basic surrender versus dealer ten.');
  });

  it('does not double up terminal punctuation', () => {
    expect(narrateReason('Basic hit vs dealer 9.')).toBe('Basic hit versus dealer nine.');
  });

  it('returns empty for an empty reason rather than a bare full stop', () => {
    expect(narrateReason('')).toBe('');
  });
});
