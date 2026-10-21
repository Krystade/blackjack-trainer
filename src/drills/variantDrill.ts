/**
 * Wave L: the Variant hands drill -- Free Bet, Spanish 21 and Switch hands,
 * graded against the variant charts (engine/variants/strategy.ts).
 *
 * Its own deck and its own tally, deliberately apart from Flashcards: a
 * "hard 16 v 10" cell means surrender in one game and hit in another, and
 * mixing the two into the standard chart's spaced-repetition deck and Stats
 * would grade the standard chart with Spanish 21 answers.
 *
 * Items:
 *  - every variant: two-card hands (hard, soft, pairs) at a fresh hand;
 *  - Free Bet: also the FREE hand (the one a free split made), from its chart;
 *  - Spanish 21: also three- to five-card hands, because the card count
 *    changes the play (16 v 2 stands with two cards and hits with five), and
 *    "after a double" hands, where the choice is stand, rescue (surrender) or,
 *    with redouble, double again.
 * Spanish 21 two-card 6-7 / 6-8 / 7-8 starts are left out: their play depends
 * on suits, which the spoken prompt does not say.
 */

import type { Card, Rank, Suit } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { handValue } from '../engine/hand';
import type { Action } from '../engine/deviations';
import type { PlayContext } from '../engine/strategy';
import { PRESETS, isPresetId } from '../engine/variants/rules';
import type { PresetId } from '../engine/variants/rules';
import { afterDoublePlay, variantLegal, variantPlay } from '../engine/variants/strategy';
import type { VariantAdvice } from '../engine/variants/strategy';
import { feasible } from '../engine/variants/chartGen';

export type VariantItemKind = 'hand' | 'free' | 'multi' | 'afterDouble';

export interface VariantItem {
  /** Stable per cell: preset, kind, the row and the up card (and card count). */
  id: string;
  preset: PresetId;
  kind: VariantItemKind;
  /** The chart table the item is graded on. */
  table: string;
  cards: Card[];
  up: Rank;
  ctx: PlayContext;
  advice: VariantAdvice;
}

const UPS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const SUITS: Suit[] = ['h', 'd', 'c', 's'];
const RANK_OF: Record<number, Rank> = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 11: 'A' };
const TENS: Rank[] = ['10', 'J', 'Q', 'K'];

function rankFor(value: number, rng: () => number): Rank {
  return value === 10 ? TENS[Math.floor(rng() * 4)]! : RANK_OF[value]!;
}

function pick<T>(xs: readonly T[], rng: () => number): T {
  return xs[Math.floor(rng() * xs.length)]!;
}

/** Cards of the given values with mixed suits (never a suited 6-7-8 start). */
function dealCards(values: number[], rng: () => number): Card[] {
  const cards = values.map((v) => ({ rank: rankFor(v, rng), suit: pick(SUITS, rng) }));
  // Two-card hands get two different suits: suits never decide an item here.
  if (cards.length === 2 && cards[0]!.suit === cards[1]!.suit) {
    cards[1] = { ...cards[1]!, suit: SUITS[(SUITS.indexOf(cards[0]!.suit) + 1) % 4]! };
  }
  return cards;
}

/** Two different non-ace values making a hard total, avoiding the given starts. */
function hardPair(total: number, rng: () => number, avoid: string[]): [number, number] | null {
  const options: [number, number][] = [];
  for (let a = 2; a <= 10; a++) {
    const b = total - a;
    if (b < a || b > 10 || b === a) continue;
    if (avoid.includes(`${a},${b}`)) continue;
    options.push([a, b]);
  }
  return options.length === 0 ? null : pick(options, rng);
}

