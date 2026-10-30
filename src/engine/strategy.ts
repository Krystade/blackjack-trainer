import type { Card, Rank } from './cards';
import { handValue, isPair, pairRank } from './hand';
import { upIndex } from './basicStrategy';
import type { ChartAction } from './basicStrategy';
import type { Action, Deviation, DeviationId } from './deviations';
import { indexSetFor } from './deviations';
import { DEFAULT_RULES } from './ruleset';
import type { RuleSet, StrategyRules } from './ruleset';
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

/**
 * The Illustrious 18 insurance index, which is genuinely deck-dependent:
 * published as 1D 1.4 / 2D 2.4 / 6D 3.0. This app's true count is an integer,
 * so 2.4 and 3.0 both mean "take at TC >= 3" and only single deck moves — to
 * TC >= 2, one full count earlier.
 *
 * `rules` is optional so the many existing callers that pass only a tc keep
 * shoe behaviour instead of silently switching to single-deck rules.
 */
export function insuranceCorrect(tc: number, rules: RuleSet = DEFAULT_RULES): boolean {
  const ins = indexSetFor(rules).find((d) => d.id === 'ins');
  return tc >= (ins?.threshold ?? 3);
}

function basic(action: Action, reason: string): Advice {
  return { action, source: 'basic', reason };
}

function deviation(dev: Deviation, action: Action): Advice {
  return { action, source: 'illustrious18', deviationId: dev.id, reason: dev.label };
}

/**
 * Whether an index is reached at this count. C11: a zero-count cell
 * (`rcSign`) reads the running count's sign when the caller knows it --
 * negative is TC -1, otherwise TC 0 -- so truncate and round cannot turn a
 * negative count into "0". Without `rc` it reads the true count as before.
 */
function reached(d: Deviation, tc: number, rc: number | undefined): boolean {
  const t = d.rcSign && rc !== undefined ? (rc < 0 ? -1 : 0) : tc;
  return d.dir === 'gte' ? t >= d.threshold : t <= d.threshold;
}

/** Hard/soft chart action for a hand total, ignoring the PAIRS table entirely. */
function hardSoftChartAction(cards: Card[], dealerUp: Rank, chart: Chart): { action: ChartAction; total: number; soft: boolean } {
  const hv = handValue(cards);
  const idx = upIndex(dealerUp);
  const table = hv.soft ? chart.SOFT : chart.HARD;

  // A,A is soft 12, and every SOFT table starts at 13 — the pair tables answer
  // A,A directly, so no chart ever needed a soft-12 row. But the PAIRS path
  // only returns `split` when splitting is actually available; otherwise it
  // falls through to here, and `SOFT[12]` is `undefined`. That threw a
  // TypeError out of `correctPlay`, which `Game.act` calls BEFORE applying the
  // action — blanking the React tree and losing the session. Reachable in
  // ordinary play: with resplit-aces on, once the per-origin split cap is hit
  // an earlier A,A hand is still open with canSplit false.
  //
  // Clamping to the table's own floor is right rather than merely safe: a soft
  // total below the floor cannot bust and cannot stand, so it plays exactly as
  // the lowest soft row does.
  const row = table[hv.total] ?? table[Math.min(...Object.keys(table).map(Number))];
  return { action: row[idx], total: hv.total, soft: hv.soft };
}

/**
 * Find the active hard- or soft-total deviation matching (kind, total, up)
 * whose tc condition is met, if any. The kind keeps a soft 19 from ever
 * matching a hard-19 entry and vice versa.
 */
function findTotalDeviation(
  deviations: Deviation[],
  kind: 'hard' | 'soft',
  total: number,
  dealerUp: Rank,
  tc: number,
  rc?: number,
): Deviation | undefined {
  const idx = upIndex(dealerUp);
  return deviations.find((d) => {
    if (!d.active || d.kind !== kind || d.total !== total || d.up === undefined) return false;
    if (upIndex(d.up) !== idx) return false;
    return reached(d, tc, rc);
  });
}

