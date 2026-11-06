import type { Profile, Settings } from '../../store/types';
import type { PlayDepth } from '../../engine/game';
import type { DealerMistakesMode } from '../../engine/dealerErrors';
import { Segmented, Stepper, Toggle } from '../screens/Settings';
import { DEALER_PACE_MAX_SEC, DEALER_PACE_MIN_SEC, dealerPaceSec } from '../dealerPace';
import { dealerMistakesPatch, dealerMistakesSetting } from '../dealerErrorCopy';

/**
 * Owner 2026-11-06 (settings overhaul): the table's controls, drawn by the
 * profile editor (their home) and by Play's gear (a shortcut) from this one
 * component, so the two copies cannot drift. See settingsRegistry.ts.
 */
interface ProfileProps {
  profile: Profile;
  onChange: (patch: Partial<Profile>) => void;
}
interface SettingsProps {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}

export function PlayersControl({ profile, onChange }: ProfileProps) {
  return (
    <>
            <Stepper
        label="Players with you"
        value={profile.seats.bots}
        min={0}
        max={5}
        step={1}
        onChange={(v) =>
          onChange({
            seats: { ...profile.seats, bots: v as Profile['seats']['bots'], playerPosition: Math.min(profile.seats.playerPosition, v) },
          })
        }
      />
      <p className="settings-note">Other players at the table, the same whether you&rsquo;re In or Out.</p>
    </>
  );
}

export function PlayDepthControl({ profile, onChange }: ProfileProps) {
  return (
    <>
      <div className="settings-row">
        <span className="settings-label">Deck estimation</span>
        <Segmented
          options={[
            { value: 'whole', label: 'Whole' },
            { value: 'half', label: 'Half' },
            { value: 'quarter', label: 'Quarter' },
          ]}
          value={profile.playDepth ?? 'half'}
          onChange={(v) => onChange({ playDepth: v as PlayDepth })}
        />
      </div>
      <p className="settings-note">
        The decks-left step Play divides by for the true count, deviations and bets. Only Play uses it.
      </p>
    </>
  );
}

export function DealSpeedControl({ settings, update }: SettingsProps) {
  return (
      <Stepper
        label="Deal speed"
        value={settings.dealSpeedMs}
        min={0}
        max={1000}
        step={100}
        format={(v) => `${v}ms`}
        onChange={(v) => update({ dealSpeedMs: v })}
      />
  );
}

/** Dealer pace and dealer mistakes: read live, so they deal no new shoe. */
export function DealerControls({ settings, update }: SettingsProps) {
  return (
    <>
      {/* F5 (W2-17): read live, like deal speed -- no new shoe. */}
      <Toggle
        label="Dealer pace clock"
        checked={settings.dealerPaceOn === true}
        onChange={(v) => update({ dealerPaceOn: v })}
      />
      <Stepper
        label="Dealer pace"
        value={dealerPaceSec(settings)}
        min={DEALER_PACE_MIN_SEC}
        max={DEALER_PACE_MAX_SEC}
        step={1}
        format={(v) => `${v}s`}
        disabled={settings.dealerPaceOn !== true}
        onChange={(v) => update({ dealerPaceSec: v })}
      />
      <p className="settings-note">
        A bar runs down over each decision. Running out never plays the hand; the report counts slow
        decisions. Off eyes-free.
      </p>
      {/* G2 (L-8): read live too -- rounds dealt from now on. Wave I: a rate. */}
      <div className="settings-row" role="group" aria-labelledby="dealer-mistakes-label">
        <span className="settings-label" id="dealer-mistakes-label">
          Dealer mistakes
        </span>
        <Segmented<DealerMistakesMode>
          options={[
            { value: 'off', label: 'Off' },
            { value: 'occasional', label: 'Occasional' },
            { value: 'training', label: 'Training' },
          ]}
          value={dealerMistakesSetting(settings)}
          onChange={(v) => update(dealerMistakesPatch(v))}
        />
      </div>
      <p className="settings-note">
        Now and then the dealer pays a hand wrong: <strong>Occasional</strong> about one round in 30,{' '}
        <strong>Training</strong> about one in 5. Tap Foul before the next deal to call it. Scored apart
        from your play accuracy. Off eyes-free.
      </p>

    </>
  );
}

/** The losing shoe: dealt from the next shoe, so Play's gear keeps it as a shortcut. */
export function LosingShoeControl({ settings, update }: SettingsProps) {
  return (
    <>
      <Toggle
        label="Losing shoe"
        checked={settings.losingShoe === true}
        onChange={(v) => update({ losingShoe: v })}
      />
      <p className="settings-note">
        Deals a rigged run of losing hands, graded on your bet ramp. Plays solo.
      </p>
    </>
  );
}
