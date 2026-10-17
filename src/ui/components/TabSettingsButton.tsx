import { useRef, useState } from 'react';
import type { Profile, Settings } from '../../store/types';
import type { RuleSet } from '../../engine/ruleset';
import { getActiveProfile } from '../../store/profiles';
import { SHOT_CLOCK_OPTIONS, shotClockLabel } from '../../drills/shotClock';
import { Segmented, Stepper, Toggle } from '../screens/Settings';
import { useTabSettings, type TabSettingsContextValue } from '../tabSettingsContext';
import { TabSettingsSheet } from './TabSettingsSheet';
import { ResetBankrollRow } from './ResetBankrollRow';
import { BetSpreadControl, CountCheckControls, CutCardControl, DeviationsControl } from './ProfilePlayControls';
import { playOptionsDiffer } from '../profileOptions';

/**
 * #33: the gear in the topbar of Play, Drills and Charts, opening a sheet of
 * that tab's settings. The same Settings and Profile objects the Settings
 * screen and the profile editor edit -- no copies, no new storage.
 */
export type SettingsTab = 'play' | 'drills' | 'charts';

const TAB_NAME: Record<SettingsTab, string> = {
  play: 'Play',
  drills: 'Drills',
  charts: 'Charts',
};

export function TabSettingsButton({ tab }: { tab: SettingsTab }) {
  const ctx = useTabSettings();
  const [open, setOpen] = useState(false);
  const gearRef = useRef<HTMLButtonElement | null>(null);
  // Outside the app shell (a screen rendered on its own) there is nothing to
  // edit, so there is no gear.
  if (!ctx) return null;

  const title = `${TAB_NAME[tab]} settings`;
  const close = () => {
    setOpen(false);
    gearRef.current?.focus();
  };

  return (
    <>
      <button
        ref={gearRef}
        type="button"
        className="tab-gear"
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`tab-gear-${tab}`}
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">⚙</span>
      </button>
      {open && tab === 'play' && <PlaySheet title={title} ctx={ctx} onClosed={close} />}
      {open && tab === 'drills' && <DrillsSheet title={title} ctx={ctx} onClosed={close} />}
      {open && tab === 'charts' && <ChartsSheet title={title} ctx={ctx} onClosed={close} />}
    </>
  );
}

interface SheetProps {
  title: string;
  ctx: TabSettingsContextValue;
  onClosed: () => void;
}

function AllSettingsButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="u-btn tab-sheet-all" onClick={onClick}>
      All settings
    </button>
  );
}

/**
 * Play's settings.
 *
 * THE PROFILE HALF IS WRITTEN WHEN THE SHEET CLOSES, AND DEALS A NEW TABLE.
 * The cut card, the count-check prompt and deviation grading are built into
 * the game when the table mounts (useGame's GameConfig), and the app keys the
 * Table on the profile's content, so there is no applying them to the shoe in
 * play. Writing on every tap would remount the table under the open sheet,
 * once per tap. So they are held here and written once, on close, which deals
 * a fresh shoe with all of them -- and the sheet says so before you close it.
 * The losing shoe and a bankroll reset are the same (both are read at mount),
 * so they ask for the same new table.
 *
 * Feedback and deal speed are read live, and apply at once with no new shoe.
 */
