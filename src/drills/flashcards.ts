import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { correctPlay } from '../engine/strategy';
import type { PlayContext } from '../engine/strategy';
import { FULL_CTX, maybeFallback } from './fallbackHand';
import { drawCountTc } from './withCount';
import type { Action } from '../engine/deviations';
import { DEFAULT_RULES } from '../engine/ruleset';
import type { StrategyRules } from '../engine/ruleset';
import { makeHardHand } from './buildHand';
import { weightedIndex } from './weightedDraw';
import { srWeight } from './spacedRepetition';
import { confusabilityWeight } from './confusability';
import type { SrDeck } from './spacedRepetition';
import { filterCellsByScopes } from './handScope';
import type { HandScope } from './handScope';

export interface Flashcard {
  /** Two cards, or (#27) three for a fallback hand. */
  cards: Card[];
  up: Rank;
  correct: Action;
  cellId: string;
  /** #27: what the hand may do. Absent = everything (a fresh two-card hand). */
  ctx?: PlayContext;
  /** #53: the true count shown and graded at. Absent = no count (TC 0). */
  tc?: number;
}

/** The ctx a flashcard is graded and offered under. */
export function flashCtx(card: Pick<Flashcard, 'ctx'>): PlayContext {
  return card.ctx ?? FULL_CTX;
}

/** #27 / #53: optional extras for a draw. All off = the draw is unchanged. */
export interface FlashOptions {
  fallbacks?: boolean;
  withCount?: boolean;
  /**
   * E2 (drills/learningRedeal.ts): a missed cell whose re-deal is due. It is
   * dealt instead of the weighted draw, when it is in the deck.
   */
  redeal?: string;
  /** E2: missed cells still waiting for their re-deal, kept out of the draw
   * unless nothing else is left. */
  exclude?: ReadonlySet<string>;
}

/**
 * Cell ID format: "hard-16-v-9", "soft-18-v-A", "pair-8-v-10"
 */
export interface Cell {
  id: string;
  cards: [Card, Card];
  up: Rank;
}

/**
 * Generate all possible flashcard cells.
 * Categories:
 * - hard: hard totals 5-19, built from two non-pair non-ace cards
 *   (4 and 20 are excluded: only constructible as pairs)
 * - soft: soft hands A+x (A with another card making soft totals 13-20)
 * - pairs: all pair ranks (A,2,3,4,5,6,7,8,9,10)
 * Universe size: (15 hard + 8 soft + 10 pair) x 10 upcards = 330 cells.
 */
export function generateAllCells(): Cell[] {
  const cells: Cell[] = [];
  const upcards: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

  // Helper to build a cell
  function addCell(id: string, cards: [Card, Card], up: Rank) {
    cells.push({ id, cards, up });
  }

  // Hard totals: 5-19 (aces excluded — A+x is always soft; pairs excluded).
  for (const up of upcards) {
    for (let total = 5; total <= 19; total++) {
      const hand = makeHardHand(total);
      if (hand) {
        addCell(`hard-${total}-v-${up}`, hand, up);
      }
    }
  }

  // Soft totals: A+x makes soft 13-20
  // A+2 = soft 13, A+3 = soft 14, ..., A+9 = soft 20
  for (const up of upcards) {
    for (let softTotal = 13; softTotal <= 20; softTotal++) {
      // A counts as 11, so the other card must be softTotal - 11
      const otherValue = softTotal - 11;
      if (otherValue >= 2 && otherValue <= 9) {
        // Find a card with that value
        const otherRank = otherValue === 10 ? '10' : String(otherValue) as Rank;
        addCell(
          `soft-${softTotal}-v-${up}`,
          [{ rank: 'A', suit: 's' }, { rank: otherRank, suit: 's' }],
          up,
        );
      }
    }
  }

  // Pairs: A, 2-9, 10
  const pairRanks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  for (const up of upcards) {
    for (const rank of pairRanks) {
      addCell(`pair-${rank}-v-${up}`, [{ rank, suit: 's' }, { rank, suit: 'h' }], up);
    }
  }

  return cells;
}

/**
 * Shared by drawFlashcard (weighted, single draw) and the Mastery Challenge
 * (walks the whole filtered list) so the category->prefix mapping can never
 * drift between the two consumers.
 */
export function filterCellsByCategory<T extends { id: string }>(
  cells: T[],
  category: 'all' | 'hard' | 'soft' | 'pairs' | readonly HandScope[],
): T[] {
  // #13: a multi-select scope is a set of categories.
  if (typeof category !== 'string') return filterCellsByScopes(cells, category);
  if (category === 'all') return cells;
  if (category === 'pairs') return cells.filter((c) => c.id.startsWith('pair-'));
  return cells.filter((c) => c.id.startsWith(category + '-'));
}

/**
 * E2: the cells a draw may deal once the learning step has had its say -- the
 * due re-deal alone, or the deck without the cells still waiting. Either
 * falls back to the whole deck rather than leave the draw nothing to deal.
 */
function redealCells<T extends { id: string }>(cells: T[], options: FlashOptions): T[] {
  if (options.redeal !== undefined) {
    const only = cells.filter((c) => c.id === options.redeal);
    return only.length > 0 ? only : cells;
  }
  const exclude = options.exclude;
  if (!exclude || exclude.size === 0) return cells;
  const open = cells.filter((c) => !exclude.has(c.id));
  return open.length > 0 ? open : cells;
}

