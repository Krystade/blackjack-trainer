import type { Card, Rank } from './cards';
import { handValue, isPair, pairRank } from './hand';
import { upIndex } from './basicStrategy';
import type { ChartAction } from './basicStrategy';
import type { Action, Deviation, DeviationId } from './deviations';
import { ILLUSTRIOUS_18 } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { RuleSet } from './ruleset';
import { getChart } from './charts';
import type { Chart } from './charts';

export interface PlayContext {
  canDouble: boolean;
  canSplit: boolean;
  canSurrender: boolean;
}

export interface Advice {
  action: Action;
  source: 'basic' | 'illustrious18';
  deviationId?: DeviationId;
  reason: string;
}

/** tc >= 3 is the Illustrious 18 insurance index. */
export function insuranceCorrect(tc: number): boolean {
  return tc >= 3;
}

function basic(action: Action, reason: string): Advice {
  return { action, source: 'basic', reason };
}

function deviation(dev: Deviation, action: Action): Advice {
  return { action, source: 'illustrious18', deviationId: dev.id, reason: dev.label };
}

/** Hard/soft chart action for a hand total, ignoring the PAIRS table entirely. */
function hardSoftChartAction(cards: Card[], dealerUp: Rank, chart: Chart): { action: ChartAction; total: number; soft: boolean } {
  const hv = handValue(cards);
  const idx = upIndex(dealerUp);
  const action = hv.soft ? chart.SOFT[hv.total][idx] : chart.HARD[hv.total][idx];
  return { action, total: hv.total, soft: hv.soft };
}

/** Find the active hard-total deviation matching (total, up) whose tc condition is met, if any. */
function findHardDeviation(
  deviations: Deviation[],
  total: number,
  dealerUp: Rank,
  tc: number,
): Deviation | undefined {
  const idx = upIndex(dealerUp);
  return deviations.find((d) => {
    if (!d.active || d.kind !== 'hard' || d.total !== total || d.up === undefined) return false;
    if (upIndex(d.up) !== idx) return false;
    return d.dir === 'gte' ? tc >= d.threshold : tc <= d.threshold;
  });
}

/**
 * Resolve a hand as a hard/soft total (bypassing any pair-splitting), applying
 * basic surrender, then hard-total deviations, then the basic chart.
 * Used both for non-pair hands and for pairs re-looked-up because !canSplit.
 */
function resolveAsTotal(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  deviations: Deviation[],
  chart: Chart,
): Advice {
  const { action, total, soft } = hardSoftChartAction(cards, dealerUp, chart);

  // Step 2: basic surrender beats deviations; count never overrides it.
  if (ctx.canSurrender && (action === 'Rh' || action === 'Rs')) {
    return basic('surrender', `Basic surrender vs dealer ${dealerUp}`);
  }

  // Step 3: hard-total deviations only apply to HARD hands.
  if (!soft) {
    const dev = findHardDeviation(deviations, total, dealerUp, tc);
    if (dev) {
      if (dev.action === 'double') {
        if (ctx.canDouble) return deviation(dev, 'double');
        // canDouble false: fall through to step 4.
      } else {
        // 'stand' | 'hit' deviations always apply once triggered.
        return deviation(dev, dev.action as Action);
      }
    }
  }

  // Step 4: basic chart, resolving conditionals.
  switch (action) {
    case 'H':
      return basic('hit', `Basic hit vs dealer ${dealerUp}`);
    case 'S':
      return basic('stand', `Basic stand vs dealer ${dealerUp}`);
    case 'Dh':
      return ctx.canDouble ? basic('double', `Basic double vs dealer ${dealerUp}`) : basic('hit', `Basic hit (double unavailable) vs dealer ${dealerUp}`);
    case 'Ds':
      return ctx.canDouble ? basic('double', `Basic double vs dealer ${dealerUp}`) : basic('stand', `Basic stand (double unavailable) vs dealer ${dealerUp}`);
    case 'Rh':
      return basic('hit', `Basic hit (surrender unavailable) vs dealer ${dealerUp}`);
    case 'Rs':
      return basic('stand', `Basic stand (surrender unavailable) vs dealer ${dealerUp}`);
    case 'P':
    case 'Ph':
    case 'Rp':
      // Not reachable: HARD/SOFT tables never contain pair-only actions.
      return basic('hit', `Basic hit vs dealer ${dealerUp}`);
    case 'Pd':
    case 'Ps':
      // Not reachable yet: no registered chart uses Pd/Ps (single-deck-only,
      // pair-only cells; see charts/types.ts). Throw loudly instead of
      // silently mis-resolving -- the das/ls transform task (C1.9) must add
      // real DAS-aware resolution here before any chart can use these.
      throw new Error(
        `ChartAction '${action}' reached hard/soft resolution unresolved -- DAS-aware pair resolution for '${action}' is not implemented yet`,
      );
  }
}

function play(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  deviations: Deviation[],
  chart: Chart,
): Advice {
  // Step 1: pair path, only when splitting is actually available.
  if (isPair(cards) && ctx.canSplit) {
    const rank = pairRank(cards)!;

    if (rank === '10') {
      const idx = upIndex(dealerUp);
      const ttv5 = deviations.find((d) => d.id === 'TTv5' && d.active);
      const ttv6 = deviations.find((d) => d.id === 'TTv6' && d.active);
      if (ttv5 && upIndex(ttv5.up!) === idx && tc >= ttv5.threshold) return deviation(ttv5, 'split');
      if (ttv6 && upIndex(ttv6.up!) === idx && tc >= ttv6.threshold) return deviation(ttv6, 'split');
      // Ten-pairs are absent from PAIRS -> basic fallback is always hard-20 stand.
      return basic('stand', `Basic stand vs dealer ${dealerUp}`);
    }

    if (rank === '8' && dealerUp === 'A') {
      // Rp: surrender if available, else split.
      return ctx.canSurrender
        ? basic('surrender', 'Basic surrender vs dealer A')
        : basic('split', 'Basic split vs dealer A (surrender unavailable)');
    }

    if (rank in chart.PAIRS) {
      const idx = upIndex(dealerUp);
      const action = chart.PAIRS[rank]![idx];
      if (action === 'P' || action === 'Ph') return basic('split', `Basic split vs dealer ${dealerUp}`);
      if (action === 'H') return basic('hit', `Basic hit vs dealer ${dealerUp}`);
      if (action === 'S') return basic('stand', `Basic stand vs dealer ${dealerUp}`);
      // Rp only occurs for 8,8 v A, already handled above.
      // Pd/Ps: not reachable yet -- no registered chart uses them (see
      // resolveAsTotal's Pd/Ps cases for why this stays a loud gap, not a
      // silent one, once a chart does).
    }
    // rank not in PAIRS (e.g. '5') -> falls through to hard/soft re-lookup below.
  }

  // Step 2-4: non-pair hands, or pairs re-looked-up as hard/soft totals
  // (either !canSplit, or a pair rank absent from PAIRS).
  return resolveAsTotal(cards, dealerUp, tc, ctx, deviations, chart);
}

export function correctPlay(cards: Card[], dealerUp: Rank, tc: number, ctx: PlayContext, rules: RuleSet = DEFAULT_RULES): Advice {
  return play(cards, dealerUp, tc, ctx, ILLUSTRIOUS_18, getChart(rules));
}

/** Same algorithm with deviations OFF (used by the grader). */
export function basicPlay(cards: Card[], dealerUp: Rank, ctx: PlayContext, rules: RuleSet = DEFAULT_RULES): Advice {
  return play(cards, dealerUp, 0, ctx, [], getChart(rules));
}
