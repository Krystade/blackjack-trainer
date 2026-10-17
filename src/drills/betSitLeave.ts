import { mulberry32 } from '../engine/cards';
import { DEFAULT_SPREAD, type SpreadRow } from '../engine/game';
import { firstRaiseTc, sitOutIsCorrect } from '../engine/wong';

/**
 * ET3 (docs/BACKLOG.md, experiential training): the bet / sit-out decision
 * drill. #48-51 (2026-10-13) dropped the third "leave the table" answer: the
 * drill asks only bet vs sit. Old Stats rows with 'leave' are kept and still
 * render; see Stats.tsx.
 *
 * A scenario is a snapshot: the (floored) true count and decks remaining in
 * the shoe. Pure/seeded so it's reproducible and unit-testable.
 */

export type TableAction = 'bet' | 'sit';

export interface BetSitLeaveScenario {
  /** Floored true count (matches the app's TC convention). */
  trueCount: number;
  /** Decks remaining in the shoe (0.5-deck increments). */
  decksRemaining: number;
}

/**
 * Wave A, decision D1: the drill grades by the PROFILE'S SPREAD, through the
 * very function Play grades its wong decision with (engine/wong.ts). It used
 * a fixed consensus line (TC >= 0 bets), so the two screens disagreed at TC 0
 * under the default ramp: Play said sit, the drill said bet. Absent a spread,
 * the default ramp -- the one a new profile carries.
 */
export function correctAction(
  s: BetSitLeaveScenario,
  spread: readonly SpreadRow[] = DEFAULT_SPREAD,
): TableAction {
  return sitOutIsCorrect(s.trueCount, spread) ? 'sit' : 'bet';
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

/** Short reason for the correct action, for post-answer feedback. */
export function explainAction(
  s: BetSitLeaveScenario,
  spread: readonly SpreadRow[] = DEFAULT_SPREAD,
): string {
  const raise = firstRaiseTc(spread);
  if (correctAction(s, spread) === 'bet') return 'Your ramp bets above its minimum here: play.';
  if (raise === null) return 'Your ramp never bets above its minimum: sit out.';
  return `Your ramp raises from TC ${signed(raise)}: below that, sit out.`;
}

/**
 * V4-3 (docs/BACKLOG.md): the shoe size comes from the ACTIVE PROFILE.
 *
 * This was a hardcoded 6, in the module AND separately in its view, while the
 * app happily runs 1-, 2-, 6- and 8-deck profiles. A double-deck player was
 * being drilled on 6-deck conversions: the divisor range they actually face is
 * 0.5-2, and every question they ever saw ran to 6. Defaulted rather than
 * required, so existing callers and tests are unchanged.
 */
const DEFAULT_TOTAL_DECKS = 6;
const TC_CLAMP = 6; // realistic true-count bound

/**
 * Generate a seeded, PHYSICALLY-CONSISTENT decision scenario (V3-3 fix): the
 * true count is derived from a plausible running count bounded by how much of
 * the shoe has been dealt, so a big |TC| only occurs deep in the shoe — never
 * an impossible "TC -4 with a near-full shoe". Decks-remaining in 0.5-deck steps
 * over the profile's own shoe. Early shoes stay near neutral (a sit on the
 * default ramp, which raises from +1); big counts either way happen deeper.
 */
export function makeBetSitLeaveScenario(
  seed?: number,
  totalDecks: number = DEFAULT_TOTAL_DECKS,
): BetSitLeaveScenario {
  const rng = mulberry32(seed ?? Date.now());
  // Half-deck steps across the whole shoe: 0.5 .. totalDecks. This 12 was
  // also a hardcoded 6 (as totalDecks * 2); left alone it would have produced
  // a 6-deck depth inside a 2-deck shoe, i.e. a NEGATIVE dealt count feeding
  // the running-count bound below.
  const decksRemaining = 0.5 * (1 + Math.floor(rng() * (totalDecks * 2)));
  const decksDealt = totalDecks - decksRemaining;
  // Running count can only have swung as far as the dealt cards allow; ~±2 per
  // dealt deck is already an extreme, so it bounds the plausible spread.
  const rcMax = Math.round(2 * decksDealt) + 1;
  const runningCount = -rcMax + Math.floor(rng() * (2 * rcMax + 1));
  // App convention: floored true count. Clamp to a realistic band.
  const rawTc = Math.floor(runningCount / decksRemaining);
  const trueCount = Math.max(-TC_CLAMP, Math.min(TC_CLAMP, rawTc));
  return { trueCount, decksRemaining };
}
