import { useState } from 'react';
import './casinoSideBets.css';
import { BET_NAMES, SIDE_BET_IDS, payTablesFor } from '../../../engine/sideBets/payTables';
import type { SideBetId } from '../../../engine/sideBets/payTables';
import type { CasinoSideBet } from '../../../store/casinoSideBets';

/**
 * Wave L: the side bets a game offers, in the game's block of the casino
 * form. Each is a bet, one of its preset pay tables, and the side bet's own
 * limits (blank = not known; the stats card then assumes $25).
 */

const amount = (v: string): number | null => {
  const n = Number(v.replace(/[$,\s]/g, ''));
  return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null;
};

function MoneyCell({ label, value, onChange, name }: { label: string; value: number | null | undefined; onChange: (v: number | null) => void; name: string }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <label className="cas-field cas-sb-money">
      <span className="cas-field-label">{label}</span>
      <input
        className="cas-input"
        name={name}
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(amount(e.target.value));
        }}
      />
    </label>
  );
}

export function SideBetsEditor({
  sideBets,
  onChange,
  name,
}: {
  sideBets: readonly CasinoSideBet[];
  onChange: (next: CasinoSideBet[]) => void;
  name: string;
}) {
  const free = SIDE_BET_IDS.filter((id) => !sideBets.some((s) => s.bet === id));
  const set = (i: number, patch: Partial<CasinoSideBet>) => onChange(sideBets.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="cas-sb" data-testid="side-bets-editor">
      <span className="cas-field-label">Side bets</span>
      {sideBets.map((s, i) => (
        <div key={s.bet} className="cas-sb-row" data-testid="side-bet-row" data-bet={s.bet}>
          <div className="cas-sb-top">
            <span className="cas-sb-name">{BET_NAMES[s.bet]}</span>
            <button type="button" className="cas-link" onClick={() => onChange(sideBets.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
          <label className="cas-field">
            <span className="cas-field-label">Pay table</span>
            <select className="cas-input" name={`${name}-sb-${s.bet}-table`} value={s.payTable} onChange={(e) => set(i, { payTable: e.target.value })}>
              {payTablesFor(s.bet).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <div className="cas-pair">
            <MoneyCell label="Side min" name={`${name}-sb-${s.bet}-min`} value={s.minBet} onChange={(v) => set(i, { minBet: v })} />
            <MoneyCell label="Side max" name={`${name}-sb-${s.bet}-max`} value={s.maxBet} onChange={(v) => set(i, { maxBet: v })} />
          </div>
        </div>
      ))}
      {free.length > 0 && (
        <select
          className="cas-input cas-sb-add"
          name={`${name}-sb-add`}
          aria-label="Add a side bet"
          data-testid="add-side-bet"
          value=""
          onChange={(e) => {
            const bet = e.target.value as SideBetId;
            if (!bet) return;
            onChange([...sideBets, { bet, payTable: payTablesFor(bet)[0]!.id, minBet: null, maxBet: null }]);
          }}
        >
          <option value="">+ Add a side bet</option>
          {free.map((id) => (
            <option key={id} value={id}>
              {BET_NAMES[id]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