/**
 * Find the surrender index for (total, up), if the active set carries one.
 *
 * Unlike `findTotalDeviation` this does NOT test the count: the caller needs to
 * distinguish "no index here, use the chart" from "indexed, but the count has
 * not reached it" -- those two resolve differently, and folding the threshold
 * test in here would collapse them into the same `undefined`.
 */
function findSurrenderDeviation(
  deviations: Deviation[],
  total: number,
  dealerUp: Rank,
): Deviation | undefined {
  const idx = upIndex(dealerUp);
  return deviations.find(
    (d) =>
      d.active &&
      d.kind === 'surrender' &&
      d.total === total &&
      d.up !== undefined &&
      upIndex(d.up) === idx,
  );
}

/**
 * Resolve a hand as a hard/soft total (bypassing any pair-splitting), applying
 * basic surrender, then hard/soft total deviations, then the basic chart.
 * Used both for non-pair hands and for pairs re-looked-up because !canSplit.
 */
function resolveAsTotal(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  deviations: Deviation[],
  chart: Chart,
  rc?: number,
): Advice {
  const { action, total, soft } = hardSoftChartAction(cards, dealerUp, chart);

  // Step 2: surrender.
  //
  // With surrender indices OFF (the default, and every caller that passes a
  // plain RuleSet) this is byte-identical to what it always did: basic
  // surrender wins and the count never touches it.
  //
  // With them ON (RV3, opt-in per profile) an indexed cell is decided by the
  // count INSTEAD of by the chart, in both directions -- an index can add
  // surrender where basic hits (16 v 8 at +4) and take it away where basic
  // surrenders (15 v 10 below 0). That is why this cannot be expressed as an
  // extra deviation in step 3: step 3 only ever ADDS a play, and half of this
  // feature is removing one the basic chart printed.
  //
  // Cells with no surrender index keep the old behaviour exactly, which is what
  // leaves 16 v 10, 16 v A and 17 v A surrendering unconditionally.
  let surBelow: Deviation | undefined;
  if (ctx.canSurrender) {
    const sur = soft ? undefined : findSurrenderDeviation(deviations, total, dealerUp);
    if (sur) {
      if (reached(sur, tc, rc)) {
        return deviation(sur, 'surrender');
      }
      surBelow = sur;
      // Below the index: surrender is off for this cell. Fall through rather
      // than returning, so Rh/Rs resolve to hit/stand in step 4 and any
      // hard-total deviation on the same cell still gets its say.
      //
      // Honest note on how far that is tested: with today's data this branch
      // is NOT observable. Every surrender-indexed cell is `Rh` or `H` in all
      // six charts (no `Rs`), and no cell carries a hard index that outranks
      // its surrender index -- so `fall through` and `return hit` agree
      // everywhere, and a mutant swapping one for the other survives the suite.
      // It is written this way because it is the correct shape, not because a
      // test forced it. `surrenderIndices.test.ts` locks the invariant that
      // makes it unobservable, so if an index ever lands on an `Rs` cell the
      // suite says so instead of quietly teaching a hit.
    } else if (action === 'Rh' || action === 'Rs') {
      return basic('surrender', `Basic surrender vs dealer ${dealerUp}`);
    }
  }

  // Step 3: total deviations, matched by the hand's own kind -- hard entries
  // for hard hands, soft entries (the opt-in BJA H17 extras) for soft hands.
  // A soft entry matches any soft hand of that total, so A,2,6 is an A,8.
  const dev = findTotalDeviation(deviations, soft ? 'soft' : 'hard', total, dealerUp, tc, rc);
  if (dev) {
    if (dev.action === 'double') {
      if (ctx.canDouble) return deviation(dev, 'double');
      // canDouble false: fall through to step 4.
    } else {
      // 'stand' | 'hit' deviations always apply once triggered.
      return deviation(dev, dev.action as Action);
    }
  }

  // C5: below a surrender index on a cell the chart SURRENDERS (Rh/Rs), the
  // index is what takes surrender away -- so the play is the index's, filed
  // under it, not "basic hit (surrender unavailable)" when it was available.
  // (Below an index on a plain H cell the play is simply basic.)
  if (surBelow && (action === 'Rh' || action === 'Rs')) {
    const play: Action = action === 'Rh' ? 'hit' : 'stand';
    return { action: play, source: 'illustrious18', deviationId: surBelow.id, reason: `${surBelow.label}; below it, ${play}` };
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
    case 'Rp':
      // Not reachable: HARD/SOFT tables never contain pair-only actions.
      return basic('hit', `Basic hit vs dealer ${dealerUp}`);
    case 'Ph':
    case 'Pd':
    case 'Ps':
      // Not reachable via getChart(): resolveDas resolves every Ph/Pd/Ps
      // pair cell at chart-assembly time (charts/transforms.ts), and
      // getChart() asserts none survive. Reaching here means a caller
      // constructed/passed a Chart that bypassed getChart's transform
      // pipeline -- fail loud rather than silently mis-resolving.
      throw new Error(
        `ChartAction '${action}' reached hard/soft resolution unresolved -- assembled charts must never contain conditional pair cells; getChart's resolveDas should have resolved this`,
      );
  }
}

