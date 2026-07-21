import type { Card, Rank, Suit } from '../engine/cards';
import type { Action } from '../engine/deviations';
import type { GradedEvent, MistakeClass } from '../engine/grade';
import { handValue, isPair, pairRank } from '../engine/hand';
import type { Stats } from '../store/types';

const SUIT_NAMES: Record<Suit, string> = {
  s: 'spades',
  h: 'hearts',
  d: 'diamonds',
  c: 'clubs',
};

const RANK_NAMES: Record<Rank, string> = {
  A: 'ace',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
  '10': 'ten',
  J: 'jack',
  Q: 'queen',
  K: 'king',
};

// Plural rank names for "a pair of eights" style prompts.
const RANK_PLURAL: Record<Rank, string> = {
  A: 'aces',
  '2': 'twos',
  '3': 'threes',
  '4': 'fours',
  '5': 'fives',
  '6': 'sixes',
  '7': 'sevens',
  '8': 'eights',
  '9': 'nines',
  '10': 'tens',
  J: 'jacks',
  Q: 'queens',
  K: 'kings',
};

const NUMBER_WORDS: Record<number, string> = {
  0: 'zero',
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
  18: 'eighteen',
  19: 'nineteen',
  20: 'twenty',
};

/** Speak a non-negative integer as a word, falling back to digits beyond the known range. */
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

export function narrateRank(rank: Rank): string {
  return RANK_NAMES[rank];
}

export function narrateCard(card: Card): string {
  return `${narrateRank(card.rank)} of ${SUIT_NAMES[card.suit]}`;
}

export function narrateCards(cards: Card[]): string {
  return cards.map(narrateCard).join(', ');
}

export function narrateTc(tc: number): string {
  if (tc === 0) return 'zero';
  if (tc > 0) return `plus ${numberWord(tc)}`;
  return `minus ${numberWord(Math.abs(tc))}`;
}

export function narrateTotal(total: number, soft: boolean): string {
  const word = numberWord(total);
  return soft ? `soft ${word}` : word;
}

export function narrateAction(action: Action): string {
  return action;
}

const SEAT_ORDINALS: Record<string, string> = {
  P1: 'one',
  P2: 'two',
  P3: 'three',
  P4: 'four',
  P5: 'five',
};

function narrateSeat(seatLabel: string): string {
  const ordinal = SEAT_ORDINALS[seatLabel] ?? seatLabel;
  return `Player ${ordinal}`;
}

const ACTION_VERB: Record<Action, string> = {
  hit: 'hits',
  stand: 'stands',
  double: 'doubles',
  split: 'splits',
  surrender: 'surrenders',
};

export function narrateBotAction(seatLabel: string, action: Action, card?: Card): string {
  const seat = narrateSeat(seatLabel);
  const verb = ACTION_VERB[action];
  if (card) {
    return `${seat} ${verb}, ${narrateCard(card)}.`;
  }
  return `${seat} ${verb}.`;
}

export function narrateDealerUp(up: Rank): string {
  return `Dealer shows ${narrateRank(up)}.`;
}

/** Speak a settlement amount, sign-correct, with "point" for fractional values. */
function narrateAmount(net: number): string {
  const sign = net > 0 ? 'plus' : net < 0 ? 'minus' : 'plus';
  const abs = Math.abs(net);
  const whole = Math.trunc(abs);
  const frac = Math.round((abs - whole) * 10);
  const wholeWord = numberWord(whole);
  if (frac === 0) {
    return `${sign} ${wholeWord}`;
  }
  return `${sign} ${wholeWord} point ${numberWord(frac)}`;
}

