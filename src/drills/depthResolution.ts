/**
 * V5-5 (docs/BACKLOG.md): how finely the discard tray is read, and how that
 * changes with depth.
 *
 * The app snapped to half decks everywhere and treated it as a constant -- the
 * Deck Estimation grid, its grading tolerance, and `EYE_DECK_ERROR` behind the
 * produce-TC band. Half a deck is the right DEFAULT (nobody looks at a stack of
 * plastic and thinks "2.3 decks") but it is wrong as a fixed CEILING in the last
 * deck, where the same misread costs far more: with half a deck left, reading
 * the tray half a deck wrong moves the true count by the entire running count,
 * while at five decks it barely moves it at all. The reference tool (Casino
 * Vérité) makes exactly this a separate option -- *"It is easier and more
 * important to estimate the remaining decks when you are in the last deck of a
 * shoe ... This option allows you to force a better estimate during the last
 * deck."*
 *
 * THREE STATES, NOT TWO SETTINGS. The obvious shape is a resolution choice plus
 * a "tighten in the last deck" toggle, but that has a dead cell: at quarter-deck
 * resolution the tightening has nothing left to tighten. One three-way choice
 * has no dead cell and needs no explanation of when the toggle does nothing.
 */
export type DepthResolution = 'half' | 'last-deck' | 'quarter';

/** The app's historical behaviour, and still the default. */
export const DEFAULT_DEPTH_RESOLUTION: DepthResolution = 'half';

const HALF = 0.5;
const QUARTER = 0.25;

/**
 * Within this much of the end of the shoe, 'last-deck' resolution bites.
 *
 * One deck, taken literally from the option's own name. It is also where the
 * arithmetic turns: at a deck or less the divisor is small enough that a
 * half-deck error is a whole-integer error in the true count.
 */
export const LAST_DECK_DECKS = 1;

/**
 * The grid step -- and the grading tolerance -- that applies at this depth.
 *
 * THE TOLERANCE IS THE STEP. That is not a coincidence to be tidied away later;
 * it is what makes the drill answerable. The nearest option to any real depth is
 * at most half a step away, so a tolerance of one full step always admits at
 * least one option, at every depth, in every shoe size. Loosen the step without
 * loosening the tolerance and there are depths no legal answer can reach.
 * `depthResolution.test.ts` asserts that across the whole achievable domain.
 *
 * Both steps are negative powers of two, so every multiple of them is exact in
 * binary and none of the arithmetic here needs an epsilon.
 */
export function depthStep(decksRemaining: number, resolution: DepthResolution): number {
  if (resolution === 'quarter') return QUARTER;
  if (resolution === 'last-deck' && decksRemaining <= LAST_DECK_DECKS) return QUARTER;
  return HALF;
}

/**
 * How far a depth estimate may be off at this depth and still count.
 *
 * A separate name for `depthStep` because callers mean a different thing by it,
 * and because if the two ever have to diverge this is the one that moves. See
 * the note on `depthStep` for why they are equal today.
 */
export function depthTolerance(decksRemaining: number, resolution: DepthResolution): number {
  return depthStep(decksRemaining, resolution);
}

/**
 * Every decks-remaining value the answer grid offers, ascending.
 *
 * Built from the FINEST step in play and then filtered by what is legal at each
 * value's own depth, so 'last-deck' yields quarter steps up to one deck and half
 * steps above it -- 14 buttons in a 6-deck shoe rather than 24.
 *
 * The grid is a function of the SETTING, never of the question, which is what
 * keeps it from leaking the answer. A grid that grew quarter options only when
 * the question happened to land in the last deck would announce the answer
 * before the player looked at the tray.
 */
export function depthOptions(totalDecks: number, resolution: DepthResolution): number[] {
  const finest = resolution === 'half' ? HALF : QUARTER;
  const out: number[] = [];
  for (let i = 1; i * finest <= totalDecks; i++) {
    const value = i * finest;
    // Keep it only if it is a legal multiple of the step at its OWN depth --
    // 1.25 is a quarter step but sits outside the last deck, where the grid
    // runs in halves.
    if (Number.isInteger(value / depthStep(value, resolution))) out.push(value);
  }
  return out;
}

/** True when the last-deck rule is what tightened this depth. Used to explain a grade. */
export function isLastDeckTightened(
  decksRemaining: number,
  resolution: DepthResolution,
): boolean {
  return resolution === 'last-deck' && decksRemaining <= LAST_DECK_DECKS;
}

/**
 * A depth written the way the drill talks about it: "half a deck", "a quarter
 * deck", "1.5 decks". Used in result copy, which previously hardcoded the
 * phrase "a half-deck either way" and would have lied under any other setting.
 */
export function formatDepthSlack(decks: number): string {
  if (decks === HALF) return 'half a deck';
  if (decks === QUARTER) return 'a quarter deck';
  return `${decks} decks`;
}
