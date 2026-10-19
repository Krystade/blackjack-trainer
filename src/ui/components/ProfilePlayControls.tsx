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
import { signed } from '../../drills/signed';
import {
  BACK_COUNT_BOTS,
  WONG_EXIT_MAX,
  WONG_EXIT_MIN,
  WONG_IN_MAX,
  WONG_IN_MIN,
  startShoeOutOf,
  wongExitTcOf,
  wongInTcOf,
} from '../../engine/wong';

/**
 * The profile options Play reads, as controls (#3, #34, #39). One set, used
 * by both the Play gear sheet and the profile editor, so the two can never
 * offer different ranges or wordings for the same field.
 */

type ProfileView = Pick<
  Profile,
  'countCheckEvery' | 'countCheckAsk' | 'gradeDeviations' | 'cutDecks' | 'cutVary' | 'penetration' | 'rules'
> &
  Partial<Pick<Profile, 'betSpreadOn' | 'wongExitTc' | 'backCount' | 'startShoeOut' | 'wongInTc' | 'seats'>>;

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

/**
 * Wave A (s06): vary bets with the count -- the bet ramp and the play-or-sit
 * grading both hang off it. Reachable from the Play gear, not only from the
 * profile editor; the ramp itself is edited there.
 */
export function BetSpreadControl({ profile, onChange }: ControlProps) {
  const on = profile.betSpreadOn === true;
  return (
    <>
      <Toggle label="Vary bets with the count" checked={on} onChange={(v) => onChange({ betSpreadOn: v })} />
      <p className="settings-note profile-play-note">
        {on
          ? 'Bets are graded on your bet ramp, and so is the In/Out toggle: getting out is right at or below your exit point, getting in at or above your entry point.'
          : 'Flat bets: no bet ramp, and the In/Out toggle is not graded.'}
      </p>
      {on && <WongExitControl profile={profile} onChange={onChange} />}
      <BackCountControl profile={profile} onChange={onChange} />
    </>
  );
}

/**
 * D-R1 (Wave D): the Wong exit point. Sitting out is graded right only at
 * true count <= this; above it playing is right, even at the ramp's minimum.
 */
export function WongExitControl({ profile, onChange }: ControlProps) {
  const exit = wongExitTcOf(profile.wongExitTc);
  return (
    <>
      <Stepper
        label="Get out at TC"
        value={exit}
        min={WONG_EXIT_MIN}
        max={WONG_EXIT_MAX}
        step={1}
        format={(v) => `${signed(v)} or lower`}
        onChange={(v) => onChange({ wongExitTc: v })}
      />
      <p className="settings-note profile-play-note" data-testid="wong-exit-note">
        In, above {signed(exit)} staying in is right, even where the ramp bets its minimum.
      </p>
    </>
  );
}

/**
 * Wave J toggle rework: the In/Out toggle's other half. "Start each shoe
 * out" turns the table's toggle Out as every fresh shoe starts; the entry
 * point is where getting in is right (Out, staying out is right below it).
 * Between the exit and the entry point either state is right. The entry
 * point needs the ramp, as the exit does; the switch does not.
 */
export function BackCountControl({ profile, onChange }: ControlProps) {
  const startOut = startShoeOutOf(profile);
  const spreadOn = profile.betSpreadOn === true;
  const entry = wongInTcOf(profile.wongInTc);
  const exit = wongExitTcOf(profile.wongExitTc);
  const noBots = (profile.seats?.bots ?? 0) === 0;
  return (
    <>
      {spreadOn && (
        <Stepper
          label="Get in at TC ≥"
          value={entry}
          min={WONG_IN_MIN}
          max={WONG_IN_MAX}
          step={1}
          format={(v) => signed(v)}
          onChange={(v) => onChange({ wongInTc: v })}
        />
      )}
      <Toggle
        label="Start each shoe out"
        checked={startOut}
        // The legacy `backCount` is cleared as the new field is written.
        onChange={(v) => onChange({ startShoeOut: v, backCount: undefined })}
      />
      <p className="settings-note profile-play-note" data-testid="back-count-note">
        {spreadOn && (
          <>
            Out, getting in is right at {signed(entry)} or higher; between {signed(exit)} and {signed(entry)} either is
            right.
            {/* The overlap at 0, said where it can be set (wong.ts). */}
            {entry === 0 && exit === 0 && ' At 0, In says get out and Out says get in.'}{' '}
          </>
        )}
        {startOut ? 'Every shoe starts with the toggle Out.' : 'The toggle stays where you put it, shoe to shoe.'}
        {noBots && ` Out with no bots set, you watch a table of ${BACK_COUNT_BOTS}.`}
      </p>
    </>
  );
}
