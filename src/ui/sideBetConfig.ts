import type { Profile, ProfileSideBet } from '../store/types';
import { BET_NAMES, isSideBetId, payTableOf, payTablesFor } from '../engine/sideBets/payTables';
import { sidePlan } from '../engine/sideBets/plan';
import type { SidePlan } from '../engine/sideBets/plan';
import type { SideBetConfig } from '../engine/sideBets/tableBet';

/**
 * Wave L: the profile's side bet, checked. A stored value this build cannot
 * read (an unknown bet or pay table) is treated as no side bet rather than
 * guessed at.
 */

export const DEFAULT_SIDE_STAKE = 25;

export function profileSideBet(profile: Pick<Profile, 'sideBet'>): ProfileSideBet | null {
  const s = profile.sideBet;
  if (!s || s.enabled !== true || !isSideBetId(s.bet) || !payTableOf(s.bet, s.payTable)) return null;
  const stake = typeof s.stake === 'number' && Number.isFinite(s.stake) && s.stake > 0 ? s.stake : DEFAULT_SIDE_STAKE;
  return { ...s, stake };
}

/** The plan for the profile's side bet at its own game. */
export function profileSidePlan(profile: Pick<Profile, 'sideBet' | 'rules'>): SidePlan | null {
  const s = profileSideBet(profile);
  if (!s) return null;
  return sidePlan(s.bet, s.payTable, profile.rules.decks, profile.rules.s17);
}

/** What Game needs, or undefined for none. */
export function sideBetConfigFor(profile: Pick<Profile, 'sideBet' | 'rules'>): SideBetConfig | undefined {
  const s = profileSideBet(profile);
  const plan = profileSidePlan(profile);
  const table = s ? payTableOf(s.bet, s.payTable) : null;
  if (!s || !plan || !table) return undefined;
  return {
    bet: s.bet,
    name: BET_NAMES[s.bet],
    pays: table.pays,
    plan: { always: plan.always, count: plan.count, trigger: plan.trigger, betBelow: plan.betBelow },
    stake: s.stake,
  };
}

/** A fresh side bet for the editor: the bet's first preset. */
export function defaultSideBet(bet: ProfileSideBet['bet'] = 'luckyLadies'): ProfileSideBet {
  return { enabled: true, bet, payTable: payTablesFor(bet)[0]!.id, stake: DEFAULT_SIDE_STAKE };
}
