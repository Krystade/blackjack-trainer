import { useState } from 'react';
import type { Screen } from '../App';
import type { Profile } from '../../store/types';
import type { SpreadRow } from '../../engine/game';
import type { RuleSet } from '../../engine/ruleset';
import {
  loadProfiles,
  saveProfiles,
  getActiveProfile,
  setActiveProfile,
  makeDefaultProfile,
} from '../../store/profiles';
import { Segmented, Stepper } from './Settings';

interface ProfileEditorProps {
  onNavigate: (screen: Screen) => void;
}

type Mode = { kind: 'list' } | { kind: 'edit'; draft: Profile; isNew: boolean };

function sortSpread(rows: SpreadRow[]): SpreadRow[] {
  return [...rows].sort((a, b) => a.minTc - b.minTc);
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-label">{label}</span>
      <input
        type="checkbox"
        className="settings-toggle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function OptionalNumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <input
        type="number"
        className="profile-number-input"
        value={value === undefined ? '' : value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <input
        type="text"
        className="profile-text-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ProfileEditor({ onNavigate }: ProfileEditorProps) {
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState<string>(() => getActiveProfile().id);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });

  const selectActive = (id: string) => {
    setActiveProfile(id);
    setActiveId(id);
  };

  const startEdit = (profile: Profile) => {
    setMode({ kind: 'edit', draft: structuredClone(profile), isNew: false });
  };

  const startNew = () => {
    const draft = makeDefaultProfile();
    draft.name = 'New Profile';
    setMode({ kind: 'edit', draft, isNew: true });
  };

  const duplicateProfile = (profile: Profile) => {
    const copy = structuredClone(profile);
    copy.id = crypto.randomUUID ? crypto.randomUUID() : `p-${Date.now().toString(36)}`;
    copy.name = `${profile.name} (copy)`;
    const next = [...profiles, copy];
    saveProfiles(next);
    setProfiles(next);
  };

  const deleteProfile = (id: string) => {
    if (profiles.length <= 1) return;
    if (!window.confirm('Delete this profile? This cannot be undone.')) return;
    const next = profiles.filter((p) => p.id !== id);
    saveProfiles(next);
    setProfiles(next);
    if (id === activeId) {
      const fallback = next[0]!;
      setActiveProfile(fallback.id);
      setActiveId(fallback.id);
    }
    setMode({ kind: 'list' });
  };

  const cancelEdit = () => {
    setMode({ kind: 'list' });
  };

  const saveDraft = (draft: Profile) => {
    const cleaned: Profile = {
      ...draft,
      name: draft.name.trim() === '' ? 'Unnamed profile' : draft.name,
      spread: sortSpread(draft.spread),
    };
    const wasNew = mode.kind === 'edit' && mode.isNew;
    const next = wasNew
      ? [...profiles, cleaned]
      : profiles.map((p) => (p.id === cleaned.id ? cleaned : p));
    saveProfiles(next);
    setProfiles(next);
    if (cleaned.id === activeId) {
      setActiveProfile(cleaned.id);
    }
    setMode({ kind: 'list' });
  };

  if (mode.kind === 'list') {
    return (
      <div className="profile-editor-screen">
        <div className="settings-topbar">
          <button type="button" className="settings-back-btn" onClick={() => onNavigate('home')}>
            Back to Home
          </button>
          <div className="settings-heading">Profiles</div>
        </div>

        <section className="settings-section">
          <div className="profile-list">
            {profiles.map((p) => (
              <div
                key={p.id}
                className={`profile-row${p.id === activeId ? ' profile-row-active' : ''}`}
              >
                <button
                  type="button"
                  className="profile-row-select"
                  onClick={() => selectActive(p.id)}
                >
                  <span className="profile-row-name">{p.name}</span>
                  {p.id === activeId && <span className="profile-row-badge">Active</span>}
                </button>
                <div className="profile-row-actions">
                  <button
                    type="button"
                    className="profile-action-btn"
                    onClick={() => startEdit(p)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="profile-action-btn"
                    onClick={() => duplicateProfile(p)}
                  >
                    Duplicate
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="profile-new-btn" onClick={startNew}>
            New Profile
          </button>
        </section>
      </div>
    );
  }

  return (
    <ProfileEditForm
      draft={mode.draft}
      isNew={mode.isNew}
      canDelete={profiles.length > 1}
      onSave={saveDraft}
      onCancel={cancelEdit}
      onDelete={() => deleteProfile(mode.draft.id)}
    />
  );
}

function ProfileEditForm({
  draft: initialDraft,
  isNew,
  canDelete,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Profile;
  isNew: boolean;
  canDelete: boolean;
  onSave: (draft: Profile) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<Profile>(initialDraft);

  const update = (patch: Partial<Profile>) => setDraft((d) => ({ ...d, ...patch }));
  const updateRules = (patch: Partial<RuleSet>) =>
    setDraft((d) => ({ ...d, rules: { ...d.rules, ...patch } }));
  const updateCvcx = (patch: Partial<NonNullable<Profile['cvcx']>>) =>
    setDraft((d) => ({ ...d, cvcx: { ...d.cvcx, ...patch } }));

  const updateSpreadRow = (index: number, patch: Partial<SpreadRow>) => {
    setDraft((d) => ({
      ...d,
      spread: d.spread.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    }));
  };

  const addSpreadRow = () => {
    setDraft((d) => ({ ...d, spread: [...d.spread, { minTc: 0, units: 1 }] }));
  };

  const removeSpreadRow = (index: number) => {
    setDraft((d) => ({ ...d, spread: d.spread.filter((_, i) => i !== index) }));
  };

  return (
    <div className="profile-editor-screen">
      <div className="settings-topbar">
        <button type="button" className="settings-back-btn" onClick={onCancel}>
          Cancel
        </button>
        <div className="settings-heading">{isNew ? 'New Profile' : 'Edit Profile'}</div>
      </div>

      <section className="settings-section">
        <h2 className="settings-section-title">Name</h2>
        <TextField label="Profile name" value={draft.name} onChange={(v) => update({ name: v })} />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Rules</h2>
        <div className="settings-row">
          <span className="settings-label">Decks</span>
          <Segmented
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '6', label: '6' },
              { value: '8', label: '8' },
            ]}
            value={String(draft.rules.decks)}
            onChange={(v) => updateRules({ decks: Number(v) as 1 | 2 | 6 | 8 })}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Dealer soft 17</span>
          <Segmented
            options={[
              { value: 'true', label: 'S17' },
              { value: 'false', label: 'H17' },
            ]}
            value={String(draft.rules.s17)}
            onChange={(v) => updateRules({ s17: v === 'true' })}
          />
        </div>
        <Toggle
          label="Double after split (DAS)"
          checked={draft.rules.das}
          onChange={(v) => updateRules({ das: v })}
        />
        <Toggle
          label="Late surrender (LS)"
          checked={draft.rules.ls}
          onChange={(v) => updateRules({ ls: v })}
        />
        <Toggle
          label="Resplit aces (RSA)"
          checked={draft.rules.rsa}
          onChange={(v) => updateRules({ rsa: v })}
        />
        <Toggle
          label="6:5 blackjack payout"
          checked={draft.rules.bj65}
          onChange={(v) => updateRules({ bj65: v })}
        />
        <Stepper
          label="Penetration"
          value={draft.penetration}
          min={0.5}
          max={0.9}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update({ penetration: v })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Bankroll &amp; count</h2>
        <Toggle
          label="Bet spread on"
          checked={draft.betSpreadOn}
          onChange={(v) => update({ betSpreadOn: v })}
        />
        <Stepper
          label="Starting bankroll"
          value={draft.bankrollStart}
          min={25}
          max={1000}
          step={25}
          onChange={(v) => update({ bankrollStart: v })}
        />
        <OptionalNumberField
          label="$ per unit"
          value={draft.unitDollars}
          onChange={(v) => update({ unitDollars: v })}
        />
        <Stepper
          label="Count check every"
          value={draft.countCheckEvery}
          min={0}
          max={20}
          step={1}
          format={(v) => (v === 0 ? 'off' : `${v} rounds`)}
          onChange={(v) => update({ countCheckEvery: v })}
        />
      </section>

      {draft.betSpreadOn && (
        <section className="settings-section">
          <h2 className="settings-section-title">Bet ramp</h2>
          <div className="spread-table">
            {draft.spread.map((row, i) => (
              <div className="spread-row" key={i}>
                <div className="spread-field">
                  <span className="spread-field-label">TC ≥</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => updateSpreadRow(i, { minTc: row.minTc - 1 })}
                    >
                      &minus;
                    </button>
                    <span className="stepper-value">{row.minTc}</span>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => updateSpreadRow(i, { minTc: row.minTc + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="spread-field">
                  <span className="spread-field-label">Units</span>
                  <div className="stepper">
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => updateSpreadRow(i, { units: Math.max(1, row.units - 1) })}
                    >
                      &minus;
                    </button>
                    <span className="stepper-value">{row.units}</span>
                    <button
                      type="button"
                      className="stepper-btn"
                      onClick={() => updateSpreadRow(i, { units: row.units + 1 })}
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  className="spread-remove-btn"
                  onClick={() => removeSpreadRow(i)}
                  disabled={draft.spread.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="spread-add-btn" onClick={addSpreadRow}>
            Add row
          </button>
          <p className="stats-detail">Ramp is sorted by TC when you save.</p>
        </section>
      )}

      <section className="settings-section">
        <h2 className="settings-section-title">CVCX</h2>
        <OptionalNumberField
          label="Score"
          value={draft.cvcx?.score}
          onChange={(v) => updateCvcx({ score: v })}
        />
        <OptionalNumberField
          label="EV / hour"
          value={draft.cvcx?.evPerHour}
          onChange={(v) => updateCvcx({ evPerHour: v })}
        />
        <OptionalNumberField
          label="Risk of ruin"
          value={draft.cvcx?.riskOfRuin}
          onChange={(v) => updateCvcx({ riskOfRuin: v })}
        />
        <TextField
          label="Sim note"
          value={draft.cvcx?.simNote ?? ''}
          onChange={(v) => updateCvcx({ simNote: v === '' ? undefined : v })}
          placeholder="optional"
        />
      </section>

      <section className="settings-section profile-edit-actions">
        <div className="profile-save-cancel-row">
          <button type="button" className="profile-save-btn" onClick={() => onSave(draft)}>
            Save
          </button>
          <button type="button" className="profile-cancel-btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {!isNew && (
          <button
            type="button"
            className="profile-delete-btn"
            onClick={onDelete}
            disabled={!canDelete}
          >
            Delete profile
          </button>
        )}
      </section>
    </div>
  );
}
