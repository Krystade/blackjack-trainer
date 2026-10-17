import type { Card, Rank } from '../engine/cards';
import { mulberry32 } from '../engine/cards';
import { basicPlay, correctPlay, insuranceCorrect, type PlayContext } from '../engine/strategy';
import type { Action, Deviation } from '../engine/deviations';
import type { StrategyRules } from '../engine/ruleset';
import { cellIdForDeviation, diffRules, rulesNames, type IndexDiff, type RulesDiff } from '../engine/rulesDiff';
import { EYE_DECK_ERROR, tcBand, tcWithinEye, trueCount, type TcRounding } from '../engine/count';
import { generateAllCells, type Cell } from './flashcards';
import { drillLegalActions } from './legalActions';
import { gradeDeckEstimate, makeDeckEstimationQuestion } from './deckEstimation';
import { depthOptions } from './depthResolution';
import { signed } from './signed';

/**
 * B10 rules differences drill: asks only the plays where two rulesets give
 * different answers, each time under one side's rules.
 */

export type Side = 'a' | 'b';
export const DIFF_TC_WINDOW: readonly [number, number] = [-6, 6];

export type PoolItem =
  | { kind: 'play'; cellId: string; cards: Card[]; up: Rank; tcs: number[] | null } // null = basic strategy, no count shown
  | { kind: 'insurance'; tcs: number[] };

export interface RulesDrillPlan {
  a: StrategyRules;
  b: StrategyRules;
  names: [string, string];
  diff: RulesDiff;
  pool: PoolItem[];
  inert: IndexDiff[];
  trayDecks: number | null;
}

export type RulesQuestion =
  | { kind: 'play'; side: Side; cellId: string; cards: Card[]; up: Rank; tc: number | null }
  | { kind: 'insurance'; side: Side; tc: number }
  | { kind: 'tray-decks'; side: Side; totalDecks: number; cardsDealt: number }
  | { kind: 'tray-tc'; side: Side; totalDecks: number; cardsDealt: number; rc: number };

export type RulesAnswer = Action | 'take-insurance' | 'decline-insurance' | number;

const ACTION_ORDER: Action[] = ['hit', 'stand', 'double', 'split', 'surrender'];

function windowTcs(): number[] {
  const out: number[] = [];
  for (let tc = DIFF_TC_WINDOW[0]; tc <= DIFF_TC_WINDOW[1]; tc++) out.push(tc);
  return out;
}

export function questionCtx(rules: StrategyRules): PlayContext {
  return { canDouble: true, canSplit: true, canSurrender: rules.ls };
}

export function sideRules(plan: RulesDrillPlan, side: Side): StrategyRules {
  return side === 'a' ? plan.a : plan.b;
}

const sideName = (plan: RulesDrillPlan, side: Side) => plan.names[side === 'a' ? 0 : 1];

let cellCache: Map<string, Cell> | null = null;
function cellById(id: string): Cell | undefined {
  if (!cellCache) cellCache = new Map(generateAllCells().map((c) => [c.id, c]));
  return cellCache.get(id);
}

export function planRulesDrill(a: StrategyRules, b: StrategyRules): RulesDrillPlan {
  const diff = diffRules(a, b);
  const window = windowTcs();
  const pool: PoolItem[] = [];
  const inert: IndexDiff[] = [];
  const inPool = new Set<string>();

  const playDiffTcs = (c: Cell) =>
    window.filter((tc) => correctPlay(c.cards, c.up, tc, questionCtx(a), a).action !== correctPlay(c.cards, c.up, tc, questionCtx(b), b).action);

  for (const cd of diff.cells) {
    const c = cellById(cd.cellId);
    if (!c) continue;
    const tcs = playDiffTcs(c);
    const basicDiffers = basicPlay(c.cards, c.up, questionCtx(a), a).action !== basicPlay(c.cards, c.up, questionCtx(b), b).action;
    if (tcs.length === window.length && basicDiffers) {
      pool.push({ kind: 'play', cellId: c.id, cards: c.cards, up: c.up, tcs: null });
      inPool.add(c.id);
    } else if (tcs.length > 0) {
      pool.push({ kind: 'play', cellId: c.id, cards: c.cards, up: c.up, tcs });
      inPool.add(c.id);
    }
  }

  for (const d of diff.indices) {
    const dev = (d.a ?? d.b) as Deviation;
    const cellId = cellIdForDeviation(dev);
    if (cellId !== null && inPool.has(cellId)) continue;
    if (cellId === 'insurance') {
      const tcs = window.filter((tc) => insuranceCorrect(tc, a) !== insuranceCorrect(tc, b));
      if (tcs.length > 0) {
        pool.push({ kind: 'insurance', tcs });
        inPool.add('insurance');
      } else inert.push(d);
      continue;
    }
    const c = cellId === null ? undefined : cellById(cellId);
    const tcs = c ? playDiffTcs(c) : [];
    if (c && tcs.length > 0) {
      pool.push({ kind: 'play', cellId: c.id, cards: c.cards, up: c.up, tcs });
      inPool.add(c.id);
    } else inert.push(d);
  }

  const trayDecks = diff.sameChart && a.decks !== b.decks ? Math.max(a.decks, b.decks) : null;
  return { a, b, names: rulesNames(a, b), diff, pool, inert, trayDecks };
}

