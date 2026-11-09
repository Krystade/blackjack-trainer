import type { Profile, Settings } from '../store/types';
import type { DealerMistakesMode } from '../engine/dealerErrors';
import { dealerMistakesModeIn, dealerMistakesPatch, dealerMistakesSetting } from './dealerErrorCopy';

/**
 * T1-1B: Play's "What to check" switches, the one place their rules live.
 *
 * Each switch is a GATE over a finer value that has its own home: the count
 * check cadence, deviation grading and the bet ramp in the profile editor,
 * the dealer's mistake rate in Settings. Play does a thing only when its gate
 * AND its finer value are on, so a beginner's Play grades basic strategy
 * alone while Jack's cadence, ramp and indexes stay stored, ready for the
 * switch to bring back. Other surfaces (the casino EV sim, the ramp editor)
 * keep reading the finer values, unchanged.
 *
 * Absent gate object = derived from the finer values, the behaviour before
 * the switches. Once the object is present, a missing key reads false, and
 * every patch here writes the whole object.
 */

export type PlayCheckKey = 'count' | 'deviations' | 'bets';
export type TableCheckKey = 'dealerMistakes' | 'distractions';
export type CheckKey = PlayCheckKey | TableCheckKey;

export type PlayChecks = Record<PlayCheckKey, boolean>;
export type TableChecks = Record<TableCheckKey, boolean>;

/** In the order the Play gear shows them. */
export const CHECK_KEYS: readonly CheckKey[] = ['count', 'deviations', 'bets', 'dealerMistakes', 'distractions'];

export const CHECK_LABELS: Record<CheckKey, string> = {
  count: 'Count checks',
  deviations: 'Deviations',
  bets: 'Bet checks',
  dealerMistakes: 'Dealer mistakes',
  distractions: 'Distractions',
};

export function isPlayCheck(key: CheckKey): key is PlayCheckKey {
  return key === 'count' || key === 'deviations' || key === 'bets';
}

/** As profileOptions.gradesDeviations (absent = on); inlined so neither module imports the other. */
function gradesDeviations(profile: Pick<Profile, 'gradeDeviations'>): boolean {
  return profile.gradeDeviations !== false;
}

type GateProfile = Pick<Profile, 'playChecks' | 'countCheckEvery' | 'gradeDeviations' | 'betSpreadOn'>;
type GateSettings = Pick<Settings, 'tableChecks' | 'dealerMistakes' | 'dealerMistakesMode'>;

/** The profile's gates, derived from the finer values when the object is absent. */
export function playChecksOf(profile: GateProfile): PlayChecks {
  const g = profile.playChecks;
  if (g === undefined || g === null || typeof g !== 'object') {
    return {
      count: profile.countCheckEvery > 0,
      deviations: gradesDeviations(profile),
      bets: profile.betSpreadOn === true,
    };
  }
  return { count: g.count === true, deviations: g.deviations === true, bets: g.bets === true };
}

/** The settings' gates, derived when the object is absent (distractions are new: off). */
export function tableChecksOf(settings: GateSettings): TableChecks {
  const g = settings.tableChecks;
  if (g === undefined || g === null || typeof g !== 'object') {
    return { dealerMistakes: dealerMistakesSetting(settings) !== 'off', distractions: false };
  }
  return { dealerMistakes: g.dealerMistakes === true, distractions: g.distractions === true };
}

/** What each switch shows: gate AND finer value. */
export function checksShown(profile: GateProfile, settings: GateSettings): Record<CheckKey, boolean> {
  const p = playChecksOf(profile);
  const t = tableChecksOf(settings);
  return {
    count: p.count && profile.countCheckEvery > 0,
    deviations: p.deviations && gradesDeviations(profile),
    bets: p.bets && profile.betSpreadOn === true,
    dealerMistakes: t.dealerMistakes && dealerMistakesSetting(settings) !== 'off',
    distractions: t.distractions,
  };
}

/** The cadence a switched-on Count checks starts at when the editor had it Off. */
export const COUNT_CHECK_ON_EVERY = 5;

/**
 * Turning a profile switch on: the gate, and the finer value when it was off
 * (5 rounds, deviations graded, the ramp on). A finer value already on is
 * kept, so Jack's 8 rounds come back as 8. `profile` is the current view
 * (stored profile plus the sheet's draft).
 */
export function playCheckOnPatch(key: PlayCheckKey, profile: GateProfile): Partial<Profile> {
  const playChecks = { ...playChecksOf(profile), [key]: true };
  if (key === 'count') {
    return profile.countCheckEvery > 0 ? { playChecks } : { playChecks, countCheckEvery: COUNT_CHECK_ON_EVERY };
  }
  if (key === 'deviations') return gradesDeviations(profile) ? { playChecks } : { playChecks, gradeDeviations: true };
  return profile.betSpreadOn === true ? { playChecks } : { playChecks, betSpreadOn: true };
}

/** Turning a profile switch off writes the gate only. */
export function playCheckOffPatch(key: PlayCheckKey, profile: GateProfile): Partial<Profile> {
  return { playChecks: { ...playChecksOf(profile), [key]: false } };
}

/** Turning a table switch on: the gate, and 'occasional' when the mistake rate was off. */
export function tableCheckOnPatch(key: TableCheckKey, settings: GateSettings): Partial<Settings> {
  const tableChecks = { ...tableChecksOf(settings), [key]: true };
  if (key === 'dealerMistakes' && dealerMistakesSetting(settings) === 'off') {
    return { tableChecks, ...dealerMistakesPatch('occasional') };
  }
  return { tableChecks };
}

export function tableCheckOffPatch(key: TableCheckKey, settings: GateSettings): Partial<Settings> {
  return { tableChecks: { ...tableChecksOf(settings), [key]: false } };
}

/**
 * Whether the profile's Bet checks gate is EXPLICITLY closed. Used for what
 * hangs off the ramp beyond `betSpreadOn` itself (starting each shoe out,
 * the entry point, the In/Out toggle): a profile from before the switches
 * keeps those exactly as it had them.
 */
export function betsGateClosed(profile: Pick<Profile, 'playChecks'>): boolean {
  return profile.playChecks != null && profile.playChecks.bets !== true;
}

/** Likewise Count checks: the side bet is graded against its own count, so it needs counting on. */
export function countGateClosed(profile: Pick<Profile, 'playChecks'>): boolean {
  return profile.playChecks != null && profile.playChecks.count !== true;
}

/** The three finer values as Play must use them: zero / false behind a closed gate. */
export function effectivePlayFields(profile: GateProfile): {
  countCheckEvery: number;
  gradeDeviations: boolean;
  betSpreadOn: boolean;
} {
  const g = playChecksOf(profile);
  return {
    countCheckEvery: g.count ? profile.countCheckEvery : 0,
    gradeDeviations: g.deviations ? gradesDeviations(profile) : false,
    betSpreadOn: g.bets ? profile.betSpreadOn === true : false,
  };
}

/** The dealer's mistake rate Play deals with: off behind the gate and eyes-free. */
export function tableMistakesMode(settings: GateSettings, eyesFree: boolean): DealerMistakesMode {
  return tableChecksOf(settings).dealerMistakes ? dealerMistakesModeIn(settings, eyesFree) : 'off';
}

/** Distractions in Play: the gate, never eyes-free (they are read off the screen). */
export function distractionsOn(settings: GateSettings, eyesFree: boolean): boolean {
  return tableChecksOf(settings).distractions && !eyesFree;
}
