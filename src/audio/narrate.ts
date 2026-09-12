import type { Card, Rank, Suit } from '../engine/cards';
import type { Action } from '../engine/deviations';
import type { GradedEvent, MistakeClass } from '../engine/grade';
import { handValue, isPair, pairRank } from '../engine/hand';
import type { Stats } from '../store/types';
import { speakableCount } from './voiceNumber';

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

/**
 * TWO sentences, not one clause with a comma -- and that is a clip decision,
 * not a stylistic one.
 *
 * A clip is a sentence: clips.ts splits on terminal punctuation and looks each
 * piece up exactly. "Player two hits, ten of clubs." is ONE sentence, so
 * covering it would take a clip for every seat x action x card -- thirteen
 * hundred files a voice. Split, it takes twenty-five plus fifty-two, and the
 * table's most frequent utterance keeps the recorded voice instead of dropping
 * to live TTS on every bot turn (which, in a car, also drops the head unit:
 * live speech opens no media element -- see audio/mediaSession.ts).
 */
export function narrateBotAction(seatLabel: string, action: Action, card?: Card): string {
  const seat = narrateSeat(seatLabel);
  const verb = ACTION_VERB[action];
  if (card) {
    return `${seat} ${verb}. ${capitalize(narrateCard(card))}.`;
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

/**
 * The opener alone distinguishes a shot-clock timeout from a wrong play, and
 * that is a deliberate minimum: it is ONE extra sentence, so the clip cascade
 * (audio/clips.ts splits on terminal punctuation and looks each piece up) covers
 * the whole timeout correction with a single new file per voice. Everything
 * after it is the same reason/expected/count the wrong-play correction already
 * says, and already has clips for.
 *
 * "Wrong." would not be false here, but it is the wrong lesson: the learner did
 * not pick the wrong play, they did not pick one, and eyes-free that distinction
 * is only available in the words.
 */
export function narrateCorrection(event: GradedEvent): string {
  if (event.correct) {
    return 'Correct.';
  }
  const opener = event.classification === 'timeout' ? 'Out of time.' : 'Wrong.';
  return `${opener} ${narrateReason(event.reason)} Correct play was ${narrateAction(event.expected as Action)}. True count was ${narrateTc(event.tc)}.`;
}

export function narrateCountPrompt(): string {
  return "What's the running count?";
}

export function narrateCountAnswer(rc: number): string {
  return `The count is ${narrateTc(rc)}.`;
}

/* ---------------------------------------------------------------- */
/* VOICE CONVERSATION (D2, docs/BACKLOG.md)                          */
/*                                                                   */
/* Every line the app says WHILE LISTENING -- the read-back it asks  */
/* you to confirm, the refusals, the "did you have it?" -- used to   */
/* be composed inline in CountDrillView, TrueCountDrillView and      */
/* Table, and so reached no clip. Clip segmentation is all-or-       */
/* nothing per utterance, so each of those fell to live TTS, and in  */
/* a car live speech opens no media element (see audio/clips.ts and  */
/* audio/mediaSession.ts) -- losing the head unit at exactly the     */
/* moment the app is asking a question and waiting for an answer.    */
/*                                                                   */
/* The backlog entry said deriving these meant importing a `.tsx`    */
/* into build tooling. That was true only because the SENTENCES      */
/* lived in the views; the one moving part, `speakableCount`, was    */
/* already in audio/voiceNumber.ts. Moving the sentences here is the */
/* whole fix -- scripts/spokenPhrases.ts derives them from this      */
/* module like everything else, and clipCoverage.test.ts holds them  */
/* against the shipped files.                                        */
/* ---------------------------------------------------------------- */

/** The count read back for confirmation: "minus 3. Correct?" */
export function narrateReadback(value: number): string {
  return `${speakableCount(value)}. Correct?`;
}

/**
 * Countdown mode asks for a Hi-Lo TAG, so a number outside -1..1 is refused.
 *
 * THREE SENTENCES, not one, and for the reason `narrateBotAction` is two: the
 * number is the only moving part, and as one sentence ("plus 3 is not a tag.")
 * it would need its own clip at every value the parser can return -- forty-odd
 * files a voice, for a line that only plays when you misspeak. Split at the
 * number, the first sentence is the SAME segment the read-back already needs
 * and the refusal costs exactly one new clip.
 */
export function narrateNotATag(value: number): string {
  return `${speakableCount(value)}. Not a tag. ${COUNTDOWN_TAG_PROMPT}`;
}

/** The refusal's middle sentence, as its own segment for the clip derivation. */
export const NOT_A_TAG = 'Not a tag.';

/**
 * The fixed conversational lines, as constants rather than inline literals.
 *
 * Not because a literal is unclear where it sits, but because a clip library
 * cannot be derived from strings scattered across three view files -- and a
 * line that drifts here without the clips being regenerated silently drops to
 * live TTS with no error anywhere. `scripts/spokenPhrases.test.ts` fails when
 * that happens, and it can only see what this module exports.
 */
export const COUNTDOWN_TAG_PROMPT = 'Plus one, zero, or minus one?';
export const CHECKPOINT_PROMPT = 'Running count so far?';
export const NO_TAG_YET = `I have no tag yet. ${COUNTDOWN_TAG_PROMPT}`;
export const NO_COUNT_YET = 'I have no count yet. What is it?';
export const NO_COUNT_YET_CHECKPOINT = `I have no count yet. ${CHECKPOINT_PROMPT}`;
export const NO_TRUE_COUNT_YET = 'I have no true count yet. What is it?';
export const DID_YOU_HAVE_IT = 'Did you have it?';
export const DECLINED_ANOTHER = 'Okay. Say yes when you want another.';
export const DECLINED_NEXT = 'Okay. Say yes when you want the next one.';
export const SAY_YES_AGAIN = 'Say yes to go again.';
export const SAY_YES_NEXT = 'Say yes for the next one.';

/** Every fixed conversational line, for the clip derivation to walk. */
export const VOICE_CONVERSATION_LINES: readonly string[] = [
  COUNTDOWN_TAG_PROMPT,
  NOT_A_TAG,
  CHECKPOINT_PROMPT,
  NO_TAG_YET,
  NO_COUNT_YET,
  NO_COUNT_YET_CHECKPOINT,
  NO_TRUE_COUNT_YET,
  DID_YOU_HAVE_IT,
  DECLINED_ANOTHER,
  DECLINED_NEXT,
  SAY_YES_AGAIN,
  SAY_YES_NEXT,
];

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
  //    NOT ^-anchored: the deviation quiz wraps labels in prose ("No index
  //    applies here — basic strategy. (near 10,10 v 5: split at ...)"), and an
  //    anchored rewrite left those to the digit pass, which said "ten,ten".
  s = s.replace(
    /(?<![\w,])(10|[AJQK2-9]),\1(?![\w,])/g,
    (_match, rank: Rank) => `a pair of ${RANK_PLURAL[rank]}`,
  );

  // 3. Both matchup spellings ("v" in index labels, "vs" in basic reasons).
  s = s.replace(/\bvs?\b/g, 'versus');

  // 4. Upcard LETTERS -> words. Two shapes reach here: the index label's
  //    "10 v A:" (now "versus A") and basic strategy's "vs dealer A" (now
  //    "versus dealer A"). Matching only the first left every basic reason
  //    against a face card speaking the bare letter — "cue", "jay", "kay" —
  //    and worse, "dealer A." is read as the article, so the upcard dropped
  //    out of the sentence entirely. That is ~5 of 13 upcards, on every table
  //    hand. Anchored on the preceding "versus" so the "A pair of..." from
  //    step 2 is untouched, and so the already-expanded H17/S17 clauses are
  //    out of reach.
  s = s.replace(
    /\bversus (dealer )?([AJQK])\b/g,
    (_match, dealer: string | undefined, rank: Rank) =>
      `versus ${dealer ?? ''}${RANK_NAMES[rank]}`,
  );

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
  'timeout',
];

const MISTAKE_SUMMARY_LABELS: Record<Exclude<MistakeClass, 'correct'>, { singular: string; plural: string }> = {
  'basic-error': { singular: 'basic error', plural: 'basic errors' },
  'missed-deviation': { singular: 'missed deviation', plural: 'missed deviations' },
  'phantom-deviation': { singular: 'phantom deviation', plural: 'phantom deviations' },
  'wrong-anyway': { singular: 'wrong-anyway play', plural: 'wrong-anyway plays' },
  timeout: { singular: 'time-out', plural: 'time-outs' },
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
