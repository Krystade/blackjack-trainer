import type { Screen } from '../App';
import type { Settings as SettingsData } from '../../store/types';
import { saveSettings } from '../../store/persist';

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

export function Segmented<T extends string>({
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

export function Stepper({
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
          label="Count peek"
          checked={settings.countPeek}
          onChange={(v) => update({ countPeek: v })}
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
        <div className="settings-row settings-note-row">
          Game rules, bankroll &amp; bet spread live in Profiles now
        </div>
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
    </div>
  );
}
