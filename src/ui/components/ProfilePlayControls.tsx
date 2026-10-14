import type { Profile } from '../../store/types';
import './profilePlayControls.css';
import { Segmented, Stepper, Toggle } from '../screens/Settings';
import {
  COUNT_CHECK_ASK_OPTIONS,
  countCheckAskOf,
  cutBounds,
  cutDecksOf,
  CUT_STEP,
  gradesDeviations,
  type CountCheckAsk,
} from '../profileOptions';

/**
 * The profile options Play reads, as controls (#3, #34, #39). One set, used
 * by both the Play gear sheet and the profile editor, so the two can never
 * offer different ranges or wordings for the same field.
 */

type ProfileView = Pick<
  Profile,
  'countCheckEvery' | 'countCheckAsk' | 'gradeDeviations' | 'cutDecks' | 'cutVary' | 'penetration' | 'rules'
>;

interface ControlProps {
  profile: ProfileView;
  onChange: (patch: Partial<Profile>) => void;
}

function decksLabel(n: number): string {
  return `${n} ${n === 1 ? 'deck' : 'decks'}`;
}

/** #34: grade with count deviations, or basic strategy only. */
export function DeviationsControl({ profile, onChange }: ControlProps) {
  return (
    <>
      <Toggle
        label="Grade with deviations"
        checked={gradesDeviations(profile)}
        onChange={(v) => onChange({ gradeDeviations: v })}
      />
      <p className="settings-note profile-play-note">
        {gradesDeviations(profile)
          ? 'Index plays and insurance are graded at the true count.'
          : 'Graded by basic strategy at every count, insurance included.'}
      </p>
    </>
  );
}

/** How often Play stops for a count check, and (#3) what it asks. */
export function CountCheckControls({ profile, onChange }: ControlProps) {
  const ask = countCheckAskOf(profile);
  const off = profile.countCheckEvery === 0;
  return (
    <>
      <Stepper
        label="Count check every"
        value={profile.countCheckEvery}
        min={0}
        max={20}
        step={1}
        format={(v) => (v === 0 ? 'Off' : `${v} rounds`)}
        onChange={(v) => onChange({ countCheckEvery: v })}
      />
      <div className="settings-row count-ask-row">
        <span className="settings-label">Count checks ask</span>
        <Segmented<CountCheckAsk>
          options={COUNT_CHECK_ASK_OPTIONS.map(({ value, label }) => ({ value, label }))}
          value={ask}
          onChange={(v) => onChange({ countCheckAsk: v })}
          disabled={off}
        />
      </div>
      <p className="settings-note profile-play-note" data-testid="count-check-ask-note">
        {off ? 'Count checks are off.' : COUNT_CHECK_ASK_OPTIONS.find((o) => o.value === ask)!.note}
      </p>
    </>
  );
}

/** #39: the cut card as decks left behind it, replacing penetration %. */
export function CutCardControl({ profile, onChange }: ControlProps) {
  const { min, max } = cutBounds(profile.rules.decks);
  const cut = cutDecksOf(profile);
  return (
    <>
      <Stepper
        label="Cut card"
        value={cut}
        min={min}
        max={max}
        step={CUT_STEP}
        format={(v) => `${decksLabel(v)} behind`}
        onChange={(v) => onChange({ cutDecks: v })}
      />
      <Toggle
        label="Vary ±0.5 decks"
        checked={profile.cutVary === true}
        onChange={(v) => onChange({ cutVary: v })}
      />
      <p className="settings-note profile-play-note">
        Decks left behind the cut card of a {profile.rules.decks}-deck shoe
        {profile.cutVary ? ', moved by up to half a deck either way each shoe.' : '.'}
      </p>
    </>
  );
}
