import { ALL_SCOPES, isAllScopes, scopesFrom, tapScope, withScopes } from '../../../drills/handScope';
import type { HandScope } from '../../../drills/handScope';
import type { Settings } from '../../../store/types';
import { saveSettings } from '../../../store/persist';
import { DECK_SOURCES, deckOf } from '../../../drills/deckSource';
import type { DeckSource } from '../../../drills/deckSource';
import './handDeckControls.css';
import './deckSelectFit.css';

const CHIP_LABEL: Record<HandScope, string> = { hard: 'Hard', soft: 'Soft', pairs: 'Pairs' };
const DECK_LABEL: Record<DeckSource, string> = {
  chart: 'Chart',
  custom: 'Custom',
  indexes: 'Indexes',
  marked: 'Marked',
};

/**
 * The hand drills' "what to deal" row: #13's Hard / Soft / Pairs scope as a
 * multi-select, and B2's deck source beside it.
 *
 * Scope: "All" lights when all three are chosen (and then the three stay
 * dark, so a tap on one of them narrows to it); otherwise each lit chip is in
 * the deal. The last chip cannot be switched off.
 *
 * Deck: where the cells come from -- the scoped chart, the painted Custom
 * selection, the cells with an index, or the marked cells. A native select,
 * because it shares the scope's row: on the phone the drill's hand and
 * answer bar have no spare height for a second one.
 */
/** The Deck select's last entry when the screen can open the Custom editor. */
const CUSTOMIZE = '__customize';

export function HandDeckControls({
  settings,
  onChange,
  onCustomize,
}: {
  settings: Settings;
  /** Called with the saved settings after a change. */
  onChange: (next: Settings) => void;
  /**
   * Wave M: open the Custom editor from inside the drill (owner: the deck
   * could only be painted from Home). An entry in the Deck select rather
   * than a button, because this row has no width to spare at 320.
   */
  onCustomize?: () => void;
}) {
  const scopes = scopesFrom(settings.drill);
  const all = isAllScopes(scopes);
  const deck = deckOf(settings.drill);
  const commit = (next: Settings) => {
    saveSettings(next);
    onChange(next);
  };
  const tap = (chip: HandScope | 'all') => {
    const nextScopes = tapScope(scopes, chip);
    if (nextScopes.length === scopes.length && nextScopes.every((s, i) => s === scopes[i])) return;
    commit(withScopes(settings, nextScopes));
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
      <span className="u-sr-only">Hands</span>
      <div className="scope-chips" role="group" aria-label="Hands">
        {chip('all', 'All', all)}
        {ALL_SCOPES.map((s) => chip(s, CHIP_LABEL[s], !all && scopes.includes(s)))}
      </div>
      <label className="deck-select deck-select-fit">
        <span className="deck-select-caption">Deck</span>
        {/* Wave M: the pill is as wide as the CHOSEN deck's name, not the
            longest option's (a native select sizes to its longest option, and
            "Customize…" pushed it over the Pairs chip at 320). */}
        <span className="deck-select-sizer" aria-hidden="true">
          {DECK_LABEL[deck]}
        </span>
        <select
          aria-label="Deck"
          value={deck}
          onChange={(e) => {
            if (e.target.value === CUSTOMIZE) {
              onCustomize?.();
              return;
            }
            const next = e.target.value as DeckSource;
            if (next !== deck) commit({ ...settings, drill: { ...settings.drill, deck: next } });
          }}
        >
          {DECK_SOURCES.map((d) => (
            <option key={d} value={d}>
              {DECK_LABEL[d]}
            </option>
          ))}
          {onCustomize && <option value={CUSTOMIZE}>Customize…</option>}
        </select>
      </label>
    </div>
  );
}