export function drawRulesQuestion(plan: RulesDrillPlan, seed: number, n: number): RulesQuestion | null {
  if (plan.pool.length === 0 && plan.trayDecks === null) return null;
  const rng = mulberry32(seed);
  if (plan.trayDecks !== null && (plan.pool.length === 0 || n % 3 === 2)) {
    const totalDecks = plan.trayDecks;
    const side: Side = plan.a.decks === totalDecks ? 'a' : 'b';
    if (n % 2 === 0) {
      const { cardsDealt } = makeDeckEstimationQuestion(seed, { totalDecks });
      return { kind: 'tray-decks', side, totalDecks, cardsDealt };
    }
    // Half steps 1 .. totalDecks - 1.
    const steps = 2 * (totalDecks - 1) - 2 + 1;
    const remaining = (2 + Math.floor(rng() * steps)) / 2;
    const dealtDecks = totalDecks - remaining;
    const span = Math.round(2 * dealtDecks) + 1;
    const rc = -span + Math.floor(rng() * (2 * span + 1));
    return { kind: 'tray-tc', side, totalDecks, cardsDealt: dealtDecks * 52, rc: rc === 0 ? 0 : rc };
  }
  const item = plan.pool[Math.floor(rng() * plan.pool.length)];
  const side: Side = n % 2 === 0 ? 'a' : 'b';
  if (item.kind === 'insurance') return { kind: 'insurance', side, tc: item.tcs[Math.floor(rng() * item.tcs.length)] };
  const tc = item.tcs === null ? null : item.tcs[Math.floor(rng() * item.tcs.length)];
  return { kind: 'play', side, cellId: item.cellId, cards: item.cards, up: item.up, tc };
}

const exactRemaining = (q: { totalDecks: number; cardsDealt: number }) => (q.totalDecks * 52 - q.cardsDealt) / 52;

/** The offered half-deck option closest to the exact depth. */
function nearestDepthOption(q: { totalDecks: number; cardsDealt: number }): number {
  const exact = exactRemaining(q);
  const opts = depthOptions(q.totalDecks, 'half');
  return opts.reduce((best, o) => (Math.abs(o - exact) < Math.abs(best - exact) ? o : best), opts[0]!);
}

function playAction(q: Extract<RulesQuestion, { kind: 'play' }>, rules: StrategyRules): Action {
  const ctx = questionCtx(rules);
  return q.tc === null ? basicPlay(q.cards, q.up, ctx, rules).action : correctPlay(q.cards, q.up, q.tc, ctx, rules).action;
}

export function expectedRulesAnswer(q: RulesQuestion, plan: RulesDrillPlan, rounding?: TcRounding): RulesAnswer {
  const rules = sideRules(plan, q.side);
  switch (q.kind) {
    case 'play':
      return playAction(q, rules);
    case 'insurance':
      return insuranceCorrect(q.tc, rules) ? 'take-insurance' : 'decline-insurance';
    case 'tray-decks':
      // #52: the button to have tapped, not the exact depth (2.63 -> 2.5).
      return nearestDepthOption(q);
    case 'tray-tc':
      return trueCount(q.rc, exactRemaining(q), rounding);
  }
}

