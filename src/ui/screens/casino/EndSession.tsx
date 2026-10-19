import { useEffect, useState } from 'react';
import { casinoById, endSession, type CasinoLog, type HeatLevel } from '../../../store/casinoLog';
import {
  buyInTotal,
  burnSuggestion,
  hoursText,
  localDateKey,
  money,
  parseMoney,
  sessionHours,
  signedMoney,
} from '../../casinoFigures';
import { Field, FieldGroup, HeatPicker, MoneyInput } from './fields';
import type { CasinoView } from './Casino';

/** A whole number from a field: blank is null, junk is NaN. */
function parseWhole(text: string): number | null {
  const t = text.trim().replace(/^−/, '-');
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : Number.NaN;
}

/**
 * Cash out: the amount, the heat, and the optional detail. A back-off or a
 * trespass offers to burn the casino (six months for a back-off, editable;
 * indefinitely for a trespass), ticked by default -- the moment you are told
 * to leave is the moment you will remember to record it.
 */
export function EndSession({
  log,
  sessionId,
  commit,
  go,
  onDirty,
}: {
  log: CasinoLog;
  sessionId: string;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const session = log.sessions.find((s) => s.id === sessionId);
  const [cashOut, setCashOut] = useState('');
  const [heat, setHeat] = useState<HeatLevel>(session?.heat ?? 'none');
  const [avgBet, setAvgBet] = useState('');
  const [maxBet, setMaxBet] = useState('');
  const [maxTc, setMaxTc] = useState('');
  const [tables, setTables] = useState('');
  const [notes, setNotes] = useState('');
  const [opened] = useState(() => Date.now());
  const today = localDateKey(opened);
  const [burn, setBurn] = useState(true);
  const [until, setUntil] = useState<string>(() => burnSuggestion(session?.heat ?? 'none', today)?.until ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onDirty(cashOut !== '' || avgBet !== '' || maxBet !== '' || maxTc !== '' || tables !== '' || notes !== '');
  }, [cashOut, avgBet, maxBet, maxTc, tables, notes, onDirty]);

  const suggestion = burnSuggestion(heat, today);
  // A different heat level brings its own suggestion: the date resets to it
  // and the burn is offered ticked again.
  const pickHeat = (h: HeatLevel) => {
    setHeat(h);
    setUntil(burnSuggestion(h, today)?.until ?? '');
    setBurn(true);
  };

  if (!session || session.end !== null) {
    return (
      <div className="cas-form cas-pad">
        <p className="cas-note">That session has already ended.</p>
        <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'home' })}>
          Back to Casino
        </button>
      </div>
    );
  }

  const casino = casinoById(log, session.casinoId);
  const total = buyInTotal(session);
  const out = parseMoney(cashOut);
  const net = out === null || Number.isNaN(out) ? null : out - total;
  const hours = sessionHours(session, opened);

  const finish = () => {
    if (out === null || Number.isNaN(out)) {
      setError('Enter what you cashed out, in dollars (0 if nothing).');
      return;
    }
    const extras = { avg: parseMoney(avgBet), max: parseMoney(maxBet), tc: parseWhole(maxTc) };
    if (Number.isNaN(extras.avg) || Number.isNaN(extras.max) || Number.isNaN(extras.tc)) {
      setError('Bets are dollar amounts and the true count a whole number. Fix or clear them.');
      return;
    }
    commit(
      endSession(
        log,
        session.id,
        {
          cashOut: out,
          heat,
          avgBet: extras.avg,
          maxBet: extras.max,
          maxTc: extras.tc,
          tables,
          notes: notes.trim(),
          burn: suggestion && burn ? { until: suggestion.until === null ? null : until || null } : null,
        },
        Date.now(),
      ),
    );
    go({ kind: 'home' });
  };

  return (
    <div className="cas-form" data-testid="end-session">
      <section className="cas-end-head cas-pad" aria-label="This session">
        <h2 className="cas-end-name">{casino?.name ?? 'Deleted casino'}</h2>
        <div className="cas-end-figs">
          <div className="cas-stat">
            <span className="cas-stat-label">Bought in</span>
            <span className="cas-stat-value">{money(total)}</span>
          </div>
          <div className="cas-stat">
            <span className="cas-stat-label">Hours</span>
            <span className="cas-stat-value" data-testid="end-hours">
              {hoursText(hours)}
            </span>
          </div>
          <div className="cas-stat">
            <span className="cas-stat-label">Net</span>
            <span className="cas-stat-value" data-sign={net === null ? 0 : Math.sign(net)} data-testid="end-net">
              {net === null ? '—' : signedMoney(net)}
            </span>
          </div>
        </div>
      </section>

      <div className="cas-pad-x cas-stack">
        <Field label="Cash-out">
          <MoneyInput name="cashOut" value={cashOut} onChange={setCashOut} placeholder="0" />
        </Field>

        <FieldGroup label="Heat">
          <HeatPicker value={heat} onChange={pickHeat} />
        </FieldGroup>

        {suggestion && casino && (
          <div className="cas-burn" data-testid="burn-offer">
            <label className="cas-check">
              <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} />
              <span>
                Mark {casino.name} burned {suggestion.until === null ? 'indefinitely' : ''}
              </span>
            </label>
            {suggestion.until !== null && burn && (
              <Field label="Cool-off until" hint="Six months is the usual wait after a back-off. Clear it for indefinitely.">
                <input
                  type="date"
                  className="cas-input"
                  name="burnUntil"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
            )}
          </div>
        )}

        <div className="cas-pair">
          <Field label="Average bet">
            <MoneyInput name="avgBet" value={avgBet} onChange={setAvgBet} />
          </Field>
          <Field label="Max bet">
            <MoneyInput name="maxBet" value={maxBet} onChange={setMaxBet} />
          </Field>
        </div>
        <Field label="Highest true count">
          <input
            className="cas-input cas-input-short"
            name="maxTc"
            inputMode="numeric"
            autoComplete="off"
            value={maxTc}
            onChange={(e) => setMaxTc(e.target.value)}
          />
        </Field>
        <Field label="Tables / dealers">
          <input className="cas-input" name="tables" autoComplete="off" value={tables} onChange={(e) => setTables(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="cas-input cas-textarea" name="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && (
          <p className="cas-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="cas-btn-row">
          <button type="button" className="u-btn" onClick={() => go({ kind: 'home' })}>
            Keep playing
          </button>
          <button type="button" className="u-btn u-btn-primary" onClick={finish}>
            End session
          </button>
        </div>
      </div>
    </div>
  );
}