/** n cards (2-10 values, aces as 1 only when forced) making a hard total, or null. */
function hardCards(total: number, n: number, rng: () => number): number[] | null {
  for (let attempt = 0; attempt < 200; attempt++) {
    const vals: number[] = [];
    let left = total;
    for (let i = 0; i < n - 1; i++) {
      const maxV = Math.min(10, left - 2 * (n - 1 - i));
      if (maxV < 2) break;
      const v = 2 + Math.floor(rng() * (maxV - 1));
      vals.push(v);
      left -= v;
    }
    if (vals.length !== n - 1 || left < 2 || left > 10) continue;
    vals.push(left);
    const hv = handValue(vals.map((v) => ({ rank: rankFor(v, rng), suit: 'h' as Suit })));
    if (!hv.soft && hv.total === total) return vals;
  }
  return null;
}

/** n cards for a soft total: one ace plus n-1 small cards. */
function softCards(total: number, n: number, rng: () => number): number[] | null {
  const rest = hardCards(total - 11, n - 1, rng);
  if (rest) return [11, ...rest];
  if (n - 1 === 1 && total - 11 >= 2 && total - 11 <= 10) return [11, total - 11];
  return null;
}

function presetCtx(preset: PresetId, overrides: Partial<PlayContext> = {}): PlayContext {
  return { canDouble: true, canSplit: true, canSurrender: PRESETS[preset].ls, ...overrides };
}

function twoCardItem(preset: PresetId, kind: 'hand' | 'free', rng: () => number): VariantItem {
  const rules = PRESETS[preset];
  const table = rules.variant === 'freebet' ? (kind === 'free' ? 'free' : 'real') : 'main';
  const up = pick(UPS, rng);
  const avoid = rules.cardBonuses ? ['6,7', '6,8', '7,8'] : [];
  const shape = rng();
  let values: number[];
  let label: string;
  if (shape < 0.5) {
    let total = 5 + Math.floor(rng() * 15); // 5..19
    let pair = hardPair(total, rng, avoid);
    while (!pair) {
      total = 5 + Math.floor(rng() * 15);
      pair = hardPair(total, rng, avoid);
    }
    values = pair;
    label = `hard-${total}`;
  } else if (shape < 0.75) {
    const kicker = 2 + Math.floor(rng() * 8); // A,2..A,9
    values = [11, kicker];
    label = `soft-${11 + kicker}`;
  } else {
    const v = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11][Math.floor(rng() * 10)]!;
    values = [v, v];
    label = `pair-${v}`;
  }
  const cards = dealCards(values, rng);
  // A free hand came from a split: no surrender on it.
  const ctx = presetCtx(preset, kind === 'free' ? { canSurrender: false } : {});
  return {
    id: `${preset}|${kind}|${label}|${up}`,
    preset,
    kind,
    table,
    cards,
    up,
    ctx,
    advice: variantPlay(preset, table, cards, up, ctx),
  };
}

function multiCardItem(preset: PresetId, rng: () => number): VariantItem {
  for (;;) {
    const up = pick(UPS, rng);
    const n = 3 + Math.floor(rng() * 3); // 3..5
    const soft = rng() < 0.35;
    const total = soft ? 13 + Math.floor(rng() * 7) : 9 + Math.floor(rng() * 9); // soft 13-19, hard 9-17
    if (!feasible(total, soft, n)) continue;
    const values = soft ? softCards(total, n, rng) : hardCards(total, n, rng);
    if (!values) continue;
    const cards = values.map((v) => ({ rank: rankFor(v, rng), suit: pick(SUITS, rng) }));
    const hv = handValue(cards);
    if (hv.total !== total || hv.soft !== soft) continue;
    const ctx = presetCtx(preset, { canSplit: false, canSurrender: false });
    return {
      id: `${preset}|multi|${soft ? 'soft' : 'hard'}-${total}|${up}|${n}`,
      preset,
      kind: 'multi',
      table: 'main',
      cards,
      up,
      ctx,
      advice: variantPlay(preset, 'main', cards, up, ctx),
    };
  }
}

