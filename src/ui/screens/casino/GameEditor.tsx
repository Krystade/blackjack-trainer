import type { CasinoGame, DeckCount, MidShoeEntry, UNSURE_FIELDS } from '../../../store/casinoLog';
import { DEFAULT_ROUNDS_PER_HOUR, isHouseGame } from '../../../store/casinoLog';
import { PRESET_IDS, PRESET_LABEL, isPresetId } from '../../../engine/variants/rules';
import { Choice, Field, FieldGroup, MoneyInput } from './fields';
import type { GameText } from './casinoInputs';
import { SideBetsEditor } from './SideBetsEditor';

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

/** The "Marked unsure" line names fields as the editor labels them. */
const UNSURE_LABEL: Record<(typeof UNSURE_FIELDS)[number], string> = {
  decks: 'decks',
  s17: 'dealer soft 17',
  das: 'double after split',
  surrender: 'late surrender',
  payout: 'blackjack pays',
  cutDecksLeft: 'cut',
  minBet: 'min bet',
  maxBet: 'max bet',
  midShoeEntry: 'mid-shoe entry',
  csm: 'CSM',
  rsa: 'resplit aces',
  doubleSplitAces: 'double split aces',
  maxSplitHands: 'split to',
  doubleOn: 'double on',
  commissionPer100: 'commission',
};
const unsureLabel = (f: string): string => UNSURE_LABEL[f as keyof typeof UNSURE_LABEL] ?? f;

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
    <div className="cas-ge" data-testid="game-editor" data-index={index} data-game={game.id}>
      <div className="cas-ge-head">
        <span className="cas-ge-title" tabIndex={-1}>
          Game {index + 1}
        </span>
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
      {/* Wave L: the variant the app has a chart for; Wave M: the house's own name for the game, free text. */}
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
      <Field label="Variant name" hint={'Optional, the house\'s name, e.g. "Vegas Strip".'}>
        <input className="cas-input" name={n('variantName')} autoComplete="off" maxLength={60} value={game.variantName ?? ''} onChange={(e) => onChange({ variantName: e.target.value })} />
      </Field>
      {game.unsure && game.unsure.length > 0 && (
        <p className="cas-field-hint cas-ge-unsure" data-testid="game-unsure">
          Marked unsure: {game.unsure.map(unsureLabel).join(', ')}.{' '}
          <button type="button" className="cas-link" onClick={() => onChange({ unsure: undefined })}>
            Confirmed
          </button>
        </p>
      )}
      <FieldGroup label="Decks">
        <Choice
          label="Decks"
          value={game.decks ? String(game.decks) : 'unknown'}
          options={[
            { value: 'unknown', label: '?' },
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '4', label: '4' },
            { value: '5', label: '5' },
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
      {/* Wave M: the rest of the rules the owner's notes carry. */}
      <div className="cas-pair">
        <FieldGroup label="Resplit aces">
          <Choice label="Resplit aces" value={tri(game.rsa)} options={YES_NO} onChange={(v) => onChange({ rsa: fromTri(v) })} />
        </FieldGroup>
        <FieldGroup label="Double split aces">
          <Choice label="Double split aces" value={tri(game.doubleSplitAces)} options={YES_NO} onChange={(v) => onChange({ doubleSplitAces: fromTri(v) })} />
        </FieldGroup>
      </div>
      <div className="cas-pair">
        <FieldGroup label="Split to, hands" hint="? = 4, the best case: the figures may be too high.">
          <Choice
            label="Split to, hands"
            value={game.maxSplitHands ? String(game.maxSplitHands) : 'unknown'}
            options={[
              { value: 'unknown', label: '?' },
              { value: '2', label: '2' },
              { value: '3', label: '3' },
              { value: '4', label: '4' },
            ]}
            onChange={(v) => onChange({ maxSplitHands: v === 'unknown' ? null : (Number(v) as 2 | 3 | 4) })}
          />
        </FieldGroup>
        <Field label="Commission per $100" hint="Card rooms and some casinos. 0 = none.">
          <MoneyInput name={n('commission')} value={text.commission} onChange={(v) => onText({ commission: v })} />
        </Field>
      </div>
      <FieldGroup label="Double on" hint="? = any two, the best case: the figures may be too high.">
        <Choice
          label="Double on"
          value={game.doubleOn ?? 'unknown'}
          options={[
            { value: 'unknown', label: '?' },
            { value: 'any2', label: 'Any two' },
            { value: '9-11', label: '9-11' },
            { value: '10-11', label: '10-11' },
          ]}
          onChange={(v) => onChange({ doubleOn: v === 'unknown' ? null : v })}
        />
      </FieldGroup>
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
      {/* C9: card-room house games are not blackjack's rules; the simulator would score them as if they were. */}
      <label className="cas-check">
        <input
          type="checkbox"
          name={n('houseGame')}
          data-testid="game-house"
          checked={isHouseGame(game)}
          onChange={(e) => onChange({ houseGame: e.target.checked, houseGameDetected: undefined })}
        />
        <span>
          Card-room house game (jokers, Natural 22, no-bust): not modelled
          {/* C9 follow-up: an import ticked it from the game's own text; the owner has the last word. */}
          {game.houseGame === true && game.houseGameDetected === true && (
            <span className="cas-field-hint cas-house-detected" data-testid="game-house-detected">
              Detected house game, untick if wrong.
            </span>
          )}
        </span>
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
      {/* Wave L: side bets offered at this game. */}
      <SideBetsEditor sideBets={game.sideBets ?? []} name={n('side')} onChange={(sideBets) => onChange({ sideBets: sideBets.length > 0 ? sideBets : undefined })} />
      <Field label="Game notes">
        <input className="cas-input" name={n('gameNotes')} autoComplete="off" value={game.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </div>
  );
}
