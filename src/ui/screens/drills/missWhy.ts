import type { Rank } from '../../../engine/cards';
import type { ChartAction } from '../../../engine/charts';
import type { RuleSet } from '../../../engine/ruleset';
import { regionRuleFor } from '../regionRule';
import { bustLine } from '../playMissReason';

/**
 * T2-2B: the "why" under a basic-strategy miss -- one plain sentence on the
 * principle behind the chart's play, so a miss teaches the reason and not
 * only the answer ("Hard 12–16 v 2–6: stand" says what; this says why).
 *
 * The play itself comes from the assembled chart (regionRuleFor); nothing
 * here decides what to do. Each principle is tagged with the chart codes it
 * may explain, and missWhy.test.ts sweeps every cell of several rulesets to
 * hold that a cell is only ever explained by a principle tagged with its own
 * code -- so a rule change that moves a cell can never leave a stale reason
 * ("stand and let the dealer bust" under a hit).
 *
 * Rules are tried in order; the first whose `when` matches wins. The
 * specific cases (12 v 2/3, 5,5 v 10/A, soft 18 standing) sit above the
 * general ones they would otherwise fall into.
 */

export interface WhyCell {
  section: 'HARD' | 'SOFT' | 'PAIRS';
  /** Hard or soft total (soft counts the ace as 11); for a pair, its rank. */
  row: number | Rank;
  up: Rank;
  /** The chart's code for the cell. */
  action: ChartAction;
}

export interface MissWhyRule {
  id: string;
  /** The chart codes this principle may explain. */
  tags: readonly ChartAction[];
  when: (c: WhyCell) => boolean;
  text: (c: WhyCell, rules: RuleSet) => string;
}

const LOW_UPS: readonly Rank[] = ['2', '3', '4', '5', '6'];
const isLow = (up: Rank) => LOW_UPS.includes(up);
const isDouble = (a: ChartAction) => a === 'Dh' || a === 'Ds';
const isSurrender = (a: ChartAction) => a === 'Rh' || a === 'Rs' || a === 'Rp';
const total = (c: WhyCell) => (typeof c.row === 'number' ? c.row : NaN);
const upWord = (up: Rank) => (up === 'A' ? 'an ace' : up === '8' ? 'an 8' : `a ${up}`);

