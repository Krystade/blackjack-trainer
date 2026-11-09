import { mulberry32 } from '../engine/cards';

export type DistractionMode = 'near-count' | 'generic';

/**
 * Owner 2026-11-09: how hard the arithmetic is, for the Count drill and Play
 * alike. 'normal' is the sums as they were before the choice existed, drawn
 * from the seed in the same order, so a stored run replays unchanged.
 *
 * - easy: one small step. Generic is a single-digit sum (2..9 + 2..9);
 *   near-count is an operand near the count, plus or minus 1..4.
 * - hard: two-digit work, every answer within +/-99 so a spoken answer is
 *   still one the voice parser accepts (voiceNumber.ts MAX_COUNT). Generic is
 *   a two-digit sum, a two-digit difference, or a teen times a single digit;
 *   near-count is an operand near the count times 3..9, or plus or minus a
 *   two-digit number.
 *
 * Always two operands and one operator, the shape every prompt parser and the
 * spoken form (distractionSpeech) read.
 */
export type DistractionDifficulty = 'easy' | 'normal' | 'hard';

/** Hard answers stay sayable: voiceNumber.ts refuses anything past 99. */
const HARD_MAX_ANSWER = 99;

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

/** An integer in [lo, hi]. */
function between(rng: () => number, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

/** Easy near-count: one operand near the count, then a small step either way. */
function makeNearCountEasy(runningCount: number, rng: () => number): Distraction {
  const a = runningCount + between(rng, -2, 2);
  const b = between(rng, 1, 4);
  const op: '+' | '-' = rng() < 0.5 ? '+' : '-';
  return { prompt: buildPrompt(a, op, b), answer: op === '+' ? a + b : a - b, kind: 'near-count' };
}

/**
 * Hard near-count: an operand near the count times 3..9, or plus/minus a
 * two-digit number. The multiplier is capped so the product stays within
 * HARD_MAX_ANSWER; an operand too close to zero to make a product worth the
 * name (or too far out for any multiplier to fit) takes the two-digit step.
 */
function makeNearCountHard(runningCount: number, rng: () => number): Distraction {
  const a = runningCount + between(rng, -3, 3);
  const maxMult = Math.min(9, Math.floor(HARD_MAX_ANSWER / Math.max(1, Math.abs(a))));
  if (rng() < 0.5 && Math.abs(a) >= 2 && maxMult >= 3) {
    const b = between(rng, 3, maxMult);
    return { prompt: buildPrompt(a, '×', b), answer: a * b, kind: 'near-count' };
  }
  const op: '+' | '-' = rng() < 0.5 ? '+' : '-';
  // Keep |a ± b| within the cap when the count allows it (it always does at a real table).
  const room = HARD_MAX_ANSWER - Math.abs(a);
  const b = between(rng, 11, Math.max(11, Math.min(39, room)));
  return { prompt: buildPrompt(a, op, b), answer: op === '+' ? a + b : a - b, kind: 'near-count' };
}

/** Easy generic: a single-digit sum. */
function makeGenericEasy(rng: () => number): Distraction {
  const a = between(rng, 2, 9);
  const b = between(rng, 2, 9);
  return { prompt: buildPrompt(a, '+', b), answer: a + b, kind: 'generic' };
}

/** Hard generic: a two-digit sum or difference, or a teen times a single digit, all within 99. */
function makeGenericHard(rng: () => number): Distraction {
  const pick = rng();
  if (pick < 1 / 3) {
    const a = between(rng, 12, 49);
    const b = between(rng, 12, 49);
    return { prompt: buildPrompt(a, '+', b), answer: a + b, kind: 'generic' };
  }
  if (pick < 2 / 3) {
    const a = between(rng, 30, 99);
    const b = between(rng, 11, a - 11);
    return { prompt: buildPrompt(a, '-', b), answer: a - b, kind: 'generic' };
  }
  const a = between(rng, 12, 19);
  const b = between(rng, 3, Math.floor(HARD_MAX_ANSWER / a));
  return { prompt: buildPrompt(a, '×', b), answer: a * b, kind: 'generic' };
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
export function makeDistraction(
  runningCount: number,
  mode: DistractionMode,
  seed?: number,
  difficulty: DistractionDifficulty = 'normal',
): Distraction {
  const rng = mulberry32(seed ?? Date.now());
  if (mode === 'near-count') {
    if (difficulty === 'easy') return makeNearCountEasy(runningCount, rng);
    if (difficulty === 'hard') return makeNearCountHard(runningCount, rng);
    return makeNearCount(runningCount, rng);
  }
  if (difficulty === 'easy') return makeGenericEasy(rng);
  if (difficulty === 'hard') return makeGenericHard(rng);
  return makeGeneric(rng);
}

/**
 * The prompt as it is said aloud (eyes-free Count drill). Signs and the
 * times sign are spoken as words rather than left to the voice's punctuation
 * handling, which reads "-3" inconsistently and "×" not at all on some voices
 * -- the same reason speakableCount spells out the count's sign. A negative
 * second operand, printed "(-6)", is said "negative 6" so "7 - (-6)" is not
 * heard as "7 minus minus 6".
 */
export function distractionSpeech(prompt: string): string {
  const m = /^(-?\d+) ([+\-×]) \(?(-?\d+)\)?$/.exec(prompt);
  if (!m) return prompt;
  const first = m[1]!.startsWith('-') ? `minus ${m[1]!.slice(1)}` : m[1]!;
  const op = m[2] === '+' ? 'plus' : m[2] === '-' ? 'minus' : 'times';
  const second = m[3]!.startsWith('-') ? `negative ${m[3]!.slice(1)}` : m[3]!;
  return `${first} ${op} ${second}`;
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
 * shown) should be interrupted by a distraction.
 *
 * RV5 (red-team v2, docs/BACKLOG.md): the cadence is JITTERED, not a fixed
 * every-Nth. A predictable "every 7th card" lets the learner pre-buffer the
 * count right before each interruption, defeating the divided-attention
 * training. Instead the stream is partitioned into windows of `interval`
 * cards and EXACTLY ONE distraction fires per window, on a pseudo-random
 * position within it (seeded by the window index, so it's deterministic per
 * run and unit-testable but unpredictable to the counter). The average rate
 * is unchanged (~1 per `interval` cards). The very first card (index 0) never
 * triggers -- no running count worth quizzing yet.
 *
 * Wave A (s04): `runSeed` is the run's own seed. Seeded by the window index
 * alone, every run stopped on the same cards (5, 10, 18, 25, ...) and a regular
 * learned the rhythm. The run seed is mixed in, so each run has its own stops
 * and one run is still reproducible; 0 gives the old fixed positions.
 */
export function isDistractionPoint(shownIndex: number, freq: DistractionFreq, runSeed = 0): boolean {
  if (freq === 'off') return false;
  return isDistractionPointEvery(shownIndex, FREQ_INTERVAL[freq], runSeed);
}

/**
 * isDistractionPoint at any window size: exactly one stop per `interval`
 * indices, jittered and seeded as above. Play's frequency choice
 * (ui/playDistraction.ts) uses windows the Count drill's two settings do not.
 */
export function isDistractionPointEvery(shownIndex: number, interval: number, runSeed = 0): boolean {
  if (shownIndex < 0 || !(interval >= 2)) return false;
  const windowIndex = Math.floor(shownIndex / interval);
  const seed = ((windowIndex * 0x9e3779b1 + 1) ^ Math.imul(runSeed | 0, 0x85ebca6b)) >>> 0;
  let firePos = Math.floor(mulberry32(seed)() * interval);
  // Never interrupt the very first card: if window 0's chosen slot is 0, nudge
  // it forward so the first distraction lands at index >= 1.
  if (windowIndex === 0 && firePos === 0) firePos = 1;
  return shownIndex % interval === firePos;
}

/** Owner 2026-11-09: one line per difficulty, the same under Play's gear and the Count drill's options. */
export const DIFFICULTY_NOTES: Record<DistractionDifficulty, string> = {
  easy: 'Single-digit sums, like 4 + 7.',
  normal: 'Sums and times tables up to 12, like 8 × 7.',
  hard: 'Two-digit sums and differences, and teens times a digit, like 17 × 5.',
};
