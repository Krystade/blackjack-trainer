import type { Action } from '../../engine/deviations';
import { actionButtons, type Handedness } from './actionOrder';
import './inOutToggle.css';
import './sideBetChip.css';
import './handsChoice.css';
import './drillActionLabels.css';
import './chips.css';
import { shortDollars, topDenom } from '../chips';

/** One bet-entry row per player hand. Length 1 (solo, the v1/parity case) or
 * playerHands (Cycle-2 Task 8 multi-hand bet entry). */
export interface BetHandEntry {
  selectedBet: number;
  onSelectBet: (units: number) => void;
}

export type ActionBarMode =
  | {
      kind: 'actions';
      legal: Action[];
      onAction: (a: Action) => void;
      advice?: Action;
      /** The hand holding the phone (Settings.handedness); absent = 'right'. */
      hand?: Handedness;
    }
  | {
      kind: 'bet';
      betSpreadOn: boolean;
      hands: BetHandEntry[];
      /** Deal the next round -- with the player in or out, as the toggle says. */
      onDeal: () => void;
      /**
       * Track 3: Show chips -- bets in dollars at `unit` a unit, and between
       * rounds the line saying what to pull back for the next bet. Absent: the
       * units bar, markup unchanged.
       */
      money?: { unit: number; pullBack: string | null };
      /**
       * Wave J toggle rework: the In/Out toggle, beside Deal on every table.
       * It replaces Sit out and the watcher's Watch / Sit in pair: Out, the
       * round is dealt without the player at the same table (the shoe and the
       * count move on); it stays where it is put until flipped.
       */
      inOut: { isIn: boolean; onSet: (isIn: boolean) => void; locked?: boolean };
      disabled?: boolean;
      /**
       * Wave J: the ramp spreads to two hands, so the round opens with one or
       * two -- chosen here, staked at the selected chip each. Absent on every
       * other table, which keeps its bar exactly as it was.
       */
      handsChoice?: { hands: 1 | 2; onHands: (hands: 1 | 2) => void };
      /**
       * Wave L: the profile's side bet, a chip that stays where it is put (as
       * the In/Out toggle does). Absent on every table without one.
       */
      side?: { on: boolean; label: string; stake: string; onSet: (on: boolean) => void };
    }
  | { kind: 'hidden' };

interface ActionBarProps {
  mode: ActionBarMode;
}

const BET_CHIPS = [1, 2, 4, 8, 10, 12];

/** Wave J: one hand or two, for a ramp that spreads hands. */
function HandsChoice({ hands, onHands, disabled }: { hands: 1 | 2; onHands: (h: 1 | 2) => void; disabled?: boolean }) {
  return (
    <div className="hands-choice" role="group" aria-label="Hands this round" data-hands={hands}>
      {([1, 2] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={`hands-choice-btn${hands === n ? ' hands-choice-on' : ''}`}
          aria-pressed={hands === n}
          aria-label={n === 1 ? '1 hand' : '2 hands'}
          disabled={disabled}
          onClick={() => onHands(n)}
        >
          ×{n}
        </button>
      ))}
    </div>
  );
}

/**
 * Wave J toggle rework: In or Out, a two-state switch. Two halves, the one in
 * force pressed (aria-pressed), each a full thumb-sized target.
 */
function InOutToggle({ isIn, onSet, disabled }: { isIn: boolean; onSet: (isIn: boolean) => void; disabled?: boolean }) {
  return (
    <div className="in-out-toggle" role="group" aria-label="In or out" data-in={isIn ? 'true' : 'false'}>
      {([true, false] as const).map((v) => (
        <button
          key={String(v)}
          type="button"
          className={`in-out-btn in-out-${v ? 'in' : 'out'}${isIn === v ? ' in-out-on' : ''}`}
          aria-pressed={isIn === v}
          disabled={disabled}
          onClick={() => onSet(v)}
        >
          {v ? 'In' : 'Out'}
        </button>
      ))}
    </div>
  );
}