export function gradeRulesAnswer(q: RulesQuestion, plan: RulesDrillPlan, taken: RulesAnswer, rounding?: TcRounding): boolean {
  if (q.kind === 'tray-decks') return typeof taken === 'number' && gradeDeckEstimate(taken, exactRemaining(q), 0.5).correct;
  if (q.kind === 'tray-tc') return typeof taken === 'number' && tcWithinEye(taken, q.rc, exactRemaining(q), EYE_DECK_ERROR, rounding);
  return taken === expectedRulesAnswer(q, plan, rounding);
}

export function rulesAnswerOptions(q: RulesQuestion, plan: RulesDrillPlan): RulesAnswer[] {
  switch (q.kind) {
    case 'play': {
      // The union over both sides: per-side buttons would give the answer away
      // (drillLegalActions hides Surrender on 8,8 v A under S17).
      const offered = new Set<Action>();
      for (const rules of [plan.a, plan.b]) {
        for (const act of drillLegalActions(q.cards, rules, q.up, questionCtx(rules))) offered.add(act);
      }
      const ls = sideRules(plan, q.side).ls;
      return ACTION_ORDER.filter((act) => offered.has(act) && (act !== 'surrender' || ls));
    }
    case 'insurance':
      return ['take-insurance', 'decline-insurance'];
    case 'tray-decks':
      return depthOptions(q.totalDecks, 'half');
    case 'tray-tc':
      return [];
  }
}

const ACTION_LABEL: Record<Action, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };
const ACTION_THIRD: Record<Action, string> = { hit: 'hits', stand: 'stands', double: 'doubles', split: 'splits', surrender: 'surrenders' };

export function rulesAnswerLabel(q: RulesQuestion, a: RulesAnswer): string {
  if (a === 'take-insurance') return 'Take insurance';
  if (a === 'decline-insurance') return 'No insurance';
  if (typeof a === 'number') return q.kind === 'tray-tc' ? signed(a) : String(a);
  return ACTION_LABEL[a];
}

/** 'hard-11-v-A' -> '11 v A'; soft -> 'A,7 v 2'; pair -> '8,8 v A'. */
function cellLabel(cellId: string): string {
  const m = /^(hard|soft|pair)-(\w+)-v-(\w+)$/.exec(cellId);
  if (!m) return cellId;
  const [, kind, key, up] = m;
  let hand = key;
  if (kind === 'soft') hand = `A,${Number(key) - 11}`;
  if (kind === 'pair') hand = `${key},${key}`;
  return `${hand} v ${up}`;
}

const tcText = (tc: number) => `TC ${signed(tc)}`;
const decksText = (n: number) => `${Number(n.toFixed(2))} ${n === 1 ? 'deck' : 'decks'}`;

export function rulesQuestionPrompt(q: RulesQuestion, plan: RulesDrillPlan): string {
  const name = sideName(plan, q.side);
  switch (q.kind) {
    case 'play':
      return q.tc === null ? `Under ${name}: ${cellLabel(q.cellId)}?` : `Under ${name} at ${tcText(q.tc)}: ${cellLabel(q.cellId)}?`;
    case 'insurance':
      return `Under ${name} at ${tcText(q.tc)}: insurance?`;
    case 'tray-decks':
      return `Under ${name}: how many decks are left?`;
    case 'tray-tc':
      return `Under ${name}: RC ${signed(q.rc)}. True count?`;
  }
}

const VERB: Record<Deviation['action'], string> = {
  hit: 'hit', stand: 'stand', double: 'double', split: 'split', surrender: 'surrender', 'take-insurance': 'insure',
};

function indexText(d: Deviation | null): string {
  if (!d || !d.active) return 'none';
  return `${VERB[d.action]} ${d.dir === 'gte' ? '≥' : '≤'} ${signed(d.threshold)}`;
}

function indexPair(plan: RulesDrillPlan, d: IndexDiff): string {
  return `${plan.names[0]} ${indexText(d.a)}, ${plan.names[1]} ${indexText(d.b)}`;
}

function cellIndexDiffs(plan: RulesDrillPlan, cellId: string): IndexDiff[] {
  return plan.diff.indices.filter((d) => cellIdForDeviation((d.a ?? d.b) as Deviation) === cellId);
}

