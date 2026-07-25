/**
 * Pure speed math for the count drill's TIMED / speed-ramp challenge (see
 * docs/research/2026-07-21-priority-list.md item 6). Deliberately has zero
 * dependency on wall-clock time (no `Date.now()`/`performance.now()` here)
 * so it stays trivially unit-testable -- the live UI (CountDrillView.tsx)
 * is responsible for reading the actual clock and feeding elapsed
 * milliseconds in.
 */

/**
 * Speed tier for a count-down run, in the vocabulary poker/blackjack
 * counting communities actually use.
 */
export type SpeedTier = 'learning' | 'table-ready' | 'pro' | 'expert';

/**
 * Classifies a seconds-per-52-card-deck figure into a SpeedTier.
 *
 * Cutoffs (sourced from docs/research/2026-07-21-priority-list.md item 6 /
 * the landscape + pain-point reports): the widely-repeated "table-ready"
 * benchmark is <=30s to count down a full deck; ~20-25s is commonly cited
 * as "pro" tier; ~8s is an oft-cited record. This picks clean round-number
 * cutoffs within those cited bands rather than the exact edges, so the tier
 * boundaries are memorable and defensible on their own:
 *
 *   >  30s  -> 'learning'     still building the skill
 *   <= 30s  -> 'table-ready'  the headline benchmark
 *   <= 22s  -> 'pro'          middle of the commonly-cited 20-25s band
 *   <= 12s  -> 'expert'       comfortably ahead of pro, short of the ~8s record
 *
 * Every boundary is inclusive on the FAST side -- exactly 30s counts as
 * table-ready (not learning), exactly 22s counts as pro, exactly 12s counts
 * as expert.
 */
export function classifySpeed(secondsPerDeck: number): SpeedTier {
  if (secondsPerDeck <= 12) return 'expert';
  if (secondsPerDeck <= 22) return 'pro';
  if (secondsPerDeck <= 30) return 'table-ready';
  return 'learning';
}

/**
 * Normalises an arbitrary-length timed run to a seconds-per-52-card-deck
 * figure, so a 13-card sprint and a 312-card (6-deck) marathon land on the
 * same comparable scale as the well-known "count a deck in N seconds"
 * benchmark. `cardsShown` is the actual card count shown during the run
 * (not the group count -- a group of 3 cards counts as 3 here).
 *
 * Returns 0 for a non-positive cardsShown rather than dividing by zero or
 * returning Infinity/NaN, since a run that showed no cards has no speed to
 * report.
 */
export function secondsPerDeck(elapsedMs: number, cardsShown: number): number {
  if (cardsShown <= 0) return 0;
  const msPerCard = elapsedMs / cardsShown;
  return (msPerCard * 52) / 1000;
}

/**
 * Formats a millisecond duration as a one-decimal-place seconds string,
 * e.g. `formatDuration(12_400)` -> `"12.4s"`. Clamps negative input to 0 so
 * a caller can never render a nonsensical negative duration.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return `${seconds.toFixed(1)}s`;
}

/** Never speed up past this many ms/card -- below this, the display simply
 * isn't legible/actionable, ramp or no ramp. */
export const RAMP_FLOOR_MS = 150;

/** Default per-card decay: each successive card's interval is 97% of the
 * previous one (a gentle ~3%/card speed-up -- "obvious but not brutal"). */
const DEFAULT_RAMP_DECAY = 0.97;

/**
 * Computes the display interval (ms) for the card at `cardIndex` (0-based)
 * in a timed/ramped run: starts at `startMs` for card 0 and decays
 * geometrically by `decay` per card thereafter, floored at `floorMs` so the
 * ramp can never become physically unreadable. Monotonically
 * non-increasing in `cardIndex` for any fixed `startMs`/`decay`/`floorMs`.
 *
 * A negative `cardIndex` is treated as 0 (defensive -- never speeds up on
 * bad input). `startMs` itself may already be at/below `floorMs`, in which
 * case every card in the run is displayed at the floor.
 */
export function rampIntervalMs(
  cardIndex: number,
  startMs: number,
  opts?: { decay?: number; floorMs?: number },
): number {
  const decay = opts?.decay ?? DEFAULT_RAMP_DECAY;
  const floorMs = opts?.floorMs ?? RAMP_FLOOR_MS;
  const clampedIndex = Math.max(0, cardIndex);
  const decayed = startMs * Math.pow(decay, clampedIndex);
  return Math.max(floorMs, Math.round(decayed));
}

/** Converts a "count a 52-card deck in N seconds" benchmark into a per-card
 * millisecond interval -- the inverse of `secondsPerDeck`'s own
 * `msPerCard * 52 / 1000` conversion, kept private since callers only ever
 * need the per-tier mapping below, not the raw conversion. */
function msPerCardForDeckSeconds(deckSeconds: number): number {
  return Math.round((deckSeconds * 1000) / 52);
}

/**
 * Maps a SpeedTier (drills/competenceGate.ts's unlocked-tier gate) to the
 * starting per-card pace (ms) a run at that tier should use -- the single
 * source of truth for "how fast does earning tier X let you go", so the
 * timed drill's adaptive mode (CountDrillView.tsx) and the competence gate
 * never drift apart on what a tier's pace actually means.
 *
 * 'learning' has no natural upper cutoff in `classifySpeed` (anything slower
 * than table-ready's 30s/deck is simply "learning"), so its pace is pinned
 * to the existing shipped default (`DEFAULT_SETTINGS.drill.countTimedStartMs`,
 * 900ms) rather than derived from a boundary that doesn't exist. The other
 * three tiers are derived directly from `classifySpeed`'s own tested cutoffs
 * (<=30s table-ready, <=22s pro, <=12s expert) converted to ms/card, so
 * raising/lowering those cutoffs automatically keeps this mapping in sync.
 */
export function tierStartIntervalMs(tier: SpeedTier): number {
  switch (tier) {
    case 'learning':
      return 900;
    case 'table-ready':
      return msPerCardForDeckSeconds(30);
    case 'pro':
      return msPerCardForDeckSeconds(22);
    case 'expert':
      return msPerCardForDeckSeconds(12);
  }
}
