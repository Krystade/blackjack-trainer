import { mulberry32 } from '../engine/cards';

export type DistractionMode = 'near-count' | 'generic';

export interface Distraction {
  prompt: string;
  answer: number;
  kind: DistractionMode;
}

// How close (in either direction) a near-count operand is allowed to land
// to the running count. The operator's key insight (docs/BACKLOG.md D1):
// this is what makes the arithmetic maximally confusable with the count the
// user is holding in their head -- e.g. count +7 -> operands like 8 and 6.
const NEAR_COUNT_WINDOW = 3;

// Generic (table-talk simulacrum) operand range -- small, fixed, and
// deliberately NOT derived from runningCount, since the whole point of this
// mode is arithmetic that occupies the verbal loop without number-adjacency.
const GENERIC_MIN = 2;
const GENERIC_MAX = 12;

/**
 * Prints a possibly-negative operand. A negative value is wrapped in
 * parentheses -- e.g. "(-6)" -- so a near-count prompt like "-3 - (-6)"
 * never produces an ambiguous raw "- -6" double-sign, while still showing
 * the operand's true (near-count) value rather than distorting it to stay
 * unwrapped.
 */
function formatOperand(n: number): string {
  return n < 0 ? `(${n})` : `${n}`;
}

function buildPrompt(a: number, op: '+' | '-' | '×', b: number): string {
  return `${a} ${op} ${formatOperand(b)}`;
}

/**
 * near-count: both operands are the running count plus a small random
 * jitter in [-NEAR_COUNT_WINDOW, +NEAR_COUNT_WINDOW], combined with + or -.
 * This is the operator's key insight preserved exactly: at running count
 * +7, operands land near 7 (e.g. 8 and 6), so the arithmetic reads as a
 * confusable near-count answer -- the same failure mode real table-talk
 * produces. Negative counts fall out of the same construction (operands
 * near a negative count are themselves negative) rather than being special
 * cased.
 */
function makeNearCount(runningCount: number, rng: () => number): Distraction {
  const span = NEAR_COUNT_WINDOW * 2 + 1;
  const jitterA = Math.floor(rng() * span) - NEAR_COUNT_WINDOW;
  const jitterB = Math.floor(rng() * span) - NEAR_COUNT_WINDOW;
  const a = runningCount + jitterA;
  const b = runningCount + jitterB;
  const op: '+' | '-' = rng() < 0.5 ? '+' : '-';
  const answer = op === '+' ? a + b : a - b;
  return { prompt: buildPrompt(a, op, b), answer, kind: 'near-count' };
}

/**
 * generic: small multiplication/addition unrelated to the running count --
 * a table-talk simulacrum that occupies the verbal loop without the
 * number-adjacency that makes near-count distractions confusable.
 */
function makeGeneric(rng: () => number): Distraction {
  const range = GENERIC_MAX - GENERIC_MIN + 1;
  const a = GENERIC_MIN + Math.floor(rng() * range);
  const b = GENERIC_MIN + Math.floor(rng() * range);
  const op: '+' | '×' = rng() < 0.5 ? '+' : '×';
  const answer = op === '+' ? a + b : a * b;
  return { prompt: buildPrompt(a, op, b), answer, kind: 'generic' };
}

/**
 * Generates a single distraction challenge: either near-count arithmetic
 * (confusable with the running count the user is holding) or generic
 * arithmetic (a table-talk simulacrum unrelated to the count). Uses the
 * seeded mulberry32 idiom (see engine/cards.ts, countDrill.ts,
 * trueCountDrill.ts) so the same seed always reproduces the same
 * distraction.
 *
 * `answer` is always computed directly from the same operands printed in
 * `prompt` -- never independently -- so the generator can't drift from its
 * own displayed arithmetic.
 */
export function makeDistraction(runningCount: number, mode: DistractionMode, seed?: number): Distraction {
  const rng = mulberry32(seed ?? Date.now());
  return mode === 'near-count' ? makeNearCount(runningCount, rng) : makeGeneric(rng);
}

/**
 * D1 part 2 (docs/BACKLOG.md, distraction training): how often a count-drill
 * run's card advances get interrupted by a distraction. 'off' is the default
 * (see Settings.drill.distractionFreq) -- every existing test/e2e and all
 * default behavior is unchanged until a user opts in.
 */
export type DistractionFreq = 'off' | 'occasional' | 'relentless';

// Fixed cadence (cards shown between interruptions), not a probabilistic
// roll -- deterministic given only (shownIndex, freq), so a test/e2e never
// needs to fix a seed to know WHEN a distraction fires, only what it asks
// (still seeded via makeDistraction above). Maps the operator's ballparks
// (docs/BACKLOG.md D1: occasional "~15% of card advances or every ~7 cards",
// relentless "every ~3 cards") onto concrete intervals.
const FREQ_INTERVAL: Record<Exclude<DistractionFreq, 'off'>, number> = {
  occasional: 7,
  relentless: 3,
};

/**
 * True when the card advance FROM `shownIndex` (0-indexed, the card just
 * shown) should be interrupted by a distraction instead of proceeding
 * straight to the next card / the answer phase. Fires on the Nth card shown
 * (index N-1) for cadence N, so the very first card (index 0) never
 * triggers -- there's no running count worth quizzing yet with only one
 * card seen.
 */
export function isDistractionPoint(shownIndex: number, freq: DistractionFreq): boolean {
  if (freq === 'off') return false;
  return (shownIndex + 1) % FREQ_INTERVAL[freq] === 0;
}
