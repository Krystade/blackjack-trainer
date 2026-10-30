/**
 * #39: where the cut card goes, as cards left BEHIND it.
 *
 * The setting is "decks behind the cut" (Profile.cutDecks, 0.5-3) rather than
 * a penetration percentage, because that is what a player sees at a real
 * table: the slab of cards the dealer never reaches. With `cutVary` each shoe
 * moves the cut uniformly by up to CUT_VARY_DECKS either way, as a dealer's
 * hand placing the card does.
 */

/** How far, in decks, a varied cut moves either way. */
export const CUT_VARY_DECKS = 0.5;

/** The smallest number of decks ever left behind the cut, and the smallest
 * ever dealt before it. */
export const CUT_MIN_DECKS = 0.5;

/**
 * C4 (audit 2026-10-29): the casino simulator's own bound, in decks, on each
 * side of the cut. Play's half-deck rule (CUT_MIN_DECKS) is a table-feel
 * choice; reused by the simulator it pinned every single-deck game to exactly
 * half a deck, whatever cut was logged. A quarter deck (13 cards) behind the
 * cut and in front of it is room for a heads-up round, and a round that runs
 * the shoe dry is already handled (CasinoSim.draw reshuffles).
 */
export const SIM_CUT_MIN_DECKS = 0.25;

/** Decks behind the cut the simulator deals a logged cut at, clamped to [SIM_CUT_MIN_DECKS, shoe - SIM_CUT_MIN_DECKS]. */
export function simCutDecks(cutDecks: number, shoeDecks: number): number {
  const lo = SIM_CUT_MIN_DECKS;
  const hi = Math.max(lo, shoeDecks - SIM_CUT_MIN_DECKS);
  return Math.min(hi, Math.max(lo, cutDecks));
}

/** The part of a Profile the cut is read from (a Profile satisfies it). */
export interface CutSpec {
  penetration: number;
  cutDecks?: number;
  cutVary?: boolean;
  rules: { decks: number };
}

/**
 * Cards left behind the cut for ONE shoe. Absent `cutDecks` is derived from
 * `penetration` (decks * (1 - penetration)), so a profile stored before #39
 * keeps its depth. Varied or not, the result is clamped to
 * [CUT_MIN_DECKS, decks - CUT_MIN_DECKS] decks: a cut never sits in the last
 * half deck or the first.
 *
 * `rng` is read once per call, and only when `cutVary` is on.
 */
export function cutCardsFor(spec: CutSpec, rng: () => number): number {
  const decks = spec.rules.decks;
  let behind = spec.cutDecks ?? decks * (1 - spec.penetration);
  if (spec.cutVary) behind += (rng() * 2 - 1) * CUT_VARY_DECKS;
  const lo = CUT_MIN_DECKS;
  const hi = Math.max(lo, decks - CUT_MIN_DECKS);
  behind = Math.min(hi, Math.max(lo, behind));
  return Math.round(behind * 52);
}

/**
 * True when the cut card comes from `cutCardsFor` rather than the legacy
 * penetration fraction: a profile that has set `cutDecks` or turned on
 * `cutVary`. A profile with neither keeps the exact pre-#39 cut position.
 */
export function usesCutCards(spec: Pick<CutSpec, 'cutDecks' | 'cutVary'>): boolean {
  return spec.cutDecks !== undefined || spec.cutVary === true;
}

/** Salt for the cut-placement stream, so it is not the shoe's own shuffle
 * stream (see riggedShoe.ts's BOT_RNG_SALT for why that matters). */
const CUT_RNG_SALT = 0x85ebca6b;

export function cutRngSeed(gameSeed: number): number {
  return (gameSeed ^ CUT_RNG_SALT) >>> 0;
}