function afterDoubleItem(preset: PresetId, rng: () => number): VariantItem {
  const rdd = PRESETS[preset].maxDoubles > 1;
  for (;;) {
    const up = pick(UPS, rng);
    // The totals a double can leave a hand on that are worth asking about.
    const total = rdd ? 6 + Math.floor(rng() * 12) : 12 + Math.floor(rng() * 6); // 6-17 or 12-17
    const values = hardCards(total, 3, rng);
    if (!values) continue;
    const cards = values.map((v) => ({ rank: rankFor(v, rng), suit: pick(SUITS, rng) }));
    if (handValue(cards).soft) continue;
    return {
      id: `${preset}|afterDouble|hard-${total}|${up}`,
      preset,
      kind: 'afterDouble',
      table: 'main',
      cards,
      up,
      ctx: { canDouble: rdd, canSplit: false, canSurrender: true },
      advice: afterDoublePlay(preset, total, false, up),
    };
  }
}

/** Deal one item for a preset. Deterministic for a given seed. */
export function drawVariantItem(preset: PresetId, seed: number): VariantItem {
  const rng = mulberry32(seed);
  const rules = PRESETS[preset];
  const roll = rng();
  if (rules.variant === 'freebet') return twoCardItem(preset, roll < 0.75 ? 'hand' : 'free', rng);
  if (rules.variant === 'spanish21') {
    if (roll < 0.5) return twoCardItem(preset, 'hand', rng);
    if (roll < 0.85) return multiCardItem(preset, rng);
    return afterDoubleItem(preset, rng);
  }
  return twoCardItem(preset, 'hand', rng);
}

/** The plays the item may make (the answer bar's enabled buttons, the zone gate). */
export function variantItemLegal(item: VariantItem): Action[] {
  if (item.kind === 'afterDouble') {
    return item.ctx.canDouble ? ['stand', 'double', 'surrender'] : ['stand', 'surrender'];
  }
  return variantLegal(item.preset, item.cards, item.ctx);
}

export interface VariantGrade {
  correct: boolean;
  expected: Action;
  reason: string;
}

export function gradeVariantItem(item: VariantItem, taken: Action): VariantGrade {
  return { correct: taken === item.advice.action, expected: item.advice.action, reason: item.advice.reason };
}

/* ---------------------------------------------------------------- */
/* The choice and the tally, kept in their own key                    */
/* ---------------------------------------------------------------- */

/**
 * The variant being studied: shared by the Charts picker and this drill, so
 * picking Spanish 21 on Charts opens the drill on Spanish 21. Its own key,
 * like the chart row order -- a study preference, not part of a profile.
 */
export const VARIANT_CHOICE_KEY = 'bjtrainer.variant.v1';
export const VARIANT_TALLY_KEY = 'bjtrainer.variantTally.v1';

export type VariantChoice = 'standard' | PresetId;

export function loadVariantChoice(): VariantChoice {
  try {
    const raw = window.localStorage.getItem(VARIANT_CHOICE_KEY);
    return raw === 'standard' || isPresetId(raw) ? raw : 'standard';
  } catch {
    return 'standard';
  }
}

export function saveVariantChoice(choice: VariantChoice): void {
  try {
    window.localStorage.setItem(VARIANT_CHOICE_KEY, choice);
  } catch {
    // A preference that cannot be saved is still applied for this visit.
  }
}

export type VariantTally = Partial<Record<PresetId, { right: number; wrong: number }>>;

export function loadVariantTally(): VariantTally {
  try {
    const raw = window.localStorage.getItem(VARIANT_TALLY_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as VariantTally) : {};
  } catch {
    return {};
  }
}

export function recordVariantAnswer(tally: VariantTally, preset: PresetId, correct: boolean): VariantTally {
  const prev = tally[preset] ?? { right: 0, wrong: 0 };
  const next: VariantTally = {
    ...tally,
    [preset]: { right: prev.right + (correct ? 1 : 0), wrong: prev.wrong + (correct ? 0 : 1) },
  };
  try {
    window.localStorage.setItem(VARIANT_TALLY_KEY, JSON.stringify(next));
  } catch {
    // Best effort, like every drill tally.
  }
  return next;
}
