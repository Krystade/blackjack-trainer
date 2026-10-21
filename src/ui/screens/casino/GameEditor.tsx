import type { CasinoGame, DeckCount, MidShoeEntry } from '../../../store/casinoLog';
import { DEFAULT_ROUNDS_PER_HOUR } from '../../../store/casinoLog';
import { PRESET_IDS, PRESET_LABEL, isPresetId } from '../../../engine/variants/rules';
import { Choice, Field, FieldGroup, MoneyInput } from './fields';
import type { GameText } from './casinoInputs';

/**
 * Wave K: one game's block in the casino form. A casino can deal several;
 * each has its own rules, cut, limits, mid-shoe rule, CSM flag, pace and
 * notes. The number fields are text here and parsed on Save (`GameText`).
 */

type Tri = 'unknown' | 'yes' | 'no';
const tri = (b: boolean | null | undefined): Tri => (b === true ? 'yes' : b === false ? 'no' : 'unknown');
const fromTri = (t: Tri): boolean | null => (t === 'yes' ? true : t === 'no' ? false : null);

const YES_NO = [
  { value: 'unknown', label: '?' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;


export function GameEditor({
  game,
  text,
  index,
  count,
  onChange,
  onText,
  onRemove,
  onStats,
}: {
  game: CasinoGame;
  text: GameText;
  index: number;
  count: number;
  onChange: (patch: Partial<CasinoGame>) => void;
  onText: (patch: Partial<GameText>) => void;
  onRemove: () => void;
  /** Present when the game is saved and the form untouched: open its stats card. */
  onStats?: () => void;
}) {
  const n = (name: string) => `${name}-${index}`;
  return (
    <div className="cas-ge" data-testid="game-editor" data-index={index}>
      <div className="cas-ge-head">
        <span className="cas-ge-title">Game {index + 1}</span>
        <span className="cas-ge-actions">
          {onStats && (
            <button type="button" className="cas-link" onClick={onStats} data-testid="game-stats-link">
              Stats ›
            </button>
          )}
          {count > 1 && (
            <button type="button" className="cas-link cas-ge-remove" onClick={onRemove} data-testid="remove-game">
              Remove
            </button>
          )}
        </span>
      </div>
      <Field label="Label" hint={'Optional, e.g. "DD pit 3".'}>
        <input className="cas-input" name={n('label')} autoComplete="off" maxLength={60} value={game.label ?? ''} onChange={(e) => onChange({ label: e.target.value })} />
      </Field>
      <Field label="Game" hint="A variant gets its house edge from its own chart; counting is not modelled for it.">
        <select
          className="cas-input"
          name={n('variant')}
          data-testid="game-variant"
          value={game.variant ?? 'standard'}
          onChange={(e) => onChange({ variant: isPresetId(e.target.value) ? e.target.value : undefined })}
        >
          <option value="standard">Standard blackjack</option>
          {PRESET_IDS.map((id) => (
            <option key={id} value={id}>
              {PRESET_LABEL[id]}
            </option>
          ))}
        </select>
      </Field>
      <FieldGroup label="Decks">
        <Choice
          label="Decks"
          value={game.decks ? String(game.decks) : 'unknown'}
          options={[
            { value: 'unknown', label: '?' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '6', label: '6' },
            { value: '8', label: '8' },
          ]}
          onChange={(v) => onChange({ decks: v === 'unknown' ? null : (Number(v) as DeckCount) })}
        />
      </FieldGroup>
      <FieldGroup label="Dealer soft 17">
        <Choice
          label="Dealer soft 17"
          value={game.s17 === true ? 's17' : game.s17 === false ? 'h17' : 'unknown'}
          options={[
            { value: 'unknown', label: '?' },
            { value: 's17', label: 'Stands (S17)' },
            { value: 'h17', label: 'Hits (H17)' },
          ]}
          onChange={(v) => onChange({ s17: v === 's17' ? true : v === 'h17' ? false : null })}
        />
      </FieldGroup>
      <div className="cas-pair">
        <FieldGroup label="Double after split">
          <Choice label="Double after split" value={tri(game.das)} options={YES_NO} onChange={(v) => onChange({ das: fromTri(v) })} />
        </FieldGroup>
        <FieldGroup label="Late surrender">
          <Choice label="Late surrender" value={tri(game.surrender)} options={YES_NO} onChange={(v) => onChange({ surrender: fromTri(v) })} />
        </FieldGroup>
      </div>
      <div className="cas-pair">
        <FieldGroup label="Blackjack pays">
          <Choice
            label="Blackjack pays"
            value={game.payout ?? 'unknown'}
            options={[
              { value: 'unknown', label: '?' },
              { value: '3:2', label: '3:2' },
              { value: '6:5', label: '6:5' },
            ]}
            onChange={(v) => onChange({ payout: v === 'unknown' ? null : v })}
          />
        </FieldGroup>
        <Field label="Cut at, decks left">
          <input
            className="cas-input"
            name={n('cutDecksLeft')}
            inputMode="decimal"
            autoComplete="off"
            placeholder="e.g. 1.5"
            value={text.cut}
            onChange={(e) => onText({ cut: e.target.value })}
          />
        </Field>
      </div>
      <div className="cas-pair">
        <Field label="Min bet">
          <MoneyInput name={n('minBet')} value={text.minBet} onChange={(v) => onText({ minBet: v })} />
        </Field>
        <Field label="Max bet">
          <MoneyInput name={n('maxBet')} value={text.maxBet} onChange={(v) => onText({ maxBet: v })} />
        </Field>
      </div>
      <FieldGroup label="Mid-shoe entry" hint="Back-counting needs it.">
        <Choice
          label="Mid-shoe entry"
          value={game.midShoeEntry}
          options={[
            { value: 'unknown', label: '?' },
            { value: 'allowed', label: 'Allowed' },
            { value: 'no', label: 'Not allowed' },
          ]}
          onChange={(v: MidShoeEntry) => onChange({ midShoeEntry: v })}
        />
      </FieldGroup>
      <label className="cas-check">
        <input type="checkbox" name={n('csm')} checked={game.csm} onChange={(e) => onChange({ csm: e.target.checked })} />
        <span>Continuous shuffler (CSM): counting is impossible</span>
      </label>
      <Field label="Rounds per hour" hint={`Blank = ${DEFAULT_ROUNDS_PER_HOUR}. Fewer at a full table.`}>
        <input
          className="cas-input"
          name={n('roundsPerHour')}
          inputMode="numeric"
          autoComplete="off"
          placeholder={String(DEFAULT_ROUNDS_PER_HOUR)}
          value={text.roundsPerHour}
          onChange={(e) => onText({ roundsPerHour: e.target.value })}
        />
      </Field>
      <Field label="Game notes">
        <input className="cas-input" name={n('gameNotes')} autoComplete="off" value={game.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </div>
  );
}
