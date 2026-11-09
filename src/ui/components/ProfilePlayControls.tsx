import { TermText } from '../glossary';
import type { Profile, Settings } from '../../store/types';
import {
  CHECK_LABELS,
  checksShown,
  playCheckOffPatch,
  playCheckOnPatch,
  playChecksOf,
  tableCheckOffPatch,
  tableCheckOnPatch,
  type CheckKey,
  type PlayCheckKey,
  type TableCheckKey,
} from '../whatToCheck';
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
import { DIFFICULTY_NOTES, type DistractionDifficulty } from '../../drills/distraction';
import { PLAY_DISTRACTION_INTERVAL, playDistractionPrefs } from '../playDistraction';
import type { PlayDistractionFreq } from '../../store/types';
import {
  WONG_EXIT_MAX,
  WONG_EXIT_MIN,
  WONG_IN_MAX,
  WONG_IN_MIN,
  startShoeOutOf,
  wongExitTcOf,
  entryTcOf,
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
  Partial<Pick<Profile, 'betSpreadOn' | 'wongExitTc' | 'backCount' | 'startShoeOut' | 'wongInTc' | 'seats' | 'playChecks'>>;

interface ControlProps {
  profile: ProfileView;
  onChange: (patch: Partial<Profile>) => void;
}

function decksLabel(n: number): string {
  return `${n} ${n === 1 ? 'deck' : 'decks'}`;
}

/**
 * T1-1B: what an editor control says when Play's switch for it is off, so the
 * editor never claims Play does something it does not.
 */
export function gateOffNote(label: string): string {
  return `Off in Play: turn on ${label} in Play's settings to use this.`;
}

function GateOffNote({ profile, gate }: { profile: ProfileView; gate: PlayCheckKey }) {
  if (playChecksOf({ betSpreadOn: false, ...profile })[gate]) return null;
  return (
    <p className="settings-note profile-play-note" data-testid={`gate-off-${gate}`}>
      {gateOffNote(CHECK_LABELS[gate])}
    </p>
  );
}

/** T1-1B: each switch's one line, in plain words. */
export const CHECK_NOTES: Record<CheckKey, string> = {
  count: 'Every few rounds the table asks what the count is.',
  deviations: 'Graded on the plays where the count says to leave basic strategy.',
  bets: 'Your bet and In/Out are graded on your bet ramp.',
  dealerMistakes: 'Now and then the dealer pays a hand wrong; tap Foul to call it.',
  distractions: 'Between hands, a quick sum to answer, as table talk would.',
};

const PLAY_KEYS: readonly PlayCheckKey[] = ['count', 'deviations', 'bets'];
const TABLE_KEYS: readonly TableCheckKey[] = ['dealerMistakes', 'distractions'];

/**
 * T1-1B: Play's What to check. Five switches over the finer values (see
 * ui/whatToCheck.ts). The three profile ones go through `onChange` (held in
 * the Play sheet's draft, a new shoe on close); the two table ones through
 * `update` (live).
 */
export function WhatToCheckControls({
  profile,
  onChange,
  settings,
  update,
}: {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const shown = checksShown(profile, settings);
  const row = (key: CheckKey, set: (v: boolean) => void) => (
    <div key={key} className="what-to-check-item" data-check={key}>
      <Toggle label={CHECK_LABELS[key]} checked={shown[key]} onChange={set} />
      <p className="settings-note profile-play-note">
        <TermText text={CHECK_NOTES[key]} />
      </p>
    </div>
  );
  return (
    <div className="what-to-check" data-testid="what-to-check">
      {PLAY_KEYS.map((k) =>
        row(k, (v) => onChange(v ? playCheckOnPatch(k, profile) : playCheckOffPatch(k, profile))),
      )}
      {TABLE_KEYS.map((k) =>
        row(k, (v) => update(v ? tableCheckOnPatch(k, settings) : tableCheckOffPatch(k, settings))),
      )}
      {shown.distractions && <PlayDistractionOptions settings={settings} update={update} />}
    </div>
  );
}

/**
 * Owner 2026-11-09: how often Play's distractions come and how hard the sums
 * are. Under the Distractions switch, only while it is on; live, like it.
 */
function PlayDistractionOptions({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const { freq, difficulty } = playDistractionPrefs(settings);
  return (
    <div className="what-to-check-sub" data-testid="play-distraction-options">
      <div className="settings-row">
        <span className="settings-label">{'How often'}</span>
        <Segmented<PlayDistractionFreq>
          options={[
            { value: 'rare', label: 'Rare' },
            { value: 'normal', label: 'Normal' },
            { value: 'often', label: 'Often' },
          ]}
          value={freq}
          onChange={(v) => update({ playDistractionFreq: v })}
        />
      </div>
      <p className="settings-note profile-play-note" data-testid="play-distraction-freq-note">
        About one every {PLAY_DISTRACTION_INTERVAL[freq]} rounds.
      </p>
      <div className="settings-row">
        <span className="settings-label">{'Difficulty'}</span>
        <Segmented<DistractionDifficulty>
          options={[
            { value: 'easy', label: 'Easy' },
            { value: 'normal', label: 'Normal' },
            { value: 'hard', label: 'Hard' },
          ]}
          value={difficulty}
          onChange={(v) => update({ playDistractionDifficulty: v })}
        />
      </div>
      <p className="settings-note profile-play-note" data-testid="play-distraction-difficulty-note">
        {DIFFICULTY_NOTES[difficulty]}
      </p>
    </div>
  );
}

/** #34: grade with count deviations, or basic strategy only. */
export function DeviationsControl({ profile, onChange }: ControlProps) {
  return (
    <>
      <GateOffNote profile={profile} gate="deviations" />
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
      <GateOffNote profile={profile} gate="count" />
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
  const exit = wongExitTcOf(profile.wongExitTc);
  // Review N2: the entry is held at least one above the exit.
  const entry = entryTcOf(profile.wongInTc, profile.wongExitTc);
  const noBots = (profile.seats?.bots ?? 0) === 0;
  return (
    <>
      {spreadOn && (
        <Stepper
          label="Get in at TC ≥"
          value={entry}
          min={Math.max(WONG_IN_MIN, exit + 1)}
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
            Out, getting in is right at {signed(entry)} or higher.
            {/* Hysteresis: the counts strictly between the two points. */}
            {entry - exit > 1 &&
              ` Above ${signed(exit)} and below ${signed(entry)}, staying In or staying Out are both right.`}{' '}
          </>
        )}
        {startOut ? 'Every shoe starts with the toggle Out.' : 'The toggle stays where you put it, shoe to shoe.'}
        {noBots && ' With no other players set, Out you watch only the dealer.'}
      </p>
    </>
  );
}
