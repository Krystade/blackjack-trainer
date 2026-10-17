import { mulberry32, snapDecksRemaining } from '../engine/cards';
import { betWithinStep, spreadSteps } from '../engine/coverBets';
import { trueCount, type TcRounding } from '../engine/count';
import type { SpreadRow } from '../engine/game';
import { sitOutIsCorrect, spreadUnitsFor } from '../engine/wong';
import type { Stats } from '../store/types';
import { signed } from './signed';

/**
 * Wave B B4 (W8, D1): the Bet sizing drill, which replaces Bet or sit.
 *
 * A scenario is what a player at Play's table has before a deal: the running
 * count and the discard tray. The answer is a rung of the profile's own spread,
 * or Sit. Grading is NOT a second implementation of the ramp: it calls the same
 * `engine/wong.ts` and `engine/coverBets.ts` functions `Game.startRound` and
 * `Game.sitOut` call, on the true count `Game.trueCountNow` would compute (the
 * shoe's snapped depth, the profile's rounding). betSizing.test.ts runs a real
 * `Game` on a rigged shoe to prove the two verdicts never differ.
 */

/** Units of the spread, or sitting the round out. */
export type BetAnswer = number | 'sit';

export interface BetSizingScenario {
  rc: number;
  /** Cards already in the discard tray. */
  cardsDealt: number;
  totalDecks: number;
}

/** What grading reads off a profile. A `Profile` satisfies it. */
export interface BetGradeProfile {
  spread: readonly SpreadRow[];
  coverBets?: boolean;
  tcRounding?: TcRounding;
}

export type BetSizingRow = NonNullable<Stats['betSizing']>['history'][number];

/**
 * The depth Play divides by: `Shoe.decksRemaining`'s snapping rule on the cards
 * left. Not the exact `(cards left) / 52`, which disagrees with Play off the
 * half-deck grid.
 */
export function scenarioDecksRemaining(s: BetSizingScenario): number {
  return snapDecksRemaining(s.totalDecks * 52 - s.cardsDealt, s.totalDecks);
}

/** The true count Play grades this pre-deal decision against. */
export function scenarioTc(s: BetSizingScenario, rounding?: TcRounding): number {
  return trueCount(s.rc, scenarioDecksRemaining(s), rounding);
}

/**
 * Sit, then every distinct rung ascending. Built from the spread's units, not
 * its row order, so a hand-edited spread (unsorted, repeated units) still offers
 * each bet once.
 */
export function betSizingOptions(spread: readonly SpreadRow[]): BetAnswer[] {
  return ['sit', ...spreadSteps(spread)];
}

/**
 * D1: wherever the spread calls only for its minimum, the answer is Sit, so the
 * minimum rung itself is never the answer. Otherwise the rung the spread calls.
 */
export function correctBetAnswer(tc: number, spread: readonly SpreadRow[]): BetAnswer {
  return sitOutIsCorrect(tc, spread) ? 'sit' : spreadUnitsFor(tc, spread);
}

/**
 * Play's verdict on this action. Sitting out emits one wong event; betting emits
 * a bet event (a neighbouring rung passes with cover on) AND a wong event for
 * dealing in. A bet is right only when both are, which is why the minimum rung
 * is wrong wherever Sit is right.
 *
 * Graded by the spread even when the profile has `betSpreadOn` off (Play grades
 * nothing then): practising the ramp is the drill's purpose.
 */
export function gradeBetSizing(taken: BetAnswer, tc: number, p: BetGradeProfile): boolean {
  const shouldSit = sitOutIsCorrect(tc, p.spread);
  if (taken === 'sit') return shouldSit;
  const expected = spreadUnitsFor(tc, p.spread);
  const betOk = p.coverBets ? betWithinStep(taken, expected, p.spread) : taken === expected;
  return betOk && !shouldSit;
}

/**
 * One physically consistent draw, as the old Bet or sit drill drew it: a tray on
 * an exact half deck, and a running count no larger than about two per dealt
 * deck. No true-count clamp: the count is whatever that RC and depth give.
 */
function drawScenario(rng: () => number, totalDecks: number): BetSizingScenario {
  const decksRemaining = 0.5 * (1 + Math.floor(rng() * totalDecks * 2));
  const decksDealt = totalDecks - decksRemaining;
  const rcMax = Math.round(2 * decksDealt) + 1;
  const rc = -rcMax + Math.floor(rng() * (2 * rcMax + 1));
  return { rc, cardsDealt: decksDealt * 52, totalDecks };
}

/** Redraws allowed when looking for the answer a scenario was picked to have. */
const BALANCE_REDRAWS = 100;

/**
 * A seeded scenario, balanced by answer. Raw draws cluster near a neutral count,
 * so most would be Sit and tapping Sit every time would score well. The target
 * answer is picked first, evenly from Sit and every rung above the minimum (the
 * minimum is never the answer, see `correctBetAnswer`), then draws repeat until
 * one has it. A rung the shoe cannot reach keeps the last draw, so this always
 * terminates, including on a one-row spread whose only answer is Sit.
 *
 * Balanced under the default (floor) rounding; the drill still grades every
 * scenario at the profile's own rounding.
 */
export function makeBetSizingScenario(
  seed: number,
  totalDecks: number,
  spread: readonly SpreadRow[],
): BetSizingScenario {
  const rng = mulberry32(seed);
  const targets: BetAnswer[] = ['sit', ...spreadSteps(spread).slice(1)];
  const want = targets[Math.floor(rng() * targets.length)];
  let s = drawScenario(rng, totalDecks);
  for (let i = 0; i < BALANCE_REDRAWS && correctBetAnswer(scenarioTc(s), spread) !== want; i++) {
    s = drawScenario(rng, totalDecks);
  }
  return s;
}

/** "Sit", "4u". */
export function betAnswerLabel(a: BetAnswer): string {
  return a === 'sit' ? 'Sit' : `${a}u`;
}

/** The result strip: "RC +7 ÷ 2.5 decks → TC +2 → 4u", with real minus signs. */
export function betSizingWorking(s: BetSizingScenario, p: BetGradeProfile): string {
  const decks = scenarioDecksRemaining(s);
  const tc = scenarioTc(s, p.tcRounding);
  const depth = decks === 1 ? '1 deck' : `${decks} decks`;
  return `RC ${signed(s.rc)} ÷ ${depth} → TC ${signed(tc)} → ${betAnswerLabel(correctBetAnswer(tc, p.spread))}`;
}

/** The Stats row for one answer (contract 1). */
export function betSizingRow(s: BetSizingScenario, p: BetGradeProfile, taken: BetAnswer, date: string): BetSizingRow {
  const tc = scenarioTc(s, p.tcRounding);
  return {
    date,
    rc: s.rc,
    decksRemaining: scenarioDecksRemaining(s),
    tc,
    taken,
    correct: correctBetAnswer(tc, p.spread),
    ok: gradeBetSizing(taken, tc, p),
  };
}

/** Pure: a new Stats with the row appended, starting the section when absent. */
export function appendBetSizingRow(stats: Stats, row: BetSizingRow): Stats {
  return { ...stats, betSizing: { history: [...(stats.betSizing?.history ?? []), row] } };
}
