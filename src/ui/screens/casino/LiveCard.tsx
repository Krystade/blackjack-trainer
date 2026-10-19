import { useEffect, useState } from 'react';
import { addBuyIn, casinoById, setSessionHeat, type CasinoLog, type CasinoSession } from '../../../store/casinoLog';
import { buyInTotal, elapsedText, HEAT_LABEL, money, parseMoney } from '../../casinoFigures';
import { HeatPicker, MoneyInput } from './fields';
import type { CasinoView } from './Casino';

/**
 * The session on the clock: where, how long, how much is in, and the three
 * things you do mid-session. The clock is computed from the stored start, so
 * a reload, a locked phone or a killed app all come back to the right time.
 */

/** Re-render once a second, and at once when the page comes back into view. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = window.setInterval(tick, 1000);
    const onShow = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);
  return now;
}

export function LiveCard({
  log,
  session,
  commit,
  go,
}: {
  log: CasinoLog;
  session: CasinoSession;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
}) {
  const now = useNow();
  // Starting a session asks for the buy-in straight away; it can be left blank.
  const [panel, setPanel] = useState<'none' | 'buyin' | 'heat'>(() => (session.buyIns.length === 0 ? 'buyin' : 'none'));
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const name = casinoById(log, session.casinoId)?.name ?? 'Deleted casino';
  const total = buyInTotal(session);

  const add = () => {
    const n = parseMoney(amount);
    if (n === null || Number.isNaN(n) || n <= 0) {
      setError('Enter the buy-in in dollars.');
      return;
    }
    commit(addBuyIn(log, session.id, n, Date.now()));
    setAmount('');
    setError(null);
    setPanel('none');
  };

  return (
    <section className="cas-live" aria-label="Session in progress" data-testid="casino-live">
      <div className="cas-live-head">
        <span className="cas-live-tag">
          <span className="cas-live-dot" aria-hidden="true" />
          Live
        </span>
        <span className="cas-live-clock" data-testid="casino-elapsed" aria-label="Elapsed time">
          {elapsedText(now - Date.parse(session.start))}
        </span>
      </div>
      <h2 className="cas-live-name">{name}</h2>
      <p className="cas-live-figs">
        <span data-testid="casino-buyin-total">{total > 0 ? `${money(total)} in` : 'No buy-in yet'}</span>
        {session.buyIns.length > 1 && <span> ({session.buyIns.length} buy-ins)</span>}
        <span className="cas-live-heat"> · {HEAT_LABEL[session.heat]}</span>
      </p>

      {panel === 'buyin' && (
        <div className="cas-live-panel">
          <label className="cas-field">
            <span className="cas-field-label">{session.buyIns.length === 0 ? 'Buy-in' : 'Rebuy'}</span>
            <span className="cas-inline">
              <MoneyInput name="buyIn" value={amount} onChange={setAmount} placeholder="0" />
              <button type="button" className="u-btn u-btn-primary" onClick={add}>
                Add
              </button>
            </span>
            {error && (
              <span className="cas-field-error" role="alert">
                {error}
              </span>
            )}
          </label>
          <button
            type="button"
            className="cas-link"
            onClick={() => {
              setPanel('none');
              setError(null);
            }}
          >
            {session.buyIns.length === 0 ? 'Later' : 'Cancel'}
          </button>
        </div>
      )}

      {panel === 'heat' && (
        <div className="cas-live-panel">
          <HeatPicker
            value={session.heat}
            onChange={(h) => {
              commit(setSessionHeat(log, session.id, h, Date.now()));
              setPanel('none');
            }}
          />
        </div>
      )}

      <div className="cas-live-actions">
        <button type="button" className="u-btn" aria-expanded={panel === 'buyin'} onClick={() => setPanel(panel === 'buyin' ? 'none' : 'buyin')}>
          Add buy-in
        </button>
        <button type="button" className="u-btn" aria-expanded={panel === 'heat'} onClick={() => setPanel(panel === 'heat' ? 'none' : 'heat')}>
          Heat
        </button>
        <button type="button" className="u-btn u-btn-primary" onClick={() => go({ kind: 'end', sessionId: session.id })}>
          End session
        </button>
      </div>
    </section>
  );
}
