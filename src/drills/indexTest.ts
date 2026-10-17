/**
 * B3: the Index test. The quiz shows a hand and asks for the index -- the
 * true count at which the play changes -- rather than showing a count and
 * asking for the play. Answers are signed integers; an item is graded against
 * the PUBLISHED index (the count the play changes AT), which for an `lte`
 * entry is one above the stored threshold: 13 v 2 is stored "hit at TC <= -2"
 * and published "stand at TC >= -1".
 */
import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import type { Action, Deviation, DeviationId } from '../engine/deviations';
import type { StrategyRules } from '../engine/ruleset';
import { correctPlay, insuranceCorrect } from '../engine/strategy';
import type { GradedEvent } from '../engine/grade';
import { actionCategory } from '../engine/grade';
import { makeHardHand } from './buildHand';
import { quizIndexSet, entryCtx, makeSoftHand, makePair10Cards } from './deviationQuiz';
import { srWeight } from './spacedRepetition';
import type { SrDeck } from './spacedRepetition';
import { weightedIndex } from './weightedDraw';
import { signed } from './signed';
import { publishedIndex } from './indexDisplay';
import { narrateFlashcardPrompt, narrateDealerUp, narrateInsuranceOffer, narrateReason } from '../audio/narrate';
import { speakableCount } from '../audio/voiceNumber';

export interface IndexTestItem {
  deviationId: DeviationId;
  cards: [Card, Card] | null; // null for insurance
  up: Rank;
  index: number;
  playAt: Action | 'take-insurance';
  playBelow: Action | 'decline-insurance';
  label: string;
}

type Play = IndexTestItem['playAt'] | IndexTestItem['playBelow'];

const PLAY: Record<Play, string> = {
  hit: 'hit',
  stand: 'stand',
  double: 'double',
  split: 'split',
  surrender: 'surrender',
  'take-insurance': 'take insurance',
  'decline-insurance': 'decline',
};

// R6: one published-index formatter for every surface (drills/indexDisplay.ts).
export { publishedIndex } from './indexDisplay';

/** The indexes the Index test asks: the quiz's set, active entries only. */
export function indexTestSet(rules: StrategyRules): Deviation[] {
  return quizIndexSet(rules).filter((d) => d.active);
}

function cardsFor(dev: Deviation, rng: () => number): [Card, Card] {
  if (dev.kind === 'pair10') return makePair10Cards();
  if (dev.kind === 'soft') return makeSoftHand(dev.total!);
  const cards = makeHardHand(dev.total!, rng);
  if (!cards) throw new Error(`indexTestItemFor: cannot construct hard total ${dev.total}`);
  return cards;
}

export function indexTestItemFor(dev: Deviation, rules: StrategyRules, rng: () => number): IndexTestItem {
  const index = publishedIndex(dev);
  if (dev.kind === 'insurance') {
    // The published insurance index is the first count the engine takes it at.
    if (!insuranceCorrect(index, rules) || insuranceCorrect(index - 1, rules)) {
      throw new Error(`indexTestItemFor: insurance does not change at TC ${index}`);
    }
    return { deviationId: dev.id, cards: null, up: 'A', index, playAt: 'take-insurance', playBelow: 'decline-insurance', label: dev.label };
  }
  const cards = cardsFor(dev, rng);
  const ctx = entryCtx(dev);
  return {
    deviationId: dev.id,
    cards,
    up: dev.up!,
    index,
    playAt: correctPlay(cards, dev.up!, index, ctx, rules).action,
    playBelow: correctPlay(cards, dev.up!, index - 1, ctx, rules).action,
    label: dev.label,
  };
}

/**
 * An SR-weighted pick over the Index test set -- drawQuizItem's no-filter
 * weighting -- that never re-asks a `recent` item (newest last) while another
 * is left (#24, R8). A just-missed card is box 0 and due now, so it used to
 * outweigh every learned card and come straight back with its answer still on
 * the strip. The last two are avoided when the set allows; the last one always.
 */
export function drawIndexTestItem(
  seed: number,
  rules: StrategyRules,
  srDeck: SrDeck = {},
  now = 0,
  recent: readonly DeviationId[] = [],
): IndexTestItem {
  const rng = mulberry32(seed);
  const set = indexTestSet(rules);
  const base = set.map((d) => srWeight(srDeck[d.id], now));
  const avoiding = (avoid: readonly DeviationId[]) => base.map((w, i) => (avoid.includes(set[i]!.id) ? 0 : w));
  const options = [avoiding(recent.slice(-2)), avoiding(recent.slice(-1)), base];
  const weights = options.find((ws) => ws.some((w) => w > 0))!;
  return indexTestItemFor(set[weightedIndex(rng, weights)]!, rules, rng);
}

/**
 * The Index test's in-session memory (#24, R8): the items answered, newest
 * last, and the ones missed whose answer has since been shown on the strip
 * (or spoken). A correct answer to a shown item is a copy, not a recall.
 */
export interface IndexTestSession {
  recent: DeviationId[];
  shown: DeviationId[];
}

export const NEW_INDEX_SESSION: IndexTestSession = { recent: [], shown: [] };

export function afterIndexAnswer(session: IndexTestSession, id: DeviationId, correct: boolean): IndexTestSession {
  const recent = [...session.recent, id].slice(-2);
  const others = session.shown.filter((s) => s !== id);
  return { recent, shown: correct ? others : [...others, id] };
}

/** True when this item's answer was shown after a miss this session and not yet recalled. */
export function answerWasShown(session: IndexTestSession, id: DeviationId): boolean {
  return session.shown.includes(id);
}

export function gradeIndexTest(item: IndexTestItem, answer: number): boolean {
  return answer === item.index;
}

/** The question names the play, never the number. */
export function indexTestPrompt(item: IndexTestItem): string {
  return item.cards === null ? 'Insurance index?' : `Index to ${PLAY[item.playAt]}?`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Always phrased from the index upward: "Stand at TC ≥ −1; hit below". */
export function indexTestPlayLine(item: IndexTestItem): string {
  return `${cap(PLAY[item.playAt])} at TC ≥ ${signed(item.index)}; ${PLAY[item.playBelow]} below`;
}

export function narrateIndexTestPrompt(item: IndexTestItem): string {
  if (item.cards === null) {
    return `${narrateDealerUp('A')} ${narrateInsuranceOffer()} What is the insurance index?`;
  }
  return `${narrateFlashcardPrompt(item.cards, item.up)} ${indexTestPrompt(item)}`;
}

export function narrateIndexTestCorrection(item: IndexTestItem, correct: boolean): string {
  return `${correct ? 'Correct.' : 'Wrong.'} The index is ${speakableCount(item.index)}. ${narrateReason(indexTestPlayLine(item))}`;
}

/** An index event: tallied per index, never against a chart cell; no latency, no price. */
export function buildIndexTestEvent(item: IndexTestItem, answer: number): GradedEvent {
  const correct = gradeIndexTest(item, answer);
  const insurance = item.cards === null;
  const category = insurance
    ? 'insurance'
    : item.playAt === 'surrender' || item.playBelow === 'surrender'
      ? 'surrender'
      : actionCategory(item.cards!, item.playAt as Action);
  return {
    kind: insurance ? 'insurance' : 'action',
    source: 'quiz',
    category,
    correct,
    classification: correct ? 'correct' : 'missed-deviation',
    taken: String(answer),
    expected: String(item.index),
    reason: item.label,
    deviationId: item.deviationId,
    indexOnly: true, // R9
    tc: item.index,
    hand: insurance ? 'dealer A' : `${item.cards!.map((c) => c.rank).join(',')} v ${item.up}`,
  };
}
