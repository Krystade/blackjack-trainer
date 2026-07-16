import type { Screen } from '../App';
import type { Settings as SettingsData } from '../../store/types';
import { saveSettings } from '../../store/persist';
import type { SpreadRow } from '../../engine/game';

interface SettingsProps {
  settings: SettingsData;
  onNavigate: (screen: Screen) => void;
  onSettingsChange: (settings: SettingsData) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-btn${opt.value === value ? ' segmented-btn-active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
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

function Stepper({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const dec = () => onChange(clamp(round2(value - step), min, max));
  const inc = () => onChange(clamp(round2(value + step), min, max));
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="stepper">
        <button type="button" className="stepper-btn" onClick={dec} disabled={value <= min}>
          &minus;
        </button>
        <span className="stepper-value">{format ? format(value) : value}</span>
        <button type="button" className="stepper-btn" onClick={inc} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  );
}

function sortSpread(rows: SpreadRow[]): SpreadRow[] {
  return [...rows].sort((a, b) => a.minTc - b.minTc);
}

export function Settings({ settings, onNavigate, onSettingsChange }: SettingsProps) {
  const commit = (next: SettingsData) => {
    saveSettings(next);
    onSettingsChange(next);
  };

  const update = (patch: Partial<SettingsData>) => {
    commit({ ...settings, ...patch });
  };

  const updateDrill = (patch: Partial<SettingsData['drill']>) => {
    update({ drill: { ...settings.drill, ...patch } });
  };

  const updateSpreadRow = (index: number, patch: Partial<SpreadRow>) => {
    const rows = settings.spread.map((r, i) => (i === index ? { ...r, ...patch } : r));
    update({ spread: sortSpread(rows) });
  };

  const addSpreadRow = () => {
    update({ spread: sortSpread([...settings.spread, { minTc: 0, units: 1 }]) });
  };

  const removeSpreadRow = (index: number) => {
    update({ spread: settings.spread.filter((_, i) => i !== index) });
  };

  return (
    <div className="settings-screen">
      <div className="settings-topbar">
        <button type="button" className="settings-back-btn" onClick={() => onNavigate('home')}>
          Back to Home
        </button>
        <div className="settings-heading">Settings</div>
      </div>

      <section className="settings-section">
        <h2 className="settings-section-title">Feedback mode</h2>
        <Segmented
          options={[
            { value: 'training', label: 'Training' },
            { value: 'test', label: 'Test' },
          ]}
          value={settings.feedbackMode}
          onChange={(v) => update({ feedbackMode: v })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Play</h2>
        <Toggle
          label="Bet spread on"
          checked={settings.betSpreadOn}
          onChange={(v) => update({ betSpreadOn: v })}
        />
        <Toggle
          label="Count peek"
          checked={settings.countPeek}
          onChange={(v) => update({ countPeek: v })}
        />
        <Stepper
          label="Starting bankroll"
          value={settings.bankrollStart}
          min={25}
          max={1000}
          step={25}
          onChange={(v) => update({ bankrollStart: v })}
        />
        <Stepper
          label="Count check every"
          value={settings.countCheckEvery}
          min={0}
          max={20}
          step={1}
          format={(v) => (v === 0 ? 'off' : `${v} rounds`)}
          onChange={(v) => update({ countCheckEvery: v })}
        />
        <Stepper
          label="Penetration"
          value={settings.penetration}
          min={0.5}
          max={0.9}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => update({ penetration: v })}
        />
        <Stepper
          label="Deal speed"
          value={settings.dealSpeedMs}
          min={0}
          max={1000}
          step={100}
          format={(v) => `${v}ms`}
          onChange={(v) => update({ dealSpeedMs: v })}
        />
      </section>

      <section className="settings-section">
        <h2 className="settings-section-title">Drills</h2>
        <div className="settings-row">
          <span className="settings-label">Flashcard category</span>
          <Segmented
            options={[
              { value: 'all', label: 'All' },
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pairs', label: 'Pairs' },
            ]}
            value={settings.drill.flashCategory}
            onChange={(v) => updateDrill({ flashCategory: v })}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Count group size</span>
          <Segmented
            options={[
              { value: '1', label: '1' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
            value={String(settings.drill.countGroup)}
            onChange={(v) => updateDrill({ countGroup: Number(v) as 1 | 2 | 3 })}
          />
        </div>
        <Stepper
          label="Count interval"
          value={settings.drill.countIntervalMs}
          min={300}
          max={3000}
          step={100}
          format={(v) => `${v}ms`}
          onChange={(v) => updateDrill({ countIntervalMs: v })}
        />
        <Stepper
          label="Count length"
          value={settings.drill.countLengthCards}
          min={13}
          max={312}
          step={13}
          format={(v) => `${v} cards`}
          onChange={(v) => updateDrill({ countLengthCards: v })}
        />
      </section>

      {settings.betSpreadOn && (
      <section className="settings-section">
        <h2 className="settings-section-title">Bet spread</h2>
        <div className="spread-table">
          {settings.spread.map((row, i) => (
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
                disabled={settings.spread.length <= 1}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="spread-add-btn" onClick={addSpreadRow}>
          Add row
        </button>
      </section>
      )}
    </div>
  );
}
