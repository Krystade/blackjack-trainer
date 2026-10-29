import { useEffect, useState } from 'react';
import { casinoById, deleteSession, updateSession, versionAt, versionsOf, type CasinoGame, type CasinoLog, type CasinoSession, type HeatLevel } from '../../../store/casinoLog';
import { hoursText, labelledSummary, parseMoney, sessionHours, signedMoney } from '../../casinoFigures';
import { dateText } from '../../casinoVersions';
import { DeleteButton, Field, FieldGroup, HeatPicker, MoneyInput } from './fields';
import { fromLocalInput, moneyText, toLocalInput } from './casinoInputs';

/**
 * Fix a finished session after the fact: the times, every buy-in, the
 * cash-out, the heat and the notes -- or delete it. A running session is
 * changed from its live card instead.
 *
 * Wave W (review S2): and which game it was played at. A session from before
 * versions at a casino of several games never said; saying so here attaches
 * it to that game's rules as they were when it started (`versionAt`).
 */

interface Text {
  casinoId: string;
  /** '' = several, or not said. */
  gameId: string;
  start: string;
  end: string;
  buyIns: string[];
  cashOut: string;
  avgBet: string;
  maxBet: string;
  maxTc: string;
  tables: string;
  notes: string;
}

export function SessionForm({
  log,
  sessionId,
  commit,
  done,
  onDirty,
}: {
  log: CasinoLog;
  sessionId: string;
  commit: (next: CasinoLog) => boolean;
  done: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const session = log.sessions.find((s) => s.id === sessionId);
  const [text, setText] = useState<Text>(() => ({
    casinoId: session?.casinoId ?? '',
    gameId: session?.gameId ?? '',
    start: session ? toLocalInput(session.start) : '',
    end: session?.end ? toLocalInput(session.end) : '',
    buyIns: session && session.buyIns.length > 0 ? session.buyIns.map(String) : [''],
    cashOut: moneyText(session?.cashOut),
    avgBet: moneyText(session?.avgBet),
    maxBet: moneyText(session?.maxBet),
    maxTc: session?.maxTc === null || session?.maxTc === undefined ? '' : String(session.maxTc),
    tables: session?.tables ?? '',
    notes: session?.notes ?? '',
  }));
  const [heat, setHeat] = useState<HeatLevel>(session?.heat ?? 'none');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onDirty(touched), [touched, onDirty]);

  if (!session) {
    return (
      <div className="cas-form cas-pad">
        <p className="cas-note">That session is no longer in the log.</p>
        <button type="button" className="u-btn cas-wide" onClick={done}>
          Back
        </button>
      </div>
    );
  }

  const set = (patch: Partial<Text>) => {
    setText((t) => {
      const next = { ...t, ...patch };
      // Another casino: its one game, or not said.
      if (patch.casinoId !== undefined && patch.casinoId !== t.casinoId) {
        const there = casinoById(log, patch.casinoId)?.games ?? [];
        next.gameId = there.length === 1 ? there[0]!.id : '';
      }
      return next;
    });
    setTouched(true);
  };
  const setBuyIn = (i: number, v: string) => set({ buyIns: text.buyIns.map((b, j) => (j === i ? v : b)) });

  // The fields are minute precision: an untouched time keeps the stored one
  // exactly, so an unrelated edit does not shave seconds off the hours.
  const start = session.start && text.start === toLocalInput(session.start) ? session.start : fromLocalInput(text.start);
  const end = session.end && text.end === toLocalInput(session.end) ? session.end : fromLocalInput(text.end);
  const games = casinoById(log, text.casinoId)?.games ?? [];
  const shownGame = games.find((g) => g.id === text.gameId);
  const shownVersion = shownGame && start ? (shownGame.id === session.gameId && text.casinoId === session.casinoId && session.versionId ? session.versionId : versionAt(shownGame, start).versionId) : null;
  const versionHint =
    shownGame && shownVersion && versionsOf(shownGame).length > 1
      ? `At its rules from ${dateText(versionsOf(shownGame).find((v) => v.versionId === shownVersion)?.createdAt ?? start!)}.`
      : undefined;
  const buyIns = text.buyIns.map(parseMoney);
  const cashOut = parseMoney(text.cashOut);
  const previewNet =
    cashOut !== null && !Number.isNaN(cashOut) && buyIns.every((b) => !Number.isNaN(b))
      ? cashOut - buyIns.reduce<number>((a, b) => a + (b ?? 0), 0)
      : null;

  const save = () => {
    if (!start || !end) {
      setError('Both the start and the end need a date and time.');
      return;
    }
    if (Date.parse(end) < Date.parse(start)) {
      setError('The end is before the start.');
      return;
    }
    if (cashOut === null) {
      // A finished session without one drops out of every total, silently.
      setError('Enter what you cashed out, in dollars (0 if nothing).');
      return;
    }
    const avgBet = parseMoney(text.avgBet);
    const maxBet = parseMoney(text.maxBet);
    const tcText = text.maxTc.trim().replace(/^−/, '-');
    const maxTc = tcText === '' ? null : Number(tcText);
    if ([...buyIns, cashOut, avgBet, maxBet].some((n) => Number.isNaN(n)) || (maxTc !== null && !Number.isInteger(maxTc))) {
      setError('Amounts are in dollars and the true count a whole number. Fix or clear them.');
      return;
    }
    const { gameId: _game, versionId: _version, ...rest } = session;
    commit(
      updateSession(
        log,
        {
          ...rest,
          ...playedAt(session, text.casinoId, shownGame, text.gameId, start),
          casinoId: text.casinoId,
          start,
          end,
          buyIns: buyIns.filter((b): b is number => b !== null && b > 0),
          cashOut,
          avgBet,
          maxBet,
          maxTc,
          tables: text.tables,
          heat,
          notes: text.notes.trim(),
        },
        Date.now(),
      ),
    );
    done();
  };

  return (
    <div className="cas-form" data-testid="session-form">
      <div className="cas-pad-x cas-stack cas-form-top">
        <Field label="Casino">
          <select className="cas-input cas-select" name="casinoId" value={text.casinoId} onChange={(e) => set({ casinoId: e.target.value })}>
            {log.casinos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            {!log.casinos.some((c) => c.id === text.casinoId) && <option value={text.casinoId}>Deleted casino</option>}
          </select>
        </Field>
        {games.length > 0 && (games.length > 1 || text.gameId === '') && (
          <Field label="Game" hint={versionHint}>
            <select className="cas-input cas-select" name="gameId" value={text.gameId} onChange={(e) => set({ gameId: e.target.value })}>
              <option value="">Several, or not said</option>
              {games.map((g, i) => (
                <option key={g.id} value={g.id}>
                  {g.label?.trim() ? labelledSummary(g) : `Game ${i + 1}: ${labelledSummary(g)}`}
                </option>
              ))}
              {text.gameId !== '' && !games.some((g) => g.id === text.gameId) && <option value={text.gameId}>A game since removed</option>}
            </select>
          </Field>
        )}
        {/* One per row: a date and a time do not fit half of a 375 screen. */}
        <Field label="Started">
          <input type="datetime-local" className="cas-input" name="start" value={text.start} onChange={(e) => set({ start: e.target.value })} />
        </Field>
        <Field label="Ended">
          <input type="datetime-local" className="cas-input" name="end" value={text.end} onChange={(e) => set({ end: e.target.value })} />
        </Field>

        <FieldGroup label="Buy-ins">
          <div className="cas-buyins">
            {text.buyIns.map((b, i) => (
              <span className="cas-inline" key={i}>
                <MoneyInput name={`buyIn${i}`} value={b} onChange={(v) => setBuyIn(i, v)} />
                {text.buyIns.length > 1 && (
                  <button
                    type="button"
                    className="u-btn cas-remove"
                    aria-label={`Remove buy-in ${i + 1}`}
                    onClick={() => set({ buyIns: text.buyIns.filter((_, j) => j !== i) })}
                  >
                    &times;
                  </button>
                )}
              </span>
            ))}
            <button type="button" className="cas-link" onClick={() => set({ buyIns: [...text.buyIns, ''] })}>
              + Add a buy-in
            </button>
          </div>
        </FieldGroup>
        <Field label="Cash-out">
          <MoneyInput name="cashOut" value={text.cashOut} onChange={(v) => set({ cashOut: v })} />
        </Field>
        <p className="cas-preview" data-testid="session-preview">
          Net{' '}
          <strong data-sign={previewNet === null ? 0 : Math.sign(previewNet)}>
            {previewNet === null ? '—' : signedMoney(previewNet)}
          </strong>
          {start && end && Date.parse(end) >= Date.parse(start) ? ` over ${hoursText(sessionHours({ start, end }, Date.now()))}` : ''}
        </p>

        <FieldGroup label="Heat">
          <HeatPicker
            value={heat}
            onChange={(h) => {
              setHeat(h);
              setTouched(true);
            }}
          />
        </FieldGroup>
        <div className="cas-pair">
          <Field label="Average bet">
            <MoneyInput name="avgBet" value={text.avgBet} onChange={(v) => set({ avgBet: v })} />
          </Field>
          <Field label="Max bet">
            <MoneyInput name="maxBet" value={text.maxBet} onChange={(v) => set({ maxBet: v })} />
          </Field>
        </div>
        <Field label="Highest true count">
          <input
            className="cas-input cas-input-short"
            name="maxTc"
            inputMode="numeric"
            autoComplete="off"
            value={text.maxTc}
            onChange={(e) => set({ maxTc: e.target.value })}
          />
        </Field>
        <Field label="Tables / dealers">
          <input className="cas-input" name="tables" autoComplete="off" value={text.tables} onChange={(e) => set({ tables: e.target.value })} />
        </Field>
        <Field label="Notes">
          <textarea className="cas-input cas-textarea" name="notes" rows={3} value={text.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        {error && (
          <p className="cas-field-error" role="alert">
            {error}
          </p>
        )}
        <div className="cas-btn-row">
          <button type="button" className="u-btn" onClick={done}>
            Cancel
          </button>
          <button type="button" className="u-btn u-btn-primary" onClick={save}>
            Save session
          </button>
        </div>
      </div>
      <div className="cas-pad">
        <DeleteButton
          label="Delete session"
          question={`Delete this session${previewNet === null ? '' : ` (${signedMoney(previewNet)})`}? Your totals and bankroll will change.`}
          onDelete={() => {
            commit(deleteSession(log, session.id));
            done();
          }}
        />
      </div>
    </div>
  );
}

/**
 * The game and version a saved session records. Unchanged, it keeps the
 * version it has; a game newly said is at its rules when the session began.
 */
function playedAt(session: CasinoSession, casinoId: string, game: CasinoGame | undefined, gameId: string, start: string): Pick<CasinoSession, 'gameId' | 'versionId'> {
  if (gameId === '') return {};
  if (gameId === session.gameId && casinoId === session.casinoId && session.versionId) return { gameId, versionId: session.versionId };
  return game ? { gameId, versionId: versionAt(game, start).versionId } : { gameId };
}
