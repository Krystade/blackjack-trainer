import { useState, type ReactNode } from 'react';
import { HEAT_LEVELS, type HeatLevel } from '../../../store/casinoLog';
import { HEAT_HINT, HEAT_LABEL, heatTone } from '../../casinoFigures';

/**
 * The Casino tab's form pieces. Every text field is 16px: iOS zooms the page
 * into any input set smaller than that, and a zoomed form on a 375px phone
 * hides the button you were about to press.
 */

/** A labelled field: the caption above, the control below, an optional hint under it. */
export function Field({ label, hint, children, error }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <label className="cas-field">
      <span className="cas-field-label">{label}</span>
      {children}
      {error ? (
        <span className="cas-field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="cas-field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * A captioned block of buttons. Not a <label>: a label activates the first
 * button inside it when its caption is tapped, which would pick an option.
 */
export function FieldGroup({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="cas-field">
      <span className="cas-field-label">{label}</span>
      {children}
      {hint ? <span className="cas-field-hint">{hint}</span> : null}
    </div>
  );
}

/** A dollar amount: decimal keypad, "$" drawn in front. */
export function MoneyInput({
  value,
  onChange,
  name,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  name: string;
  placeholder?: string;
}) {
  return (
    <span className="cas-money">
      <span className="cas-money-sign" aria-hidden="true">
        $
      </span>
      <input
        className="cas-input cas-money-input"
        name={name}
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

/** One choice of several, as a row of buttons (the app's `.segmented`). */
export function Choice<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented cas-choice" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`segmented-btn${opt.value === value ? ' segmented-btn-active' : ''}`}
          aria-pressed={opt.value === value}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** The six heat levels, each with what it means. */
export function HeatPicker({ value, onChange }: { value: HeatLevel; onChange: (h: HeatLevel) => void }) {
  return (
    <div className="cas-heat-grid" role="group" aria-label="Heat">
      {HEAT_LEVELS.map((h) => (
        <button
          key={h}
          type="button"
          className="cas-heat-opt"
          data-tone={heatTone(h)}
          aria-pressed={h === value}
          onClick={() => onChange(h)}
        >
          <span className="cas-heat-opt-name">{HEAT_LABEL[h]}</span>
          <span className="cas-heat-opt-hint">{HEAT_HINT[h]}</span>
        </button>
      ))}
    </div>
  );
}

/** A heat badge for rows; nothing for no heat. */
export function HeatBadge({ heat, prefix }: { heat: HeatLevel; prefix?: string }) {
  if (heat === 'none') return null;
  return (
    <span className="cas-badge" data-tone={heatTone(heat)} data-testid="heat-badge">
      {prefix}
      {HEAT_LABEL[heat]}
    </span>
  );
}

/**
 * Delete in two taps, said in words: the first tap asks, naming what goes,
 * and the second does it. No browser dialog, so it reads the same in the
 * installed app and in tests.
 */
export function DeleteButton({ label, question, onDelete }: { label: string; question: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button type="button" className="u-btn u-btn-danger cas-wide" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <div className="cas-confirm" role="group" aria-label="Confirm delete">
      <p className="cas-confirm-q">{question}</p>
      <div className="cas-btn-row">
        <button type="button" className="u-btn" onClick={() => setAsking(false)}>
          Keep it
        </button>
        <button type="button" className="u-btn u-btn-danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
