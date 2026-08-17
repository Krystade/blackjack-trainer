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

/** Card-detail narration level: see `AudioSettings.cardDetail` in store/types.ts. */
export type CardDetail = 'full' | 'rank' | 'face';

// Every rank worth ten in Hi-Lo — 10/J/Q/K all carry the identical -1 tag,
// so 'face' detail collapses them all to "ten" (what a counter subvocalises).
const TEN_VALUE_RANKS: ReadonlySet<Rank> = new Set(['10', 'J', 'Q', 'K']);

export function narrateCard(card: Card, detail: CardDetail = 'full'): string {
  if (detail === 'full') {
    return `${narrateRank(card.rank)} of ${SUIT_NAMES[card.suit]}`;
  }
  if (detail === 'face' && TEN_VALUE_RANKS.has(card.rank)) {
    return 'ten';
  }
  return narrateRank(card.rank);
}

export function narrateCards(cards: Card[], detail: CardDetail = 'full'): string {
  return cards.map((card) => narrateCard(card, detail)).join(', ');
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

/** Spoken when the player wongs out (sits the round out). R5. */
export function narrateSitOut(): string {
  return 'Sitting out.';
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
  return `Wrong. ${narrateReason(event.reason)} Correct play was ${narrateAction(event.expected as Action)}. True count was ${narrateTc(event.tc)}.`;
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

/** How a two-card hand is announced: see `AudioSettings.handStyle` in
 * store/types.ts. */
export type HandStyle = 'cards' | 'total';

/**
 * The spoken form of a drill hand, for both prompt builders.
 *
 * `'cards'` (the default) speaks SOFT non-pair hands card by card — "ace,
 * three" rather than "soft fourteen". A soft total alone forces the learner
 * to re-derive the composition that actually decides the play (A-3 vs A-7
 * are different rows of the chart), and "soft fourteen" is the exact phrase
 * beginners mishear as a hard total. Hard hands and pairs deliberately do
 * NOT change:
 *  - a hard hand's play depends only on its total, so "ten, six" is more
 *    syllables for no teaching value over "sixteen";
 *  - a pair already names its own composition ("a pair of eights"), and the
 *    pair-splitting row is the one being drilled.
 * Suits are never spoken here regardless of `cardDetail` — composition, not
 * suit, is the whole point of this phrasing, and lowercase bare rank words
 * ("ace", "three") are also what the clip manifests key on (see clips.ts's
 * comma-split cascade), so this phrasing stays clip-playable.
 *
 * `'total'` reproduces the pre-existing behavior exactly.
 *
 * Pure like the rest of this module: the caller passes the style down from
 * `AudioSettings.handStyle` — narrate.ts never reads the store itself.
 */
export function narrateHandPhrase(cards: [Card, Card], style: HandStyle = 'cards'): string {
  if (style === 'cards' && !isPair(cards) && handValue(cards).soft) {
    return cards.map((card) => narrateRank(card.rank)).join(', ');
  }
  return narrateHandTotalPhrase(cards);
}

export function narrateFlashcardPrompt(
  cards: [Card, Card],
  up: Rank,
  handStyle: HandStyle = 'cards',
): string {
  return `You have ${narrateHandPhrase(cards, handStyle)}. ${narrateDealerUp(up)}`;
}

export function narrateQuizPrompt(
  cards: [Card, Card] | null,
  up: Rank,
  tc: number,
  handStyle: HandStyle = 'cards',
): string {
  if (cards === null) {
    return `${narrateDealerUp(up)} ${narrateInsuranceOffer()} True count ${narrateTc(tc)}.`;
  }
  return `You have ${narrateHandPhrase(cards, handStyle)}. ${narrateDealerUp(up)} True count ${narrateTc(tc)}.`;
}

/**
 * Turn a `GradedEvent.reason` into something a voice can actually say.
 *
 * Reasons arrive in two shapes, and one of them is hostile to speech:
 *  - basic-strategy prose from strategy.ts — "Basic hit vs dealer 9";
 *  - Illustrious-18 INDEX LABELS from deviations.ts — "16 v 10: stand at
 *    TC ≥ 0", "13 v 2: hit at TC ≤ −1" (that is U+2212, not a hyphen),
 *    "10,10 v 5: split at TC ≥ +5", "16 v 9: stand at TC ≥ +4 (H17)".
 *
 * Those labels are written to be READ, in a table, by someone who already
 * knows the notation. Spoken raw they degrade to mush ("sixteen vee ten
 * colon..."), and — the reason this matters more than cosmetics — the clip
 * cascade in clips.ts keys on words, so a symbol-bearing string can never
 * match a pre-rendered Bella clip and silently falls back to robot-voice
 * live TTS. That happens at exactly the moment the learner most needs to
 * understand what they got wrong, and in eyes-free/driving use the spoken
 * correction is the ONLY channel they have. See docs/BACKLOG.md D2.
 *
 * Implemented as an ordered rewrite rather than a parser: the two shapes
 * share no grammar, new index labels get added by hand, and a rewrite that
 * meets an unfamiliar phrase degrades to "mostly right" instead of throwing.
 * Order matters and is load-bearing — see the comment on each step.
 */
export function narrateReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return '';

  // Strip terminal punctuation up front so step 9 can add exactly one back
  // without having to reason about what was already there.
  let s = trimmed.replace(/[.\s]+$/, '');

  // 1. Dealer-rule suffixes FIRST, while they are still bare tokens. Left
  //    alone they would reach the digit pass below and be spoken as
  //    "H seventeen".
  s = s.replace(/\s*\(H17\)/g, ', when the dealer hits soft seventeen');
  s = s.replace(/\s*\(S17\)/g, ', when the dealer stands soft seventeen');

  // 2. A pair matchup ("10,10 v 5") before the comma can be mistaken for a
  //    list separator. Backreference so only a genuine PAIR matches.
  s = s.replace(/^(10|[AJQK2-9]),\1\b/, (_match, rank: Rank) => `a pair of ${RANK_PLURAL[rank]}`);

  // 3. Both matchup spellings ("v" in index labels, "vs" in basic reasons).
  s = s.replace(/\bvs?\b/g, 'versus');

  // 4. A dealer ace is the letter A in both shapes; spoken, it must not be
  //    the article "a". Anchored to "versus" so the "A pair of..." produced
  //    by step 2 is untouched.
  s = s.replace(/\bversus A\b/g, 'versus ace');

  // 5. Thresholds, before the generic digit pass, since these carry a sign
  //    and a comparison direction that the digit pass would destroy.
  //    Accepts BOTH the unicode minus deviations.ts actually writes and an
  //    ASCII hyphen, so a hand-typed label is never silently inverted.
  s = s.replace(/([≥≤])\s*([+−-]?\d+)/g, (_match, cmp: string, num: string) => {
    const value = Number(num.replace('−', '-').replace('+', ''));
    return `${narrateTc(value)} or ${cmp === '≥' ? 'higher' : 'lower'}`;
  });

  // 6. The abbreviation itself, after the thresholds have consumed their
  //    operands.
  s = s.replace(/\bTC\b/g, 'true count');

  // 7. Every remaining bare integer is a hand total or a dealer upcard.
  s = s.replace(/\b\d+\b/g, (match) => numberWord(Number(match)));

  // 8. Sentence case on the first letter, whatever it turned out to be.
  s = s.replace(/^([a-z])/, (c) => c.toUpperCase());

  // 9. Exactly one terminal stop, so the utterance lands instead of trailing.
  return `${s}.`;
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
