import type { Action } from '../../engine/deviations';

export type ActionBarMode =
  | { kind: 'actions'; legal: Action[]; onAction: (a: Action) => void; advice?: Action }
  | {
      kind: 'bet';
      betSpreadOn: boolean;
      selectedBet: number;
      onSelectBet: (units: number) => void;
      onDeal: () => void;
      disabled?: boolean;
    }
  | { kind: 'hidden' };

interface ActionBarProps {
  mode: ActionBarMode;
}

const BET_CHIPS = [1, 2, 4, 8, 10, 12];

const ACTION_BUTTONS: { key: Action; label: string }[] = [
  { key: 'hit', label: 'Hit' },
  { key: 'stand', label: 'Stand' },
  { key: 'double', label: 'Double' },
  { key: 'split', label: 'Split' },
  { key: 'surrender', label: 'Surrender' },
];

export function ActionBar({ mode }: ActionBarProps) {
  if (mode.kind === 'hidden') {
    return <div className="action-bar action-bar-hidden" />;
  }

  if (mode.kind === 'actions') {
    return (
      <div className="action-bar" data-advice={mode.advice}>
        {ACTION_BUTTONS.map((btn) => (
          <button
            key={btn.key}
            type="button"
            className="action-btn"
            disabled={!mode.legal.includes(btn.key)}
            onClick={() => mode.onAction(btn.key)}
          >
            {btn.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="action-bar action-bar-bet">
      {mode.betSpreadOn && (
        <div className="bet-chips">
          {BET_CHIPS.map((units) => (
            <button
              key={units}
              type="button"
              className={`chip-btn${mode.selectedBet === units ? ' chip-selected' : ''}`}
              disabled={mode.disabled}
              onClick={() => mode.onSelectBet(units)}
            >
              {units}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="deal-btn" disabled={mode.disabled} onClick={mode.onDeal}>
        Deal
      </button>
    </div>
  );
}