/** Track 3: one bet chip, in units or (Show chips) dollars in the bet's top chip colour. */
function BetChip({ units, selected, disabled, money, onSelect }: {
  units: number;
  selected: boolean;
  disabled?: boolean;
  money?: { unit: number };
  onSelect: () => void;
}) {
  const amount = money ? units * money.unit : 0;
  return (
    <button
      type="button"
      className={`chip-btn${selected ? ' chip-selected' : ''}${money ? ' chip-money' : ''}`}
      disabled={disabled}
      onClick={onSelect}
      {...(money ? { 'data-chip': String(topDenom(amount)), 'data-units': units, 'aria-label': `${shortDollars(amount)}, ${units} unit${units === 1 ? '' : 's'}` } : {})}
    >
      {money ? shortDollars(amount) : units}
    </button>
  );
}

/** Track 3: between rounds with chips on, what to pull back (or add) for the next bet. */
function PullBack({ mode }: { mode: Extract<ActionBarMode, { kind: 'bet' }> }) {
  if (!mode.money?.pullBack) return null;
  return (
    <div className="bet-pullback" data-testid="bet-pullback">
      {mode.money.pullBack}
    </div>
  );
}

/** The bottom row of the bet bar: the toggle, then Deal. */
function DealRow({ mode }: { mode: Extract<ActionBarMode, { kind: 'bet' }> }) {
  return (
    <div className="deal-row">
      <InOutToggle isIn={mode.inOut.isIn} onSet={mode.inOut.onSet} disabled={mode.disabled || mode.inOut.locked} />
      {mode.side && (
        <button
          type="button"
          className={`side-chip${mode.side.on ? ' side-chip-on' : ''}`}
          aria-pressed={mode.side.on}
          aria-label={`Side bet: ${mode.side.label}, ${mode.side.stake}`}
          data-testid="side-chip"
          disabled={mode.disabled || !mode.inOut.isIn}
          onClick={() => mode.side!.onSet(!mode.side!.on)}
        >
          <span className="side-chip-name">{mode.side.label}</span>
          <span className="side-chip-stake">{mode.side.stake}</span>
        </button>
      )}
      <button type="button" className="deal-btn" disabled={mode.disabled} onClick={mode.onDeal}>
        Deal
      </button>
    </div>
  );
}

export function ActionBar({ mode }: ActionBarProps) {
  if (mode.kind === 'hidden') {
    return <div className="action-bar action-bar-hidden" />;
  }

  if (mode.kind === 'actions') {
    return (
      <div className="action-bar action-bar-actions" data-advice={mode.advice} data-hand={mode.hand ?? 'right'}>
        {actionButtons(mode.hand).map((btn) => (
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
        <PullBack mode={mode} />
        {mode.betSpreadOn && single && (
          // Review B1: the hands toggle ends the chip row rather than taking a
          // row of its own above it.
          <div className={`bet-chips${mode.handsChoice ? ' bet-chips-hands' : ''}`}>
            {BET_CHIPS.map((units) => (
              <BetChip
                key={units}
                units={units}
                selected={single.selectedBet === units}
                disabled={mode.disabled}
                money={mode.money}
                onSelect={() => single.onSelectBet(units)}
              />
            ))}
            {mode.handsChoice && (
              <HandsChoice hands={mode.handsChoice.hands} onHands={mode.handsChoice.onHands} disabled={mode.disabled} />
            )}
          </div>
        )}
        <DealRow mode={mode} />
      </div>
    );
  }

  // Multi-hand bet entry (Cycle-2 Task 8): one compact stepper row per hand
  // rather than a full chip grid — playerHands x 6 chips wraps to several
  // rows and no longer fits a 320-844px screen alongside the table above it.
  // Cycles through the same BET_CHIPS units the solo chip row offers.
  return (
    <div className="action-bar action-bar-bet action-bar-bet-multi">
      <PullBack mode={mode} />
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
                    aria-label={`Lower bet on hand ${i + 1}`}
                    disabled={mode.disabled || !canDec}
                    onClick={() => hand.onSelectBet(BET_CHIPS[Math.max(0, idx - 1)])}
                  >
                    −
                  </button>
                  <div className="bet-stepper-value">
                    {mode.money ? shortDollars(hand.selectedBet * mode.money.unit) : `${hand.selectedBet}u`}
                  </div>
                  <button
                    type="button"
                    className="bet-step-btn"
                    aria-label={`Raise bet on hand ${i + 1}`}
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
      <DealRow mode={mode} />
    </div>
  );
}
