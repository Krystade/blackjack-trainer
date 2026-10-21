import { RANKS } from '../cards';
import { hiLoTag } from '../count';
import { fullComp } from './comp';
import type { Comp } from './comp';
import { sideBetEv } from './odds';
import type { OddsOptions } from './odds';
import type { PayTable, SideBetId } from './payTables';

/**
 * Wave L: EFFECTS OF REMOVAL, and the count they imply.
 *
 * The effect of removal of a rank is how much the bet's expected return
 * changes when one card of that rank leaves a full shoe (averaged over its
 * four suits): computed exactly, from the same closed forms that give the
 * house edge. A positive effect means the bet gets better without that card,
 * so seeing it should push a count UP -- the Hi-Lo convention, where a seen
 * low card is +1 because blackjack gets better without it.
 *
 * From the effects come two things:
 *   - the BETTING CORRELATION of any tag set with the bet (Griffin's measure:
 *     the correlation of the tags with the effects, over the thirteen ranks,
 *     each equally common in a deck), so Hi-Lo and a published count can be
 *     scored against the computed effects; and
 *   - a dedicated LEVEL-1 or LEVEL-2 tag set: the effects scaled and rounded
 *     to whole numbers, balanced (a full deck sums to zero, so a true count
 *     means the same thing at every depth), at the scale that correlates best.
 */

export const RANK_COUNT = 13;

/** Hi-Lo's tags, thirteen ranks in RANKS order. */
export const HI_LO_TAGS: readonly number[] = RANKS.map((r) => hiLoTag(r));

/** The bet's expected return per unit with one card of each rank gone, less the full shoe's. */
export function effectsOfRemoval(bet: SideBetId, pays: PayTable['pays'], decks: number, opts: OddsOptions = {}): number[] {
  const base: Comp = fullComp(decks);
  const ev0 = sideBetEv(bet, pays, base, opts);
  const out: number[] = [];
  for (let r = 0; r < RANK_COUNT; r++) {
    let sum = 0;
    for (let s = 0; s < 4; s++) {
      base[r * 4 + s]! -= 1;
      sum += sideBetEv(bet, pays, base, opts) - ev0;
      base[r * 4 + s]! += 1;
    }
    out.push(sum / 4);
  }
  return out;
}

/** Pearson correlation over the thirteen ranks (each equally common). */
export function bettingCorrelation(eor: readonly number[], tags: readonly number[]): number {
  const n = eor.length;
  const me = eor.reduce((a, b) => a + b, 0) / n;
  const mt = tags.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const x = eor[i]! - me;
    const y = tags[i]! - mt;
    sxy += x * y;
    sxx += x * x;
    syy += y * y;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Round `eor x scale` to whole tags within +/-level, then balance the deck to zero. */
function roundBalanced(eor: readonly number[], scale: number, level: number): number[] {
  const raw = eor.map((e) => e * scale);
  // `|| 0`: no -0 tags (a stored row reads them back as 0).
  const tags = raw.map((x) => Math.max(-level, Math.min(level, Math.round(x))) || 0);
  // Balance: move the tag whose rounding was furthest the wrong way, one step at a time.
  for (let guard = 0; guard < 4 * RANK_COUNT * level; guard++) {
    const sum = tags.reduce((a, b) => a + b, 0);
    if (sum === 0) break;
    const dir = sum > 0 ? -1 : 1;
    let best = -1;
    let bestGap = -Infinity;
    for (let i = 0; i < RANK_COUNT; i++) {
      const next = tags[i]! + dir;
      if (next < -level || next > level) continue;
      // How far the move takes the tag from its raw value, negated: prefer the cheapest.
      const gap = Math.abs(tags[i]! - raw[i]!) - Math.abs(next - raw[i]!);
      if (gap > bestGap + 1e-12) {
        bestGap = gap;
        best = i;
      }
    }
    if (best === -1) break;
    tags[best]! += dir;
  }
  return tags;
}

/**
 * The balanced level-`level` tag set that correlates best with the effects:
 * every scale at which some rank's rounding flips is tried, in order, and the
 * first best kept -- deterministic for given effects.
 */
export function deriveTags(eor: readonly number[], level: 1 | 2 | 3): { tags: number[]; correlation: number } {
  const maxAbs = Math.max(...eor.map(Math.abs));
  if (maxAbs === 0) return { tags: new Array<number>(RANK_COUNT).fill(0), correlation: 0 };
  let best: { tags: number[]; correlation: number } | null = null;
  const steps = 400;
  for (let i = 1; i <= steps; i++) {
    const scale = ((level + 0.5) * i) / steps / maxAbs;
    const tags = roundBalanced(eor, scale, level);
    if (tags.every((t) => t === 0)) continue;
    const correlation = bettingCorrelation(eor, tags);
    if (!best || correlation > best.correlation + 1e-9) best = { tags, correlation };
  }
  return best ?? { tags: new Array<number>(RANK_COUNT).fill(0), correlation: 0 };
}