export function narrateResult(
  result: 'win' | 'lose' | 'push' | 'blackjack' | 'surrender',
  net: number,
): string {
  switch (result) {
    case 'win':
      return `Win, ${narrateAmount(net)}.`;
    case 'lose':
      return `Lose, ${narrateAmount(net)}.`;
    case 'push':
      return 'Push.';
    case 'blackjack':
      return `Blackjack! ${capitalize(narrateAmount(net))}.`;
    case 'surrender':
      return `Surrender, ${narrateAmount(net)}.`;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function narrateHandResult(
  handIndex: number,
  handCount: number,
  result: 'win' | 'lose' | 'push' | 'blackjack' | 'surrender',
  net: number,
): string {
  if (handCount === 1) {
    return narrateResult(result, net);
  }
  return `Hand ${numberWord(handIndex + 1)}: ${narrateResult(result, net)}`;
}

export function narrateCorrection(event: GradedEvent): string {
  if (event.correct) {
    return 'Correct.';
  }
  return `Wrong. ${event.reason} Correct play was ${narrateAction(event.expected as Action)}. True count was ${narrateTc(event.tc)}.`;
}

export function narrateCountPrompt(): string {
  return "What's the running count?";
}

export function narrateCountAnswer(rc: number): string {
  return `The count is ${narrateTc(rc)}.`;
}

export function narrateInsuranceOffer(): string {
  return 'Insurance offered.';
}

export function narrateShuffle(): string {
  return 'Shuffling.';
}

function narrateHandTotalPhrase(cards: [Card, Card]): string {
  if (isPair(cards)) {
    const rank = pairRank(cards)!;
    return `a pair of ${RANK_PLURAL[rank]}`;
  }
  const hv = handValue(cards);
  return narrateTotal(hv.total, hv.soft);
}

export function narrateFlashcardPrompt(cards: [Card, Card], up: Rank): string {
  return `You have ${narrateHandTotalPhrase(cards)}. ${narrateDealerUp(up)}`;
}

export function narrateQuizPrompt(cards: [Card, Card] | null, up: Rank, tc: number): string {
  if (cards === null) {
    return `${narrateDealerUp(up)} ${narrateInsuranceOffer()} True count ${narrateTc(tc)}.`;
  }
  return `You have ${narrateHandTotalPhrase(cards)}. ${narrateDealerUp(up)} True count ${narrateTc(tc)}.`;
}

/** Singular/plural wording pair for a countable noun. */
function pluralize(n: number, singular: string, plural: string): string {
  return n === 1 ? singular : plural;
}

const MISTAKE_SUMMARY_ORDER: Exclude<MistakeClass, 'correct'>[] = [
  'basic-error',
  'missed-deviation',
  'phantom-deviation',
  'wrong-anyway',
];

const MISTAKE_SUMMARY_LABELS: Record<Exclude<MistakeClass, 'correct'>, { singular: string; plural: string }> = {
  'basic-error': { singular: 'basic error', plural: 'basic errors' },
  'missed-deviation': { singular: 'missed deviation', plural: 'missed deviations' },
  'phantom-deviation': { singular: 'phantom deviation', plural: 'phantom deviations' },
  'wrong-anyway': { singular: 'wrong-anyway play', plural: 'wrong-anyway plays' },
};

/**
 * Speak a one-line session summary: total decisions plus every nonzero
 * mistake tally, in a fixed order, with correct singular/plural wording.
 * "This session" refers to the currently loaded stats blob (reset via the
 * Stats screen's "Reset stats" action) — there is no separate live-session
 * mistake breakdown in `Stats`.
 */
export function narrateStatsSummary(stats: Stats): string {
  const decisions = Object.values(stats.mistakes).reduce((sum, n) => sum + n, 0);
  const decisionsPhrase = `${decisions} ${pluralize(decisions, 'decision', 'decisions')}`;

  const mistakeParts = MISTAKE_SUMMARY_ORDER.filter((cls) => stats.mistakes[cls] > 0).map((cls) => {
    const n = stats.mistakes[cls];
    const label = MISTAKE_SUMMARY_LABELS[cls];
    return `${n} ${pluralize(n, label.singular, label.plural)}`;
  });

  if (mistakeParts.length === 0) {
    return `This session: ${decisionsPhrase}, no mistakes.`;
  }
  return `This session: ${decisionsPhrase}, ${mistakeParts.join(', ')}.`;
}
