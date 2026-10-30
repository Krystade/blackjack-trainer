import { MINUS } from '../drills/signed';
import type { Card } from '../engine/cards';
import { hiLoTag } from '../engine/count';

/**
 * R7 (docs/BACKLOG.md, count-peek accountability): format the "this session's
 * accuracy was peek-assisted" flag from a session's peek count. The RC/TC peek
 * button is a legitimate training aid we deliberately keep available in both
 * modes (RT#5's fix is accountability, not removal) -- so instead of hiding the
 * button we surface a flag whenever peeks were used, making a test-mode
 * accuracy number impossible to mistake for an unassisted one.
 *
 * Returns `null` for the common, unassisted case (0 / undefined / any
 * non-positive count) so callers render nothing at all -- a "0 peeks" badge
 * would clutter the UI for the overwhelmingly common path. `undefined` is the
 * legacy shape: sessions persisted before R7 simply lack the field.
 */
export function assistedFlag(peeks: number | undefined): string | null {
  if (!peeks || peeks <= 0) return null;
  return `assisted — used ${peeks} peek${peeks === 1 ? '' : 's'}`;
}

/** A signed number at a fixed precision, with zero unsigned ("0.0", never
 * "-0.0" or "+0.0"). Rounded BEFORE the sign is chosen, so -0.04 is zero. */
export function signedFixed(n: number, digits: number): string {
  const text = Math.abs(n).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${n < 0 ? MINUS : '+'}${text}`;
}

export interface PeekReadout {
  /** "RC +5 · TC +1.4" */
  counts: string;
  /** "3.62 decks left" */
  depth: string;
  /** The whole line: "RC +5 · TC +1.4 · 3.62 decks left" */
  text: string;
}

/**
 * #41: what a held peek shows. The true count is the EXACT quotient to one
 * decimal and the depth is the real shoe to two, so the peek is a reference
 * to check an estimate against -- not the graded, convention-rounded TC
 * (that one divides by a half-deck estimate; see Game.trueCountNow).
 */
export function peekReadout(runningCount: number, decksLeft: number): PeekReadout {
  const tc = decksLeft > 0 ? runningCount / decksLeft : 0;
  const counts = `RC ${signedFixed(runningCount, 0)} · TC ${signedFixed(tc, 1)}`;
  const depth = `${Math.max(0, decksLeft).toFixed(2)} decks left`;
  return { counts, depth, text: `${counts} · ${depth}` };
}

/**
 * Wave L C-extra follow-up: the count and depth as the FELT shows them. Bots
 * resolve inside act(), so while their turns are still being paced onto the
 * table the engine's running count already includes cards not drawn on
 * screen. Those come back out of the count and back into the shoe.
 */
export function peekOnFelt(runningCount: number, decksLeft: number, unseen: readonly Card[]): { runningCount: number; decksLeft: number } {
  let rc = runningCount;
  for (const c of unseen) rc -= hiLoTag(c.rank);
  return { runningCount: rc, decksLeft: decksLeft + unseen.length / 52 };
}
