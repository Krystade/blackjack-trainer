import type { Deviation, DeviationId } from '../engine/deviations';
import type { IndexRecentEntry } from '../store/types';
import { publishedIndex } from './indexDisplay';

/**
 * Owner 2026-11-06: indices learned a count at a time.
 *
 * "When I try and use it I either have to select one index to practice which
 * is too easy or all of them ... I don't know more than like 1 or 2 so I'm
 * just constantly guessing and not actually learning anything new."
 *
 * So the quiz has a learning path. The indices are grouped by their published
 * number ("+3: insurance, 12 v 2 stand, 10 v A double, 9 v 7 double"), the
 * groups are taken in order of their most valuable index (the set is ranked,
 * Illustrious 18 first), and the quiz asks the group being learned plus a
 * share of the ones already learned. A group is learned when every index in
 * it has its last LEARNED_STREAK answers right; then the next group opens.
 */

export interface IndexGroup {
  /** The published index: the count the play changes at. */
  value: number;
  ids: DeviationId[];
}

/** Every group, highest count first (+5 ... 0 ... -3). Within a group, set order. */
export function groupByIndex(devs: readonly Deviation[]): IndexGroup[] {
  const byValue = new Map<number, DeviationId[]>();
  for (const d of devs) {
    const v = publishedIndex(d);
    byValue.set(v, [...(byValue.get(v) ?? []), d.id]);
  }
  return [...byValue.entries()].sort((a, b) => b[0] - a[0]).map(([value, ids]) => ({ value, ids }));
}

/** The order the path takes the groups in: by each group's most valuable index. */
export function learningOrder(devs: readonly Deviation[]): IndexGroup[] {
  const rank = new Map(devs.map((d, i) => [d.id, i]));
  return groupByIndex(devs).sort(
    (a, b) => Math.min(...a.ids.map((id) => rank.get(id)!)) - Math.min(...b.ids.map((id) => rank.get(id)!)),
  );
}

/** Right this many times in a row, most recent answers, and an index is learned. */
export const LEARNED_STREAK = 3;

export function isLearned(recent: IndexRecentEntry | undefined): boolean {
  const bits = typeof recent?.recent === 'string' ? recent.recent : '';
  return bits.length >= LEARNED_STREAK && bits.slice(-LEARNED_STREAK) === '1'.repeat(LEARNED_STREAK);
}

export interface PathState {
  order: IndexGroup[];
  /** Index into `order` of the group being learned; order.length once all are. */
  current: number;
  learned: ReadonlySet<DeviationId>;
}

export function pathState(devs: readonly Deviation[], indexRecent: Readonly<Record<string, IndexRecentEntry>> | undefined): PathState {
  const order = learningOrder(devs);
  const learned = new Set(devs.filter((d) => isLearned(indexRecent?.[d.id])).map((d) => d.id));
  let current = order.findIndex((g) => g.ids.some((id) => !learned.has(id)));
  if (current === -1) current = order.length;
  return { order, current, learned };
}

/** Share of draws from the group being learned; the rest review the earlier groups. */
export const PATH_NEW_SHARE = 0.7;

/**
 * The index to ask next. The group being learned, its unlearned indices
 * first; now and then one from an earlier group so they stay learned. With
 * every group learned, any index. `exclude` (the re-deal plan's) is honoured
 * where it leaves anything to ask.
 */
export function pickPathId(state: PathState, rng: () => number, exclude: ReadonlySet<string> = new Set()): DeviationId {
  const open = (ids: DeviationId[]) => {
    const kept = ids.filter((id) => !exclude.has(id));
    return kept.length > 0 ? kept : ids;
  };
  const pick = (ids: DeviationId[]) => ids[Math.floor(rng() * ids.length)]!;
  const all = state.order.flatMap((g) => g.ids);
  if (state.current >= state.order.length) return pick(open(all));
  const group = state.order[state.current]!.ids;
  const earlier = state.order.slice(0, state.current).flatMap((g) => g.ids);
  if (earlier.length > 0 && rng() >= PATH_NEW_SHARE) return pick(open(earlier));
  const unlearned = group.filter((id) => !state.learned.has(id));
  // Two in three of the group's draws go to what is not learned yet.
  const pool = unlearned.length > 0 && rng() < 2 / 3 ? unlearned : group;
  return pick(open(pool));
}