function PlaySheet({ title, ctx, onClosed }: SheetProps) {
  // From storage, not the shell's copy: the table writes the carried
  // bankroll to storage only (playBankroll.ts).
  const [base] = useState<Profile>(() => getActiveProfile());
  const [draft, setDraft] = useState<Partial<Profile>>({});
  const [bankrollReset, setBankrollReset] = useState(false);
  const { settings } = ctx;
  const [losingShoeAtOpen] = useState(() => settings.losingShoe === true);
  const view: Profile = { ...base, ...draft };
  // Effective values, not raw fields: a change made and undone is no change,
  // and must not cost the shoe in play.
  const changedProfile = playOptionsDiffer(view, base);
  const pending =
    changedProfile || bankrollReset || (settings.losingShoe === true) !== losingShoeAtOpen;

  const update = (patch: Partial<Settings>) => ctx.commitSettings({ ...settings, ...patch });
  const edit = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));

  const finish = () => {
    if (pending) ctx.applyProfile(changedProfile ? draft : null);
  };
  const close = () => {
    finish();
    onClosed();
  };

  return (
    <TabSettingsSheet title={title} onClose={close}>
      <div className="settings-row">
        <span className="settings-label">Feedback</span>
        <Segmented
          options={[
            { value: 'training', label: 'Training' },
            { value: 'test', label: 'Test' },
          ]}
          value={settings.feedbackMode}
          onChange={(v) => update({ feedbackMode: v })}
        />
      </div>
      <p className="settings-note">
        <strong>Training</strong> corrects as you go. <strong>Test</strong> scores at the end.
      </p>
      <Stepper
        label="Deal speed"
        value={settings.dealSpeedMs}
        min={0}
        max={1000}
        step={100}
        format={(v) => `${v}ms`}
        onChange={(v) => update({ dealSpeedMs: v })}
      />

      <h3 className="tab-sheet-group">New shoe</h3>
      <p
        className={`tab-sheet-when${pending ? ' tab-sheet-when-pending' : ''}`}
        data-testid="tab-sheet-when"
        role="status"
      >
        {pending
          ? 'Changed. A new shoe is dealt when you close this.'
          : `Saved to the ${base.name} profile. Changing one deals a new shoe when you close this.`}
      </p>
      <BetSpreadControl profile={view} onChange={edit} />
      <DeviationsControl profile={view} onChange={edit} />
      <CountCheckControls profile={view} onChange={edit} />
      <CutCardControl profile={view} onChange={edit} />
      <Toggle
        label="Losing shoe"
        checked={settings.losingShoe === true}
        onChange={(v) => update({ losingShoe: v })}
      />
      <p className="settings-note">
        Deals a rigged run of losing hands, graded on your bet ramp. Plays solo.
      </p>
      <ResetBankrollRow onReset={() => setBankrollReset(true)} />

      {/* Wave A (s06): All settings has no way into profiles, so the bet
          ramp and the rest of the profile get their own way out. Labelled for
          where it lands -- the Profiles list; the ramp is under Edit. */}
      <button
        type="button"
        className="u-btn tab-sheet-all"
        onClick={() => {
          finish();
          ctx.navigate('profiles');
        }}
      >
        Profiles
      </button>
      <AllSettingsButton
        onClick={() => {
          finish();
          ctx.navigate('settings');
        }}
      />
    </TabSettingsSheet>
  );
}

function DrillsSheet({ title, ctx, onClosed }: SheetProps) {
  const { settings } = ctx;
  return (
    <TabSettingsSheet title={title} onClose={onClosed}>
      <div className="settings-row">
        <span className="settings-label">Shot clock</span>
        <Segmented
          options={SHOT_CLOCK_OPTIONS.map((ms) => ({
            value: String(ms),
            label: shotClockLabel(ms),
          }))}
          value={String(settings.drill.shotClockMs)}
          onChange={(v) =>
            ctx.commitSettings({ ...settings, drill: { ...settings.drill, shotClockMs: Number(v) } })
          }
        />
      </div>
      <p className="settings-note">
        A time limit on flashcard and deviation-quiz answers. Running out counts the card as
        missed and puts it back in the review deck.
      </p>
      <AllSettingsButton onClick={() => ctx.navigate('settings')} />
    </TabSettingsSheet>
  );
}

/**
 * The rules the charts are drawn for. They are the active profile's rules --
 * there is no separate "chart rules" to drift from what Play grades with --
 * so a change is written straight to the profile and the charts redraw under
 * the sheet. No table is mounted on Charts, so nothing is reshuffled.
 */
function ChartsSheet({ title, ctx, onClosed }: SheetProps) {
  const profile = ctx.activeProfile;
  const rules = profile.rules;
  const setRules = (patch: Partial<RuleSet>) => ctx.applyProfile({ rules: { ...rules, ...patch } });
  return (
    <TabSettingsSheet title={title} onClose={onClosed}>
      <h3 className="tab-sheet-group">Rules shown</h3>
      <p className="tab-sheet-when">
        {profile.name}&rsquo;s rules. Play and the drills use them too.
      </p>
      <div className="settings-row">
        <span className="settings-label">Decks</span>
        <Segmented
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '6', label: '6' },
            { value: '8', label: '8' },
          ]}
          value={String(rules.decks)}
          onChange={(v) => setRules({ decks: Number(v) as RuleSet['decks'] })}
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">Dealer soft 17</span>
        <Segmented
          options={[
            { value: 'true', label: 'S17' },
            { value: 'false', label: 'H17' },
          ]}
          value={String(rules.s17)}
          onChange={(v) => setRules({ s17: v === 'true' })}
        />
      </div>
      <Toggle
        label="Double after split (DAS)"
        checked={rules.das}
        onChange={(v) => setRules({ das: v })}
      />
      <Toggle label="Late surrender (LS)" checked={rules.ls} onChange={(v) => setRules({ ls: v })} />
      <AllSettingsButton onClick={() => ctx.navigate('settings')} />
    </TabSettingsSheet>
  );
}
