import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import type { Action, DeviationId } from '../engine/deviations';
import type { EventSource, GradedEvent, MistakeClass } from '../engine/grade';
import type { StrategyRules } from '../engine/ruleset';
import { basicPlay, correctPlay } from '../engine/strategy';
import type { PlayContext } from '../engine/strategy';
import type { Settings } from '../store/types';
import { pickComposition } from './buildHand';
import { generateAllCells } from './flashcards';
import { cellCategory } from './gradeAnswer';
import { trackedElapsedMs } from './idleAnswer';
import { drillLegalActions } from './legalActions';
import { weightedIndex } from './weightedDraw';

/**
 * #15 / #19: the yes/no Speed drill. One question per mode, two buttons.
 *
 * - surrender: "Surrender?" -- yes when the chart surrenders (basic strategy,
 *   no count shown). Asked only where the drills offer surrender at all
 *   (drillLegalActions: late surrender on; soft hands and most pairs never).
 * - double: "Double?" -- yes when the chart doubles. Every two-card hand can
 *   double, so every cell is askable.
 * - split: "Split?" -- yes when the chart splits. Pairs only.
 * - deviation: "Deviation here?" -- a true count is shown; yes when the play
 *   at that count (correctPlay: the I18, plus the Fab 4 when the rules carry
 *   them) differs from basic strategy. Asked only on cells that carry an
 *   index in these rules, at counts from TC_MIN to TC_MAX.
 *
 * The draw is balanced: a fair coin picks "yes" or "no", then a question is
 * drawn from that side only (when one side is empty, the other is used). Pure
 * and seeded: no Math.random, no clock.
 */
export type SpeedMode = NonNullable<Settings['drill']['speedMode']>;

export const SPEED_MODES: readonly SpeedMode[] = ['surrender', 'deviation', 'double', 'split'];

export const SPEED_QUESTION: Record<SpeedMode, string> = {
  surrender: 'Surrender?',
  deviation: 'Deviation here?',
  double: 'Double?',
  split: 'Split?',
};

export const SPEED_MODE_LABEL: Record<SpeedMode, string> = {
  surrender: 'Surrender',
  deviation: 'Deviation',
  double: 'Double',
  split: 'Split',
};

/**
 * The source the events are recorded under. EventSource has no 'speed' and
 * adding one would change the persisted Stats shape (bySource), so a Speed
 * answer counts as a flashcard: a chart cell asked on its own.
 */
export const SPEED_EVENT_SOURCE: EventSource = 'flashcard';

export const TC_MIN = -4;
export const TC_MAX = 6;

const CTX: PlayContext = { canDouble: true, canSplit: true, canSurrender: true };

export function speedModeOf(drill: Pick<Settings['drill'], 'speedMode'>): SpeedMode {
  return drill.speedMode && SPEED_MODES.includes(drill.speedMode) ? drill.speedMode : 'surrender';
}

const CELLS = new Map(generateAllCells().map((c) => [c.id, c]));

export interface SpeedJudgement {
  /** The right answer to the mode's question. */
  answer: boolean;
  /** The play at this count (the chart play when no count is asked). */
  play: Action;
  /** Basic strategy's play. */
  basic: Action;
  deviationId?: DeviationId;
  /** The index label when an index decides the play here. */
  indexLabel?: string;
}

/** The answer to `mode`'s question for this hand. `tc` matters only for
 *  'deviation'; the other modes ask the chart. */
export function judgeSpeed(mode: SpeedMode, cards: Card[], up: Rank, tc: number, rules: StrategyRules): SpeedJudgement {
  const basic = basicPlay(cards, up, CTX, rules);
  if (mode !== 'deviation') {
    const want: Action = mode === 'surrender' ? 'surrender' : mode === 'double' ? 'double' : 'split';
    return { answer: basic.action === want, play: basic.action, basic: basic.action };
  }
  const withCount = correctPlay(cards, up, tc, CTX, rules);
  const deviates = withCount.action !== basic.action;
  return {
    answer: deviates,
    play: withCount.action,
    basic: basic.action,
    ...(withCount.deviationId ? { deviationId: withCount.deviationId, indexLabel: withCount.reason } : {}),
  };
}

/** Can `mode`'s question be asked on this cell at all? */
export function isAskable(mode: SpeedMode, cellId: string, rules: StrategyRules): boolean {
  const cell = CELLS.get(cellId);
  if (!cell) return false;
  if (mode === 'split') return cellId.startsWith('pair-');
  if (mode === 'surrender') return drillLegalActions(cell.cards, rules, cell.up).includes('surrender');
  if (mode === 'deviation') {
    // Askable when some count in range flips the play: a cell with an index
    // in these rules (and none other).
    for (let tc = TC_MIN; tc <= TC_MAX; tc++) if (judgeSpeed(mode, cell.cards, cell.up, tc, rules).answer) return true;
    return false;
  }
  return true;
}

/** One question the drill could ask: a cell, and the count shown (null: none). */
export interface SpeedCandidate {
  cellId: string;
  tc: number | null;
  answer: boolean;
}

