import { useEffect, useState } from 'react';
import type { Screen } from '../App';
import type { AudioSettings, Settings as SettingsData } from '../../store/types';
import { saveSettings } from '../../store/persist';
import { chime, isSpeechSupported, listVoices, speak } from '../../audio';

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
  disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-btn${opt.value === value ? ' segmented-btn-active' : ''}`}
          onClick={() => onChange(opt.value)}
          disabled={disabled}
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
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-label">{label}</span>
      <input
        type="checkbox"
        className="settings-toggle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
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
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const dec = () => onChange(clamp(round2(value - step), min, max));
  const inc = () => onChange(clamp(round2(value + step), min, max));
  return (
    <div className="settings-row">
      <span className="settings-label">{label}</span>
      <div className="stepper">
        <button type="button" className="stepper-btn" onClick={dec} disabled={disabled || value <= min}>
          &minus;
        </button>
        <span className="stepper-value">{format ? format(value) : value}</span>
        <button type="button" className="stepper-btn" onClick={inc} disabled={disabled || value >= max}>
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

  const updateAudio = (patch: Partial<AudioSettings>) => {
    update({ audio: { ...settings.audio, ...patch } });
  };

  const speechSupported = isSpeechSupported();
  const [voices, setVoices] = useState(() => listVoices());

  // Chrome loads voices asynchronously — the list is often empty on first
  // read and fires `voiceschanged` once the real list is ready.
  useEffect(() => {
    if (!speechSupported) return;
    const synth = window.speechSynthesis;
    const handleVoicesChanged = () => setVoices(listVoices());
    synth.onvoiceschanged = handleVoicesChanged;
    return () => {
      synth.onvoiceschanged = null;
    };
  }, [speechSupported]);

  const audioDisabled = !settings.audio.enabled;

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

      <section className="settings-section">
        <h2 className="settings-section-title">Audio</h2>
        <Toggle
          label="Audio enabled"
          checked={settings.audio.enabled}
          onChange={(v) => updateAudio({ enabled: v })}
        />
        <div className="settings-row">
          <span className="settings-label">Verbosity</span>
          <Segmented
            options={[
              { value: 'off', label: 'Off' },
              { value: 'results', label: 'Results' },
              { value: 'full', label: 'Full' },
            ]}
            value={settings.audio.verbosity}
            onChange={(v) => updateAudio({ verbosity: v })}
            disabled={audioDisabled}
          />
        </div>
        <div className="settings-row">
          <span className="settings-label">Card detail</span>
          <Segmented
            options={[
              { value: 'full', label: 'Full' },
              { value: 'rank', label: 'Rank' },
              { value: 'face', label: 'Face' },
            ]}
            value={settings.audio.cardDetail}
            onChange={(v) => updateAudio({ cardDetail: v })}
            disabled={audioDisabled}
          />
        </div>
        <Stepper
          label="Speech rate"
          value={settings.audio.rate}
          min={0.7}
          max={1.5}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(v) => updateAudio({ rate: v })}
          disabled={audioDisabled}
        />
        <div className="settings-row">
          <span className="settings-label">Voice</span>
          {speechSupported ? (
            <select
              className="settings-select"
              value={settings.audio.voiceURI}
              onChange={(e) => {
                const voiceURI = e.target.value;
                updateAudio({ voiceURI });
                speak('Queen. True count plus three.', {
                  interrupt: true,
                  rate: settings.audio.rate,
                  voiceURI,
                });
              }}
              disabled={audioDisabled}
            >
              <option value="default">Automatic (best available)</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          ) : (
            <select className="settings-select" disabled>
              <option>Speech not supported on this device</option>
            </select>
          )}
        </div>
        <Toggle
          label="Chimes"
          checked={settings.audio.chimes}
          onChange={(v) => updateAudio({ chimes: v })}
          disabled={audioDisabled}
        />
        <Stepper
          label="Answer pause"
          value={settings.audio.answerPauseMs}
          min={2000}
          max={5000}
          step={500}
          format={(v) => `${(v / 1000).toFixed(1)} s`}
          onChange={(v) => updateAudio({ answerPauseMs: v })}
          disabled={audioDisabled}
        />
        <div className="settings-row">
          <button
            type="button"
            className="settings-test-audio-btn"
            disabled={audioDisabled}
            onClick={() => {
              speak('Audio is working. True count plus three.', {
                interrupt: true,
                rate: settings.audio.rate,
                voiceURI: settings.audio.voiceURI,
              });
              if (settings.audio.chimes) {
                chime('good');
              }
            }}
          >
            Test audio
          </button>
        </div>
      </section>
    </div>
  );
}
