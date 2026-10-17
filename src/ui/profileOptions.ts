import type { Profile } from '../store/types';
import { loadProfiles, saveProfiles, getActiveProfile } from '../store/profiles';

/**
 * The profile options a tab's gear sheet edits (#33), and the cut card's
 * conversion between decks and the old penetration fraction (#39).
 *
 * Pure apart from `patchActiveProfile`, which writes through the same
 * loadProfiles/saveProfiles pair the profile editor saves with -- so a change
 * from a gear sheet and one from the editor are the same write to the same
 * object, with no second copy anywhere.
 */

export type CountCheckAsk = NonNullable<Profile['countCheckAsk']>;

/** What a count check asks, in the order the control shows them. */
export const COUNT_CHECK_ASK_OPTIONS: readonly { value: CountCheckAsk; label: string; note: string }[] = [
  { value: 'running', label: 'Running', note: 'Each check asks the running count.' },
  { value: 'true', label: 'True', note: 'Each check asks the true count.' },
  {
    value: 'alternate',
    label: 'Alternate',
    note: 'Both, alternating: the running count, and the true count too on every second check.',
  },
  { value: 'both', label: 'Both', note: 'Both every time: the running count, then the true count.' },
];

/** Absent = 'alternate', the behaviour before the option existed. */
export function countCheckAskOf(profile: Pick<Profile, 'countCheckAsk'>): CountCheckAsk {
  return profile.countCheckAsk ?? 'alternate';
}

/** Absent = on: grading with deviations is the behaviour before #34. */
export function gradesDeviations(profile: Pick<Profile, 'gradeDeviations'>): boolean {
  return profile.gradeDeviations !== false;
}

/** #39: the cut card is set as decks left behind it, in quarter decks. */
export const CUT_STEP = 0.25;
export const CUT_MIN = 0.5;
export const CUT_MAX = 3;

/**
 * The range for a shoe of `decks`. Never more than half the shoe behind the
 * cut (the old penetration control's floor was 50%), so a single deck offers
 * 0.5 only and a double deck 0.5-1.
 */
export function cutBounds(decks: number): { min: number; max: number } {
  return { min: CUT_MIN, max: Math.max(CUT_MIN, Math.min(CUT_MAX, decks / 2)) };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toQuarter(n: number): number {
  return Math.round(n / CUT_STEP) * CUT_STEP;
}

/**
 * The profile's cut card, in decks behind it. A profile saved before #39 has
 * only `penetration`, so its cut is derived from that -- decks x (1 -
 * penetration), to the nearest quarter deck -- and keeps the depth it had.
 */
export function cutDecksOf(profile: Pick<Profile, 'cutDecks' | 'penetration' | 'rules'>): number {
  const { min, max } = cutBounds(profile.rules.decks);
  const raw =
    typeof profile.cutDecks === 'number' && Number.isFinite(profile.cutDecks)
      ? profile.cutDecks
      : profile.rules.decks * (1 - profile.penetration);
  return clamp(toQuarter(raw), min, max);
}

/** The penetration fraction that leaves `cut` decks behind the cut card. */
export function penetrationForCut(decks: number, cut: number): number {
  return 1 - cut / decks;
}

/**
 * Keep `penetration` in step with `cutDecks`.
 *
 * `penetration` is still what the shoe reads until the engine takes the cut
 * in decks, and it stays a required field of a stored profile. Writing both
 * means the control works whichever one the engine reads, and a profile whose
 * deck count was changed keeps the same number of decks behind the cut.
 */
export function syncPenetration(profile: Profile): Profile {
  if (profile.cutDecks === undefined) return profile;
  const cut = cutDecksOf(profile);
  return { ...profile, cutDecks: cut, penetration: penetrationForCut(profile.rules.decks, cut) };
}

/**
 * Whether two profiles differ in what the Play sheet's held options mean to
 * the game, judged on their EFFECTIVE values. An absent field and its default
 * are the same game: turning "Vary" on and off again leaves `cutVary: false`
 * where there was nothing, and stepping the cut up and back down stores the
 * cut that was only derived before. Neither is a reason to deal a new shoe.
 */
export function playOptionsDiffer(a: Profile, b: Profile): boolean {
  const effective = (p: Profile) => [
    p.countCheckEvery,
    countCheckAskOf(p),
    gradesDeviations(p),
    cutDecksOf(p),
    p.cutVary === true,
    // Wave A: the bet spread toggle is in the Play sheet too.
    p.betSpreadOn === true,
  ];
  return JSON.stringify(effective(a)) !== JSON.stringify(effective(b));
}

/**
 * Apply a patch to the stored active profile and save the whole list, as the
 * profile editor saves it. Returns the profile as stored. Reads storage rather
 * than any in-memory copy: the table writes `bankrollNow` to storage only
 * (playBankroll.ts), and an older copy would put a spent bankroll back.
 */
export function patchActiveProfile(patch: Partial<Profile>): Profile {
  const active = getActiveProfile();
  const profiles = loadProfiles();
  const updated = syncPenetration({ ...active, ...patch });
  saveProfiles(profiles.map((p) => (p.id === active.id ? updated : p)));
  return updated;
}