/** Every question `mode` can ask on `deckIds`, each with its answer. */
export function speedCandidates(mode: SpeedMode, deckIds: readonly string[], rules: StrategyRules): SpeedCandidate[] {
  const out: SpeedCandidate[] = [];
  for (const id of deckIds) {
    if (!isAskable(mode, id, rules)) continue;
    const cell = CELLS.get(id)!;
    if (mode === 'deviation') {
      for (let tc = TC_MIN; tc <= TC_MAX; tc++) {
        out.push({ cellId: id, tc, answer: judgeSpeed(mode, cell.cards, cell.up, tc, rules).answer });
      }
    } else {
      out.push({ cellId: id, tc: null, answer: judgeSpeed(mode, cell.cards, cell.up, 0, rules).answer });
    }
  }
  return out;
}

export interface SpeedQuestion extends SpeedJudgement {
  mode: SpeedMode;
  cellId: string;
  cards: Card[];
  up: Rank;
  tc: number | null;
}

/**
 * Draw the next question, or null when `mode` has nothing to ask in this deck.
 *
 * A coin picks the side; within it each CELL is equally likely (times its
 * deck weight, e.g. a Custom tier), then each count of that cell on that
 * side. `previousCellId` is avoided when the side has another cell.
 */
export function drawSpeedQuestion(
  mode: SpeedMode,
  deck: { ids: readonly string[]; weights: ReadonlyMap<string, number> | null },
  rules: StrategyRules,
  seed: number,
  previousCellId: string | null = null,
): SpeedQuestion | null {
  const all = speedCandidates(mode, deck.ids, rules);
  if (all.length === 0) return null;
  const rng = mulberry32(seed);
  const yes = all.filter((c) => c.answer);
  const no = all.filter((c) => !c.answer);
  const wantYes = rng() < 0.5;
  let side = wantYes ? yes : no;
  if (side.length === 0) side = wantYes ? no : yes;

  let cellIds = [...new Set(side.map((c) => c.cellId))];
  if (previousCellId && cellIds.length > 1) cellIds = cellIds.filter((id) => id !== previousCellId);
  const weights = cellIds.map((id) => (deck.weights ? (deck.weights.get(id) ?? 0) : 1));
  const cellId = cellIds[weightedIndex(rng, weights.some((w) => w > 0) ? weights : weights.map(() => 1))]!;
  const options = side.filter((c) => c.cellId === cellId);
  const pick = options[Math.floor(rng() * options.length)] ?? options[0]!;

  const cell = CELLS.get(cellId)!;
  // #18: a hard cell is dealt as any of its two-card compositions.
  const total = Number(cellId.split('-')[1]);
  const cards: Card[] = cellId.startsWith('hard-') ? (pickComposition(total, rng) ?? cell.cards) : cell.cards;
  const judged = judgeSpeed(mode, cards, cell.up, pick.tc ?? 0, rules);
  return { mode, cellId, cards, up: cell.up, tc: pick.tc, ...judged };
}

const ACTION_WORD: Record<Action, string> = {
  hit: 'Hit',
  stand: 'Stand',
  double: 'Double',
  split: 'Split',
  surrender: 'Surrender',
};

export function yesNo(answer: boolean): 'yes' | 'no' {
  return answer ? 'yes' : 'no';
}

/** "Chart: Surrender" or, for a deviation question, the index or "Basic: Hit". */
export function speedReason(q: SpeedQuestion): string {
  if (q.mode === 'deviation') {
    if (q.indexLabel && q.answer) return `${q.indexLabel} (basic: ${ACTION_WORD[q.basic]})`;
    return `Play ${ACTION_WORD[q.play]}, the chart play`;
  }
  return `Chart: ${ACTION_WORD[q.play]}`;
}

function classify(q: SpeedQuestion, correct: boolean): MistakeClass {
  if (correct) return 'correct';
  if (q.mode !== 'deviation') return 'basic-error';
  return q.answer ? 'missed-deviation' : 'phantom-deviation';
}

/**
 * The GradedEvent for an answer. Keyed by the cell id as `hand`, like
 * flashcards and mastery, so per-cell stats (B3) and accuracy pick it up.
 * Not priced (no evCost): "yes/no" is not one of the five plays.
 */
export function buildSpeedEvent(q: SpeedQuestion, saidYes: boolean, elapsedMs: number, now: number): GradedEvent {
  const correct = saidYes === q.answer;
  const tracked = trackedElapsedMs(elapsedMs, false);
  return {
    kind: 'action',
    source: SPEED_EVENT_SOURCE,
    category: cellCategory(q.cellId, q.play),
    correct,
    classification: classify(q, correct),
    taken: yesNo(saidYes),
    expected: yesNo(q.answer),
    reason: speedReason(q),
    ...(q.deviationId ? { deviationId: q.deviationId } : {}),
    tc: q.tc ?? 0,
    hand: q.cellId,
    ...(tracked === undefined ? {} : { elapsedMs: tracked }),
    at: new Date(now).toISOString(),
  };
}

/** Median of the timed answers, or null with none. */
export function medianMs(times: readonly number[]): number | null {
  if (times.length === 0) return null;
  const s = [...times].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The keyboard: Y / right arrow is yes, N / left arrow is no. */
export function speedKeyAnswer(key: string): boolean | null {
  if (key === 'y' || key === 'Y' || key === 'ArrowRight') return true;
  if (key === 'n' || key === 'N' || key === 'ArrowLeft') return false;
  return null;
}
