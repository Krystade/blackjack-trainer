import { useEffect, useState } from 'react';
import {
  blankCasinoDraft,
  casinoById,
  deleteCasino,
  saveCasino,
  type CasinoDraft,
  type CasinoLog,
  type CasinoStatus,
  type DeckCount,
  type MidShoeEntry,
} from '../../../store/casinoLog';
import {
  hoursText,
  localDateKey,
  longDate,
  parseMoney,
  sessionHours,
  sessionNet,
  sessionsAt,
  shortDate,
  signedMoney,
  standing,
  totals,
} from '../../casinoFigures';
import { Choice, DeleteButton, Field, FieldGroup, HeatBadge, MoneyInput } from './fields';
import { moneyText } from './casinoInputs';
import type { CasinoView } from './Casino';

/**
 * A casino's page: everything known about its game and how it treats you,
 * then the sessions played there. Every rule can stay "?" -- an unknown is
 * not a rule, and the summary line leaves it out rather than guessing.
 */

type Tri = 'unknown' | 'yes' | 'no';
const tri = (b: boolean | null | undefined): Tri => (b === true ? 'yes' : b === false ? 'no' : 'unknown');
const fromTri = (t: Tri): boolean | null => (t === 'yes' ? true : t === 'no' ? false : null);

const YES_NO = [
  { value: 'unknown', label: '?' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
] as const;

interface FormText {
  minBet: string;
  maxBet: string;
  cut: string;
}

export function CasinoForm({
  log,
  id,
  commit,
  go,
  onDirty,
}: {
  log: CasinoLog;
  id: string | null;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const existing = id ? casinoById(log, id) : undefined;
  const [draft, setDraft] = useState<CasinoDraft>(() => (existing ? { ...existing } : blankCasinoDraft()));
  const [text, setText] = useState<FormText>(() => ({
    minBet: moneyText(existing?.minBet),
    maxBet: moneyText(existing?.maxBet),
    cut: moneyText(existing?.game.cutDecksLeft),
  }));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onDirty(touched), [touched, onDirty]);

  if (id && !existing) {
    return (
      <div className="cas-form cas-pad">
        <p className="cas-note">That casino is no longer in the log.</p>
        <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'home' })}>
          Back to Casino
        </button>
      </div>
    );
  }

  const update = (patch: Partial<CasinoDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setTouched(true);
  };
  const updateGame = (patch: Partial<CasinoDraft['game']>) => {
    setDraft((d) => ({ ...d, game: { ...d.game, ...patch } }));
    setTouched(true);
  };
  const updateText = (patch: Partial<FormText>) => {
    setText((t) => ({ ...t, ...patch }));
    setTouched(true);
  };

  const save = () => {
    if (!draft.name.trim()) {
      setError('Give the casino a name.');
      return;
    }
    const minBet = parseMoney(text.minBet);
    const maxBet = parseMoney(text.maxBet);
    const cut = parseMoney(text.cut);
    if ([minBet, maxBet, cut].some((n) => Number.isNaN(n))) {
      setError('Bets are dollar amounts and the cut a number of decks. Fix or clear them.');
      return;
    }
    const r = saveCasino(log, { ...draft, minBet, maxBet, game: { ...draft.game, cutDecksLeft: cut } }, Date.now(), id ?? undefined);
    if (!r) {
      setError('Give the casino a name.');
      return;
    }
    commit(r.log);
    go({ kind: 'home' });
  };

  const now = Date.now();
  const sessions = existing ? sessionsAt(log, existing.id).sort((a, b) => Date.parse(b.start) - Date.parse(a.start)) : [];
  const t = totals(sessions);
  const coolOff = existing ? standing(existing, now).coolOffOver : false;

  return (
    <div className="cas-form" data-testid="casino-form">
      <div className="cas-pad-x cas-stack cas-form-top">
        <Field label="Name">
          <input className="cas-input" name="name" autoComplete="off" value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Area">
          <input
            className="cas-input"
            name="area"
            autoComplete="off"
            placeholder="City or region"
            value={draft.area ?? ''}
            onChange={(e) => update({ area: e.target.value })}
          />
        </Field>
      </div>

      <section className="cas-section" aria-labelledby="cas-game-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-game-title">
            Game
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <FieldGroup label="Decks">
            <Choice
              label="Decks"
              value={draft.game.decks ? String(draft.game.decks) : 'unknown'}
              options={[
                { value: 'unknown', label: '?' },
                { value: '1', label: '1' },
                { value: '2', label: '2' },
                { value: '6', label: '6' },
                { value: '8', label: '8' },
              ]}
              onChange={(v) => updateGame({ decks: v === 'unknown' ? null : (Number(v) as DeckCount) })}
            />
          </FieldGroup>
          <FieldGroup label="Dealer soft 17">
            <Choice
              label="Dealer soft 17"
              value={draft.game.s17 === true ? 's17' : draft.game.s17 === false ? 'h17' : 'unknown'}
              options={[
                { value: 'unknown', label: '?' },
                { value: 's17', label: 'Stands (S17)' },
                { value: 'h17', label: 'Hits (H17)' },
              ]}
              onChange={(v) => updateGame({ s17: v === 's17' ? true : v === 'h17' ? false : null })}
            />
          </FieldGroup>
          <div className="cas-pair">
            <FieldGroup label="Double after split">
              <Choice label="Double after split" value={tri(draft.game.das)} options={YES_NO} onChange={(v) => updateGame({ das: fromTri(v) })} />
            </FieldGroup>
            <FieldGroup label="Late surrender">
              <Choice
                label="Late surrender"
                value={tri(draft.game.surrender)}
                options={YES_NO}
                onChange={(v) => updateGame({ surrender: fromTri(v) })}
              />
            </FieldGroup>
          </div>
          <div className="cas-pair">
            <FieldGroup label="Blackjack pays">
              <Choice
                label="Blackjack pays"
                value={draft.game.payout ?? 'unknown'}
                options={[
                  { value: 'unknown', label: '?' },
                  { value: '3:2', label: '3:2' },
                  { value: '6:5', label: '6:5' },
                ]}
                onChange={(v) => updateGame({ payout: v === 'unknown' ? null : v })}
              />
            </FieldGroup>
            <Field label="Cut at, decks left">
              <input
                className="cas-input"
                name="cutDecksLeft"
                inputMode="decimal"
                autoComplete="off"
                placeholder="e.g. 1.5"
                value={text.cut}
                onChange={(e) => updateText({ cut: e.target.value })}
              />
            </Field>
          </div>
          <div className="cas-pair">
            <Field label="Min bet">
              <MoneyInput name="minBet" value={text.minBet} onChange={(v) => updateText({ minBet: v })} />
            </Field>
            <Field label="Max bet">
              <MoneyInput name="maxBet" value={text.maxBet} onChange={(v) => updateText({ maxBet: v })} />
            </Field>
          </div>
          <FieldGroup label="Mid-shoe entry" hint="Back-counting needs it.">
            <Choice
              label="Mid-shoe entry"
              value={draft.midShoeEntry}
              options={[
                { value: 'unknown', label: '?' },
                { value: 'allowed', label: 'Allowed' },
                { value: 'no', label: 'Not allowed' },
              ]}
              onChange={(v: MidShoeEntry) => update({ midShoeEntry: v })}
            />
          </FieldGroup>
          <label className="cas-check">
            <input type="checkbox" name="csm" checked={draft.csm} onChange={(e) => update({ csm: e.target.checked })} />
            <span>Continuous shuffler (CSM): counting is impossible</span>
          </label>
        </div>
      </section>

      <section className="cas-section" aria-labelledby="cas-status-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-status-title">
            Status
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <Choice
            label="Status"
            value={draft.status}
            options={[
              { value: 'ok', label: 'OK' },
              { value: 'avoid', label: 'Avoid' },
              { value: 'burned', label: 'Burned' },
            ]}
            onChange={(v: CasinoStatus) => update({ status: v })}
          />
          {draft.status === 'burned' && (
            <Field
              label="Burned until"
              hint={
                coolOff && draft.burnedUntil
                  ? `The cool-off ended ${longDate(draft.burnedUntil)}. Set OK, or a new date.`
                  : 'Leave empty for indefinitely.'
              }
            >
              <input
                type="date"
                className="cas-input"
                name="burnedUntil"
                min={existing ? undefined : localDateKey(now)}
                value={draft.burnedUntil ?? ''}
                onChange={(e) => update({ burnedUntil: e.target.value || null })}
              />
            </Field>
          )}
          <Field label="Notes" hint="Pit names, shift changes, good dealers.">
            <textarea className="cas-input cas-textarea" name="notes" rows={4} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
          </Field>
          {error && (
            <p className="cas-field-error" role="alert">
              {error}
            </p>
          )}
          <div className="cas-btn-row">
            <button type="button" className="u-btn" onClick={() => go({ kind: 'home' })}>
              Cancel
            </button>
            <button type="button" className="u-btn u-btn-primary" onClick={save}>
              Save casino
            </button>
          </div>
        </div>
      </section>

      {existing && (
        <section className="cas-section" aria-labelledby="cas-there-title">
          <div className="cas-section-head">
            <h2 className="u-section-title" id="cas-there-title">
              Sessions here
            </h2>
          </div>
          {sessions.length === 0 ? (
            <p className="cas-note cas-pad-x">Never played here yet.</p>
          ) : (
            <>
              <p className="cas-there-totals cas-pad-x" data-testid="casino-totals">
                <span data-sign={Math.sign(t.net)}>{signedMoney(t.net)}</span> over {hoursText(t.hours)} in {t.sessions} session
                {t.sessions === 1 ? '' : 's'}
                {t.perHour !== null ? ` · ${signedMoney(Math.round(t.perHour))}/h` : ''}
              </p>
              <ul className="cas-list">
                {sessions.map((s) => {
                  const net = sessionNet(s);
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="cas-hist"
                        disabled={s.end === null}
                        onClick={() => go({ kind: 'session', sessionId: s.id, from: { kind: 'casino', id: existing.id } })}
                      >
                        <span className="cas-hist-main">
                          <span className="cas-hist-date">{shortDate(s.start, now)}</span>
                          <span className="cas-hist-casino">{s.end === null ? 'In progress' : hoursText(sessionHours(s, now))}</span>
                        </span>
                        <span className="cas-hist-side">
                          <span className="cas-hist-net" data-sign={net === null ? 0 : Math.sign(net)}>
                            {net === null ? 'open' : signedMoney(net)}
                          </span>
                        </span>
                        {s.heat !== 'none' && (
                          <span className="cas-hist-badges">
                            <HeatBadge heat={s.heat} />
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="cas-pad">
            <DeleteButton
              label="Delete casino"
              question={
                sessions.length === 0
                  ? `Delete ${existing.name}?`
                  : `Delete ${existing.name} and its ${sessions.length} session${sessions.length === 1 ? '' : 's'} (${signedMoney(t.net)})? Your totals and bankroll will change.`
              }
              onDelete={() => {
                commit(deleteCasino(log, existing.id));
                go({ kind: 'home' });
              }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
