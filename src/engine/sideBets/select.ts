import { bettingCorrelation, deriveTags, effectsOfRemoval, HI_LO_TAGS } from './eor';
import { HI_LO_COUNT, PUBLISHED_COUNTS } from './counts';
import type { SideCountDef } from './counts';
import type { PayTable, SideBetId } from './payTables';
import type { CountedResult, SideSimCount } from './sideSim';

/**
 * Wave L: WHICH COUNT a side bet is played with.
 *
 * Candidates, simplest first:
 *   1. Hi-Lo -- no second count at all, the true count already being kept;
 *   2. every other count by level (its highest tag): a level-1 count derived
 *      from the bet's effects of removal, the published counts (Jacobson),
 *      a level-2 derived count -- at equal level, a published count first;
 *   3. the suit spread, for the bets decided by suits (21+3, Royal Match).
 *
 * Each is simulated on the same rounds (sideSim.ts); the simplest that earns
 * at least NEARLY_AS_GOOD of the best one's units per 100 rounds is the one
 * used. A bet whose expectation is positive off the top needs no count; a
 * bet no candidate makes worth MIN_PER100 is not countable at that cut.
 */

export const NEARLY_AS_GOOD = 0.9;
/**
 * Below this many units per 100 rounds a count is not worth keeping: two
 * cents per hundred rounds on a $1 bet. A judgment about what is worth
 * training, not a strategy number -- it is what keeps a technically positive
 * corner (Perfect Pairs at Hi-Lo +8 deep in an eight-deck shoe: 0.007 units
 * per 100) from being offered as a count.
 */
export const MIN_PER100 = 0.02;

export interface Candidate extends CountedResult {
  def: SideCountDef;
  betBelow?: boolean;
  /** Betting correlation with the effects of removal ('tags' counts). */
  correlation: number | null;
}

export interface Choice {
  /** The bet is worth making every round: no count needed. */
  always: boolean;
  chosen: Candidate | null;
}

/** Highest tag in absolute value: a count's level. */
export const levelOf = (def: SideCountDef) => (def.kind === 'suit' ? 1 : Math.max(0, ...(def.tags ?? []).map(Math.abs)));

const SUIT_BETS: readonly SideBetId[] = ['twentyOnePlus3', 'royalMatch'];

/** The counts to simulate for one bet, simplest first, with their correlation to the effects. */
export function candidateCounts(
  bet: SideBetId,
  pays: PayTable['pays'],
  decks: number,
  s17: boolean,
): { counts: SideSimCount[]; correlation: (number | null)[]; eor: number[] } {
  const eor = effectsOfRemoval(bet, pays, decks, { s17 });
  const corr = (tags: readonly number[]) => bettingCorrelation(eor, tags);
  // Under 13 gets better as the count FALLS, so Hi-Lo there bets low.
  const hiLo = { c: { def: HI_LO_COUNT, betBelow: corr(HI_LO_TAGS) < 0 }, corr: corr(HI_LO_TAGS) };
  const l1 = deriveTags(eor, 1);
  const l2 = deriveTags(eor, 2);
  const derived = (level: 1 | 2, tags: number[]): SideCountDef => ({
    id: `level${level}`,
    name: `Level ${level} (computed)`,
    kind: 'tags',
    tags,
  });
  // [count, level, published first at equal level]
  const ranked: { c: SideSimCount; corr: number | null; level: number; pub: number }[] = [];
  if (l1.tags.some((t) => t !== 0)) ranked.push({ c: { def: derived(1, l1.tags) }, corr: l1.correlation, level: 1, pub: 1 });
  if (l2.tags.some((t) => t !== 0)) ranked.push({ c: { def: derived(2, l2.tags) }, corr: l2.correlation, level: 2, pub: 1 });
  for (const def of PUBLISHED_COUNTS[bet] ?? []) {
    if (def.kind === 'suit') continue;
    const below = def.publishedTrigger?.some((t) => t.betBelow) ?? false;
    ranked.push({ c: { def, betBelow: below }, corr: corr(def.tags ?? []), level: levelOf(def), pub: 0 });
  }
  ranked.sort((a, b) => a.level - b.level || a.pub - b.pub);
  const out: { c: SideSimCount; corr: number | null }[] = [hiLo, ...ranked];
  if (SUIT_BETS.includes(bet)) {
    const pub = (PUBLISHED_COUNTS[bet] ?? []).find((d) => d.kind === 'suit');
    out.push({ c: { def: pub ?? { id: 'suit', name: 'Suit spread', kind: 'suit' } }, corr: null });
  }
  return { counts: out.map((o) => o.c), correlation: out.map((o) => o.corr), eor };
}

/** The simplest candidate nearly as good as the best (see above). */
export function chooseCount(evTop: number, candidates: readonly Candidate[]): Choice {
  if (evTop > 0) return { always: true, chosen: null };
  const valid = candidates.filter((c) => c.trigger !== null && c.per100 >= MIN_PER100);
  if (valid.length === 0) return { always: false, chosen: null };
  const best = Math.max(...valid.map((c) => c.per100));
  const chosen = valid.find((c) => c.per100 >= NEARLY_AS_GOOD * best) ?? null;
  return { always: false, chosen };
}
