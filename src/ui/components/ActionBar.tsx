import type { Action } from '../../engine/deviations';

/** One bet-entry row per player hand. Length 1 (solo, the v1/parity case) or
 * playerHands (Cycle-2 Task 8 multi-hand bet entry). */
export interface BetHandEntry {
  selectedBet: number;
  onSelectBet: (units: number) => void;
}

export type ActionBarMode =
  | { kind: 'actions'; legal: Action[]; onAction: (a: Action) => void; advice?: Action }
  | {
      kind: 'bet';
      betSpreadOn: boolean;
      hands: BetHandEntry[];
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

  // Solo bet phase (playerHands === 1, the overwhelmingly common case): keep
  // the markup byte-identical to pre-Task-8 so the parity e2e specs (which
  // assert `.bet-chips` / chip-btn / Deal in this exact shape) keep passing.
  if (mode.hands.length <= 1) {
    const single = mode.hands[0];
    return (
      <div className="action-bar action-bar-bet">
        {mode.betSpreadOn && single && (
          <div className="bet-chips">
            {BET_CHIPS.map((units) => (
              <button
                key={units}
                type="button"
                className={`chip-btn${single.selectedBet === units ? ' chip-selected' : ''}`}
                disabled={mode.disabled}
                onClick={() => single.onSelectBet(units)}
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

  // Multi-hand bet entry (Cycle-2 Task 8): one compact stepper row per hand
  // rather than a full chip grid — playerHands x 6 chips wraps to several
  // rows and no longer fits a 320-844px screen alongside the table above it.
  // Cycles through the same BET_CHIPS units the solo chip row offers.
  return (
    <div className="action-bar action-bar-bet action-bar-bet-multi">
      {mode.betSpreadOn && (
        <div className="bet-hands">
          {mode.hands.map((hand, i) => {
            const idx = BET_CHIPS.indexOf(hand.selectedBet);
            const canDec = idx > 0;
            const canInc = idx === -1 || idx < BET_CHIPS.length - 1;
            return (
              <div key={i} className="bet-hand-row">
                <div className="bet-hand-label">Hand {i + 1}</div>
                <div className="bet-stepper">
                  <button
                    type="button"
                    className="bet-step-btn"
                    aria-label={`Hand ${i + 1} lower bet`}
                    disabled={mode.disabled || !canDec}
                    onClick={() => hand.onSelectBet(BET_CHIPS[Math.max(0, idx - 1)])}
                  >
                    −
                  </button>
                  <div className="bet-stepper-value">{hand.selectedBet}u</div>
                  <button
                    type="button"
                    className="bet-step-btn"
                    aria-label={`Hand ${i + 1} raise bet`}
                    disabled={mode.disabled || !canInc}
                    onClick={() => hand.onSelectBet(BET_CHIPS[Math.min(BET_CHIPS.length - 1, idx + 1)])}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="deal-btn" disabled={mode.disabled} onClick={mode.onDeal}>
        Deal
      </button>
    </div>
  );
}