/**
 * F18: a pair cell that does not split is played as its hard total, so the
 * total's indices apply to it -- 6,6 v 2 without DAS is a 12 v 2, and 7,7 v 10
 * is a 14 v 10. Mirrors resolveAsTotal's steps 2-3 while keeping the PAIR
 * cell's own basic play (it can encode composition the total chart cannot).
 * Returns undefined when no index changes the pair cell's play.
 */
function pairTotalIndex(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  deviations: Deviation[],
  action: ChartAction,
  rc?: number,
): Advice | undefined {
  const hv = handValue(cards);
  if (hv.soft) return undefined;
  let surrenderOff = false;
  if (ctx.canSurrender) {
    const sur = findSurrenderDeviation(deviations, hv.total, dealerUp);
    if (sur) {
      if (reached(sur, tc, rc)) return deviation(sur, 'surrender');
      surrenderOff = true;
    } else if (action === 'Rh' || action === 'Rs') {
      return undefined; // basic surrender wins, as in resolveAsTotal
    }
  }
  const dev = findTotalDeviation(deviations, 'hard', hv.total, dealerUp, tc, rc);
  if (dev) {
    if (dev.action !== 'double') return deviation(dev, dev.action as Action);
    if (ctx.canDouble) return deviation(dev, 'double');
  }
  // C5: as in resolveAsTotal, the index took the chart's surrender away.
  if (surrenderOff && (action === 'Rh' || action === 'Rs')) {
    const sur = findSurrenderDeviation(deviations, hv.total, dealerUp)!;
    const play: Action = action === 'Rh' ? 'hit' : 'stand';
    return { action: play, source: 'illustrious18', deviationId: sur.id, reason: `${sur.label}; below it, ${play}` };
  }
  return undefined;
}

/**
 * Core play algorithm, parameterized on an already-assembled Chart. Exported
 * (in addition to correctPlay/basicPlay) so tests can drive it directly with
 * a hand-crafted Chart that bypasses getChart -- e.g. to pin the fail-loud
 * behavior when a chart still contains a conditional pair cell (Ph/Pd/Ps).
 */