function bothPlays(plan: RulesDrillPlan, q: Extract<RulesQuestion, { kind: 'play' }>): string {
  return `${plan.names[0]} ${ACTION_THIRD[playAction(q, plan.a)]}, ${plan.names[1]} ${ACTION_THIRD[playAction(q, plan.b)]}`;
}

function bothInsurance(plan: RulesDrillPlan, tc: number): string {
  const word = (r: StrategyRules) => (insuranceCorrect(tc, r) ? 'takes insurance' : 'declines insurance');
  return `${plan.names[0]} ${word(plan.a)}, ${plan.names[1]} ${word(plan.b)}`;
}

export function explainRulesQuestion(q: RulesQuestion, plan: RulesDrillPlan, rounding?: TcRounding): string {
  switch (q.kind) {
    case 'play': {
      const label = cellLabel(q.cellId);
      if (q.tc === null) return `Basic strategy, ${label}: ${bothPlays(plan, q)}.`;
      const idx = cellIndexDiffs(plan, q.cellId);
      const tail = idx.length > 0 ? ` Index: ${idx.map((d) => indexPair(plan, d)).join('; ')}.` : '';
      return `At ${tcText(q.tc)}, ${label}: ${bothPlays(plan, q)}.${tail}`;
    }
    case 'insurance':
      return `At ${tcText(q.tc)}: ${bothInsurance(plan, q.tc)}.`;
    case 'tray-decks':
      return `${q.cardsDealt} of ${q.totalDecks * 52} cards dealt: ${decksText(exactRemaining(q))} left.`;
    case 'tray-tc': {
      const rem = exactRemaining(q);
      const tc = trueCount(q.rc, rem, rounding);
      const band = tcBand(q.rc, rem, EYE_DECK_ERROR, rounding);
      const bracket = band.min === band.max ? '' : ` (${signed(band.min)} to ${signed(band.max)} accepted)`;
      return `RC ${signed(q.rc)} ÷ ${decksText(rem)} → ${tcText(tc)}${bracket}.`;
    }
  }
}

function tcRangeText(tcs: number[]): string {
  const min = Math.min(...tcs);
  const max = Math.max(...tcs);
  const [lo, hi] = DIFF_TC_WINDOW;
  if (min === lo && max === hi) return 'at every TC';
  if (min === max) return `at ${tcText(min)}`;
  if (min === lo) return `at ${tcText(max)} and below`;
  if (max === hi) return `at ${tcText(min)} and above`;
  return `at ${tcText(min)} to ${signed(max)}`;
}

export function diffSummary(plan: RulesDrillPlan): string[] {
  return plan.pool.map((item) => {
    if (item.kind === 'insurance') return `Insurance ${tcRangeText(item.tcs)}: ${bothInsurance(plan, item.tcs[0])}`;
    const q: Extract<RulesQuestion, { kind: 'play' }> = {
      kind: 'play', side: 'a', cellId: item.cellId, cards: item.cards, up: item.up, tc: item.tcs === null ? null : item.tcs[0],
    };
    const label = cellLabel(item.cellId);
    const where = item.tcs === null ? label : `${label} ${tcRangeText(item.tcs)}`;
    return `${where}: ${bothPlays(plan, q)}`;
  });
}

export function inertNotes(plan: RulesDrillPlan): string[] {
  return plan.inert.map((d) => {
    const cellId = cellIdForDeviation((d.a ?? d.b) as Deviation);
    const label = cellId === 'insurance' ? 'Insurance' : cellId === null ? d.id : cellLabel(cellId);
    return `${label}: the index differs (${indexPair(plan, d)}) but never changes a play at this table.`;
  });
}

export function sameChartNotice(plan: RulesDrillPlan): string | null {
  if (!plan.diff.sameChart) return null;
  const [A, B] = plan.names;
  const tail = plan.trayDecks
    ? ` What changes is the shoe: you divide by more decks. Practise reading the ${plan.trayDecks}-deck tray.`
    : '';
  return `${A} and ${B} use the same basic chart${plan.diff.indices.length === 0 ? ' and the same index plays.' : '.'}${tail}`;
}