export const MISS_WHY_RULES: readonly MissWhyRule[] = [
  // ---- Surrender: one principle, whatever the hand.
  {
    id: 'surrender',
    tags: ['Rh', 'Rs', 'Rp'],
    when: (c) => isSurrender(c.action),
    text: (c) =>
      `This hand loses well over half the time against ${upWord(c.up)}, even played right. Giving up half the bet costs less.`,
  },

  // ---- Pairs.
  {
    id: 'pair-aces',
    tags: ['P'],
    when: (c) => c.section === 'PAIRS' && c.row === 'A' && c.action === 'P',
    text: () => 'Two aces make a poor 12 together, but split each one starts a hand at 11.',
  },
  {
    id: 'pair-eights',
    tags: ['P'],
    when: (c) => c.section === 'PAIRS' && c.row === '8' && c.action === 'P',
    text: () => '8,8 is 16, the worst total there is. Two hands that each start at 8 lose far less.',
  },
  {
    id: 'pair-tens',
    tags: ['S'],
    when: (c) => c.section === 'PAIRS' && c.row === '10',
    text: () => '20 already wins most hands. Never break it up.',
  },
  {
    id: 'pair-fives-strong-up',
    tags: ['H'],
    when: (c) => c.section === 'PAIRS' && c.row === '5' && (c.up === '10' || c.up === 'A') && c.action === 'H',
    text: () =>
      "5,5 is a hard 10, never two 5s. Against a 10 or an ace the dealer is too strong to double into, so just hit.",
  },
  {
    id: 'pair-fives',
    tags: ['Dh', 'Ds', 'H'],
    when: (c) => c.section === 'PAIRS' && c.row === '5',
    text: () => '5,5 is a hard 10, a strong start: double it against a weaker dealer card. Never split it.',
  },
  {
    id: 'pair-split-weak-up',
    tags: ['P'],
    when: (c) => c.section === 'PAIRS' && c.action === 'P',
    text: (c) =>
      isLow(c.up)
        ? `The dealer is weak with ${upWord(c.up)} up, so two hands means twice the money out while the dealer is likely to bust.`
        : `Two hands starting at ${c.row} do better against ${upWord(c.up)} than one hand of ${pairTotal(c.row as Rank)}.`,
  },
  {
    id: 'pair-play-total',
    tags: ['H', 'S', 'Dh', 'Ds'],
    when: (c) => c.section === 'PAIRS',
    text: (c) => `Splitting here makes two weak hands. Play it as a total of ${pairTotal(c.row as Rank)} instead.`,
  },

  // ---- Doubles.
  {
    id: 'double-soft',
    tags: ['Dh', 'Ds'],
    when: (c) => c.section === 'SOFT' && isDouble(c.action),
    text: (c) =>
      `A soft hand can't bust on one card, and ${upWord(c.up)} up is weak. Double while the dealer is likely to bust.`,
  },
  {
    id: 'double-hard',
    tags: ['Dh', 'Ds'],
    when: (c) => isDouble(c.action),
    text: (c) =>
      total(c) >= 9
        ? `${total(c)} is a strong start: a 10-value card, the most common, makes a big hand. You are the favourite against ${upWord(c.up)}, so double the bet.`
        : `With so few decks, ${total(c)} against ${upWord(c.up)} is just strong enough: the dealer busts often, so double the bet.`,
  },

  // ---- Hard totals.
  {
    id: 'hard-12-v-2-3',
    tags: ['H'],
    when: (c) => c.section === 'HARD' && total(c) === 12 && (c.up === '2' || c.up === '3') && c.action === 'H',
    text: (c) =>
      `Only a 10-value card busts a 12, and the dealer busts less with ${upWord(c.up)} than with a 4 to 6, so hit.`,
  },
  {
    id: 'hard-stiff-stand',
    tags: ['S'],
    when: (c) => c.section === 'HARD' && total(c) >= 12 && total(c) <= 16 && c.action === 'S' && isLow(c.up),
    text: (c, rules) => `${bustLine(c.up, rules)} Stand on your stiff and let the dealer take the risk.`,
  },
  {
    id: 'hard-stiff-hit',
    tags: ['H'],
    when: (c) => c.section === 'HARD' && total(c) >= 12 && total(c) <= 16 && c.action === 'H',
    text: (c) =>
      `With ${upWord(c.up)} up the dealer usually makes 17 or more, so standing on ${total(c)} loses. Hit and try to improve.`,
  },
  {
    id: 'hard-stand-high',
    tags: ['S'],
    when: (c) => c.section === 'HARD' && total(c) >= 17 && c.action === 'S',
    text: (c) => `${total(c)} is a made hand: most cards would bust it. Stand.`,
  },
  {
    id: 'hard-low-hit',
    tags: ['H'],
    when: (c) => c.section === 'HARD' && total(c) <= 11 && c.action === 'H',
    text: (c) =>
      total(c) >= 9
        ? `No card can bust ${total(c)}, but against ${upWord(c.up)} the edge is too thin to double. Just hit.`
        : `No card can bust ${total(c)}: always take one.`,
  },

  // ---- Soft totals.
  {
    id: 'soft-18-stand',
    tags: ['S'],
    when: (c) => c.section === 'SOFT' && total(c) === 18 && c.action === 'S',
    text: (c) =>
      `Soft 18 is a fair hand. Against ${upWord(c.up)} it wins or ties often enough that drawing would only give that up.`,
  },
  {
    id: 'soft-stand',
    tags: ['S'],
    when: (c) => c.section === 'SOFT' && c.action === 'S',
    text: (c) => `Soft ${total(c)} is already a strong hand. Stand.`,
  },
  {
    id: 'soft-hit',
    tags: ['H'],
    when: (c) => c.section === 'SOFT' && c.action === 'H',
    text: (c) =>
      `A soft ${total(c)} can't bust on one card, and it is too weak to stand on against ${upWord(c.up)}. Hit.`,
  },
];

function pairTotal(rank: Rank): number {
  if (rank === 'A') return 12;
  if (rank === 'J' || rank === 'Q' || rank === 'K') return 20;
  return Number(rank) * 2;
}

/** The cell a drill cell id ("hard-16-v-10", "soft-18-v-9", "pair-8-v-A") names. */
export function whyCellFor(cellId: string, rules: RuleSet): WhyCell | null {
  const m = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cellId);
  if (!m) return null;
  const region = regionRuleFor(cellId, rules);
  if (!region) return null;
  const [, kind, rowRaw, upRaw] = m;
  const section = kind === 'hard' ? 'HARD' : kind === 'soft' ? 'SOFT' : 'PAIRS';
  const row = section === 'PAIRS' ? (rowRaw as Rank) : Number(rowRaw);
  return { section, row, up: upRaw as Rank, action: region.action };
}

/** The rule that explains a cell, or null where none applies. */
export function missWhyRule(cell: WhyCell): MissWhyRule | null {
  return MISS_WHY_RULES.find((r) => r.when(cell)) ?? null;
}

/** The "why" line for a missed drill cell, or null. */
export function missWhy(cellId: string, rules: RuleSet): string | null {
  const cell = whyCellFor(cellId, rules);
  if (!cell) return null;
  const rule = missWhyRule(cell);
  return rule ? rule.text(cell, rules) : null;
}
