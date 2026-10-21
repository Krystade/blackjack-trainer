import type { SideBetId } from '../engine/sideBets/payTables';
import type { SideBetDecision } from '../engine/sideBets/tableBet';
import type { SideBetStats, SideBetTally, Stats } from './types';

/**
 * Wave L: Stats.sideBets, written as Play's rounds settle and as a side count
 * drill finishes. Pure: stats in, stats out. Additive -- a blob without the
 * field reads as nothing recorded.
 */

export const SIDE_DRILL_HISTORY_MAX = 200;

const EMPTY: SideBetStats = { play: {}, drill: [] };
const ZERO: SideBetTally = { right: 0, wrong: 0, placed: 0, net: 0 };

function sideOf(stats: Stats): SideBetStats {
  const s = stats.sideBets;
  if (!s || typeof s !== 'object') return EMPTY;
  return { play: s.play && typeof s.play === 'object' ? s.play : {}, drill: Array.isArray(s.drill) ? s.drill : [] };
}

/** Add Play's settled side-bet decisions for one bet. Only settled ones (a placed bet with a net) and skipped ones count. */
export function addSideDecisions(stats: Stats, bet: SideBetId, decisions: readonly SideBetDecision[]): Stats {
  if (decisions.length === 0) return stats;
  const side = sideOf(stats);
  const t = { ...ZERO, ...side.play[bet] };
  for (const d of decisions) {
    // Review N9: a bet placed in a round the session ended inside never
    // settled -- counting it would add a placed bet with no money.
    if (d.placed && d.net === undefined) continue;
    if (d.correct) t.right += 1;
    else t.wrong += 1;
    if (d.placed) t.placed += 1;
    t.net += d.net ?? 0;
  }
  return { ...stats, sideBets: { ...side, play: { ...side.play, [bet]: t } } };
}

export function addSideDrillRun(stats: Stats, run: SideBetStats['drill'][number]): Stats {
  const side = sideOf(stats);
  return { ...stats, sideBets: { ...side, drill: [...side.drill, run].slice(-SIDE_DRILL_HISTORY_MAX) } };
}

/** Every bet's tally, summed. */
export function sideBetTotals(stats: Stats): SideBetTally {
  const out = { ...ZERO };
  for (const t of Object.values(sideOf(stats).play)) {
    if (!t) continue;
    out.right += t.right;
    out.wrong += t.wrong;
    out.placed += t.placed;
    out.net += t.net;
  }
  return out;
}

export function sideBetStatsOf(stats: Stats): SideBetStats {
  return sideOf(stats);
}