/**
 * Draw a random flashcard from the specified category with weighted sampling.
 *
 * @param category - 'all', 'hard', 'soft', or 'pairs', or (#13) a set of
 *   the last three
 * @param srDeck - RV4 spaced-repetition deck (cellId -> SrCard); draw prefers DUE cells
 * @param now - wall-clock epoch ms, used to weight cells by SR due-ness
 * @param seed - Optional seed for reproducibility
 * @param byConfusability - #52 forced follow: with probability 0.5 the cell
 *   is drawn ONLY from `previousCellId`'s confusable set (confusabilityWeight
 *   > 1, within the category), SR-weighted; otherwise the plain SR draw. Off,
 *   or with no previous cell, the draw is byte-identical to before.
 * @param previousCellId - The cell just answered, for the term above.
 * @param rules - Optional ruleset (defaults to DEFAULT_RULES); selects the
 *   chart/deviations the correct action is graded against — additive param,
 *   omitting it preserves v1 (H17 6-deck) behavior exactly. Note: which cell
 *   is drawn depends only on category/srDeck/now/seed, never on rules.
 * @param deckWeights - B2 deck sources: when given, only cells in this map
 *   are dealt, and each one's SR weight is multiplied by its value here (a
 *   Custom tier, or 1). Omitted or null = the whole scoped chart, drawn
 *   exactly as before. An empty deck throws; callers check first.
 * @returns A flashcard with correct action
 */
export function drawFlashcard(
  category: 'all' | 'hard' | 'soft' | 'pairs' | readonly HandScope[],
  srDeck: SrDeck,
  now: number,
  seed?: number,
  rules: StrategyRules = DEFAULT_RULES,
  byConfusability = false,
  previousCellId: string | null = null,
  deckWeights: ReadonlyMap<string, number> | null = null,
  options: FlashOptions = {},
): Flashcard {
  const rng = mulberry32(seed ?? Date.now());

  // Generate all cells
  const allCells = generateAllCells();

  // Filter by category, then (B2) by the deck
  const scoped = filterCellsByCategory(allCells, category);
  const cells = deckWeights ? scoped.filter((c) => (deckWeights.get(c.id) ?? 0) > 0) : scoped;
  if (cells.length === 0) throw new Error('drawFlashcard: the deck has no cells in this scope');
  const deckWeight = (id: string) => (deckWeights ? deckWeights.get(id)! : 1);

  // E2: the learning step. A due re-deal is the only cell on offer; cells
  // still waiting for theirs sit out. Neither touches the rng, so with both
  // absent the draw is exactly as before.
  const learning = redealCells(cells, options);

  // RV4 (docs/BACKLOG.md, spaced-repetition): weight each cell by its SR due-ness
  // (unseen/overdue-low-box heaviest), shared with the deviation quiz via srWeight.
  // #52: "Follow with a look-alike" is a forced follow, not a soft bias. The
  // coin is only tossed when the option is on AND there is a previous cell, so
  // with it off the rng sequence -- and so the draw -- is exactly as before.
  let pool = learning;
  if (byConfusability && previousCellId) {
    const followers = learning.filter((c) => confusabilityWeight(c.id, previousCellId) > 1);
    if (rng() < 0.5 && followers.length > 0) pool = followers;
  }
  const weights = pool.map((c) => srWeight(srDeck[c.id], now) * deckWeight(c.id));

  const selectedIndex = weightedIndex(rng, weights);
  const baseCell = pool[selectedIndex];

  // V4-2 (docs/BACKLOG.md): the cell fixes the TOTAL; the cards that make it
  // up are drawn fresh. Hard 16 used to be 6+10 every time it was ever shown,
  // which lets a learner memorise a card pair that does not transfer to the
  // 9+7 they get dealt. The cellId is deliberately untouched -- it keys the
  // SR deck, and varying the composition must not reset anyone's schedule.
  const varied = baseCell.id.startsWith('hard-')
    ? makeHardHand(Number(baseCell.id.split('-')[1]), rng)
    : null;
  const cell: Cell = varied ? { ...baseCell, cards: varied } : baseCell;

  // #27: sometimes the hand is dealt so double/surrender is gone. Draws
  // nothing from the rng when off, so the rest of the draw is unchanged.
  const fallback = maybeFallback(cell.cards, cell.up, rules, rng, options.fallbacks === true);
  const cards = fallback ? fallback.cards : cell.cards;
  const ctx = fallback ? fallback.ctx : FULL_CTX;

  // #53: a count to play the hand at, biased toward its index. Drawn only
  // when on, after everything else, so the rest of the draw is unchanged.
  const tc = options.withCount ? drawCountTc(cards, cell.up, ctx, rules, rng) : undefined;

  // Get correct action
  const advice = correctPlay(cards, cell.up, tc ?? 0, ctx, rules);

  return {
    cards,
    up: cell.up,
    correct: advice.action,
    cellId: cell.id,
    ...(fallback ? { ctx } : {}),
    ...(tc !== undefined ? { tc } : {}),
  };
}
