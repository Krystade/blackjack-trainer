import { ALL_SCOPES, isAllScopes, scopesFrom, tapScope, withScopes } from '../../../drills/handScope';
import type { HandScope } from '../../../drills/handScope';
import type { Settings } from '../../../store/types';
import { saveSettings } from '../../../store/persist';
import './handDeckControls.css';

const CHIP_LABEL: Record<HandScope, string> = { hard: 'Hard', soft: 'Soft', pairs: 'Pairs' };

/**
 * #13: the hand drills' Hard / Soft / Pairs control, as a multi-select.
 *
 * "All" lights when all three are chosen (and then the three stay dark, so a
 * tap on one of them narrows to it); otherwise each lit chip is in the deal.
 * The last chip cannot be switched off.
 */
export function ScopeChips({
  settings,
  onChange,
}: {
  settings: Settings;
  /** Called with the saved settings after a tap that changed the scope. */
  onChange: (next: Settings) => void;
}) {
  const scopes = scopesFrom(settings.drill);
  const all = isAllScopes(scopes);
  const tap = (chip: HandScope | 'all') => {
    const nextScopes = tapScope(scopes, chip);
    if (nextScopes.length === scopes.length && nextScopes.every((s, i) => s === scopes[i])) return;
    const next = withScopes(settings, nextScopes);
    saveSettings(next);
    onChange(next);
  };
  const chip = (value: HandScope | 'all', label: string, on: boolean) => (
    <button
      key={value}
      type="button"
      className={`scope-chip${on ? ' scope-chip-on' : ''}`}
      aria-pressed={on}
      onClick={() => tap(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="settings-row scope-row">
      <span className="settings-label">Hands</span>
      <div className="scope-chips" role="group" aria-label="Hands">
        {chip('all', 'All', all)}
        {ALL_SCOPES.map((s) => chip(s, CHIP_LABEL[s], !all && scopes.includes(s)))}
      </div>
    </div>
  );
}