export function play(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  deviations: Deviation[],
  chart: Chart,
  /** C11: the running count, when known, for the zero-count cells (`rcSign`). */
  rc?: number,
): Advice {
  // Step 1: pair path. Entered for any pair (not gated on ctx.canSplit --
  // several resolved cell types, e.g. Rs/Rh/S/H, don't involve splitting at
  // all, so their fallback applies even when splitting isn't legal).
  if (isPair(cards)) {
    const rank = pairRank(cards)!;

    if (rank === '10') {
      const idx = upIndex(dealerUp);
      if (ctx.canSplit) {
        // Any active ten-pair split index for this up-card (TTv5/TTv6, plus
        // TTv4 when the BJA extras are on) -- by kind, not by id, so a new
        // pair10 entry needs no change here.
        const split = deviations.find(
          (d) =>
            d.active &&
            d.kind === 'pair10' &&
            d.up !== undefined &&
            upIndex(d.up) === idx &&
            reached(d, tc, rc),
        );
        if (split) return deviation(split, 'split');
      }
      // Ten-pairs are absent from PAIRS -> basic fallback is always hard-20 stand.
      return basic('stand', `Basic stand vs dealer ${dealerUp}`);
    }

    if (rank in chart.PAIRS) {
      const idx = upIndex(dealerUp);
      const action = chart.PAIRS[rank]![idx];
      if (action === 'Rs' || action === 'Rh' || action === 'H' || action === 'S' || action === 'Dh' || action === 'Ds') {
        const indexed = pairTotalIndex(cards, dealerUp, tc, ctx, deviations, action, rc);
        if (indexed) return indexed;
      }
      switch (action) {
        case 'P':
          if (ctx.canSplit) return basic('split', `Basic split vs dealer ${dealerUp}`);
          break; // canSplit false -> fall through to hard/soft re-lookup below.
        case 'Rp':
          if (ctx.canSurrender) return basic('surrender', `Basic surrender vs dealer ${dealerUp}`);
          if (ctx.canSplit) return basic('split', `Basic split vs dealer ${dealerUp} (surrender unavailable)`);
          break; // neither surrender nor split available -> fall through.
        case 'Rs':
          return ctx.canSurrender
            ? basic('surrender', `Basic surrender vs dealer ${dealerUp}`)
            : basic('stand', `Basic stand (surrender unavailable) vs dealer ${dealerUp}`);
        case 'Rh':
          return ctx.canSurrender
            ? basic('surrender', `Basic surrender vs dealer ${dealerUp}`)
            : basic('hit', `Basic hit (surrender unavailable) vs dealer ${dealerUp}`);
        case 'H':
          return basic('hit', `Basic hit vs dealer ${dealerUp}`);
        case 'S':
          return basic('stand', `Basic stand vs dealer ${dealerUp}`);
        case 'Dh':
          return ctx.canDouble
            ? basic('double', `Basic double vs dealer ${dealerUp}`)
            : basic('hit', `Basic hit (double unavailable) vs dealer ${dealerUp}`);
        case 'Ds':
          return ctx.canDouble
            ? basic('double', `Basic double vs dealer ${dealerUp}`)
            : basic('stand', `Basic stand (double unavailable) vs dealer ${dealerUp}`);
        case 'Ph':
        case 'Pd':
        case 'Ps':
          // Not reachable via getChart(): resolveDas resolves every Ph/Pd/Ps
          // pair cell at chart-assembly time and getChart() asserts none
          // survive. Reaching here means a caller passed a Chart that
          // bypassed getChart's transform pipeline -- fail loud instead of
          // silently treating it as a split.
          throw new Error(
            `ChartAction '${action}' reached the pair-lookup path unresolved -- assembled charts must never contain conditional pair cells; getChart's resolveDas should have resolved this (pair ${rank},${rank} vs dealer ${dealerUp})`,
          );
      }
    }
    // rank not in PAIRS (e.g. '5'), or the resolved cell (P/Rp) fell through
    // because splitting/surrender wasn't available -> hard/soft re-lookup below.
  }

  // Step 2-4: non-pair hands, or pairs re-looked-up as hard/soft totals
  // (either !canSplit, or a pair rank absent from PAIRS).
  return resolveAsTotal(cards, dealerUp, tc, ctx, deviations, chart, rc);
}

/** `rc` (C11): the running count, where the caller has one, for the zero-count cells. */
export function correctPlay(
  cards: Card[],
  dealerUp: Rank,
  tc: number,
  ctx: PlayContext,
  rules: StrategyRules = DEFAULT_RULES,
  rc?: number,
): Advice {
  const deviations = indexSetFor(rules);
  return play(cards, dealerUp, tc, ctx, deviations, getChart(rules), rc);
}

/** Same algorithm with deviations OFF (used by the grader). */
export function basicPlay(cards: Card[], dealerUp: Rank, ctx: PlayContext, rules: StrategyRules = DEFAULT_RULES): Advice {
  return play(cards, dealerUp, 0, ctx, [], getChart(rules));
}
