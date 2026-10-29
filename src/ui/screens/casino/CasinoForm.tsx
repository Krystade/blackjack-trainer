import { useEffect, useLayoutEffect, useState } from 'react';
import {
  blankCasinoDraft,
  blankGame,
  casinoById,
  deleteCasino,
  saveCasino,
  type CasinoDraft,
  type CasinoGame,
  type CasinoLog,
  type CasinoStatus,
  type GeoPoint,
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
import { Choice, DeleteButton, Field, FieldGroup, HeatBadge } from './fields';
import { GameEditor } from './GameEditor';
import { gameText, withRuleChange, withTextChange, type GameText } from './casinoInputs';
import { NotesEditor } from './NotesEditor';
import type { CasinoView } from './Casino';

/**
 * A casino's page: everything known about its games and how it treats you,
 * then the sessions played there. Every rule can stay "?" -- an unknown is
 * not a rule, and the summary line leaves it out rather than guessing.
 *
 * Wave K: several games per casino (each its own block), the drive from home
 * and the spot itself (saved only on a tap of "Save this spot"), and the
 * casino's notes as their own always-open section that saves as you type.
 */

export function CasinoForm({
  log,
  id,
  focusGame,
  self,
  commit,
  go,
  onDirty,
}: {
  log: CasinoLog;
  id: string | null;
  /** Review S2: opened from a game's "Edit rules": that game's block, scrolled to. */
  focusGame?: string;
  /**
   * Review S7: this form's own view, with where it returns. A session or a
   * game's card opened from here comes back to it, and the form then still
   * returns where it was opened from.
   */
  self: CasinoView;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const existing = id ? casinoById(log, id) : undefined;
  const [draft, setDraft] = useState<CasinoDraft>(() => (existing ? { ...existing } : blankCasinoDraft()));
  const [texts, setTexts] = useState<Record<string, GameText>>(() =>
    Object.fromEntries((existing?.games ?? draft.games).map((g) => [g.id, gameText(g)])),
  );
  const [drive, setDrive] = useState(() => (existing?.driveMinutes === null || existing?.driveMinutes === undefined ? '' : String(existing.driveMinutes)));
  const [milesText, setMilesText] = useState(() => (existing?.miles === null || existing?.miles === undefined ? '' : String(existing.miles)));
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);

  useEffect(() => onDirty(touched), [touched, onDirty]);
  // Review S2: "Edit rules" on a game opens the form at that game's block.
  useLayoutEffect(() => {
    if (!focusGame) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="game-editor"][data-game="${CSS.escape(focusGame)}"]`);
    el?.scrollIntoView({ block: 'start' });
    el?.querySelector<HTMLElement>('.cas-ge-title')?.focus({ preventScroll: true });
  }, [focusGame]);

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
  const updateGame = (gid: string, patch: Partial<CasinoGame>) => {
    // Review S2: setting a rule clears that rule's "?", and only that one.
    setDraft((d) => ({ ...d, games: d.games.map((g) => (g.id === gid ? withRuleChange(g, patch) : g)) }));
    setTouched(true);
  };
  const updateText = (gid: string, patch: Partial<GameText>) => {
    const before = texts[gid];
    if (before) setDraft((d) => ({ ...d, games: d.games.map((g) => (g.id === gid ? withTextChange(g, before, patch) : g)) }));
    setTexts((t) => ({ ...t, [gid]: { ...t[gid]!, ...patch } }));
    setTouched(true);
  };
  const addGame = () => {
    const g = blankGame();
    setDraft((d) => ({ ...d, games: [...d.games, g] }));
    setTexts((t) => ({ ...t, [g.id]: gameText(g) }));
    setTouched(true);
  };
  const removeGame = (gid: string) => {
    setDraft((d) => ({ ...d, games: d.games.filter((g) => g.id !== gid) }));
    setTouched(true);
  };

  const saveSpot = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocMsg('This browser cannot tell where you are.');
      return;
    }
    setLocMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc: GeoPoint = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        update({ location: loc });
        setLocMsg('Spot saved with the casino when you tap Save.');
      },
      (err) => setLocMsg(err.code === 1 ? 'Location is blocked for this app in the browser settings.' : 'Could not get a location. Try again outside.'),
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const save = () => {
    if (!draft.name.trim()) {
      setError('Give the casino a name.');
      return;
    }
    const driveMinutes = drive.trim() === '' ? null : Number(drive);
    if (driveMinutes !== null && !(Number.isFinite(driveMinutes) && driveMinutes >= 0 && driveMinutes <= 1440)) {
      setError('Drive time is minutes, one way. Fix or clear it.');
      return;
    }
    const miles = milesText.trim() === '' ? null : Number(milesText);
    if (miles !== null && !(Number.isFinite(miles) && miles >= 0 && miles <= 5000)) {
      setError('Miles is a distance, one way. Fix or clear it.');
      return;
    }
    const games: CasinoGame[] = [];
    for (const g of draft.games) {
      const t = texts[g.id] ?? gameText(g);
      const minBet = parseMoney(t.minBet);
      const maxBet = parseMoney(t.maxBet);
      const cut = parseMoney(t.cut);
      const rph = parseMoney(t.roundsPerHour);
      const fee = parseMoney(t.commission ?? '');
      if ([minBet, maxBet, cut, rph, fee].some((n) => Number.isNaN(n)) || (rph !== null && (rph < 1 || rph > 1000)) || (fee !== null && fee > 25)) {
        setError('Bets are dollar amounts, the cut a number of decks, rounds per hour a count and commission dollars per $100. Fix or clear them.');
        return;
      }
      games.push({
        ...g,
        minBet,
        maxBet,
        cutDecksLeft: cut,
        roundsPerHour: rph,
        commissionPer100: fee,
        label: g.label?.trim() || undefined,
        variantName: g.variantName?.trim() || undefined,
        notes: g.notes?.trim() ? g.notes : undefined,
      });
    }
    // The notes save themselves on this page; take the stored copy, not the one this form opened with.
    const notes = existing ? (casinoById(log, existing.id)?.notes ?? '') : draft.notes;
    const r = saveCasino(log, { ...draft, games, driveMinutes, miles, notes }, Date.now(), id ?? undefined);
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
  const savedIds = new Set(existing?.games.map((g) => g.id) ?? []);

  return (
    <div className="cas-form" data-testid="casino-form">
      <div className="cas-pad-x cas-stack cas-form-top">
        <Field label="Name">
          <input className="cas-input" name="name" autoComplete="off" value={draft.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <div className="cas-pair">
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
          <Field label="Drive, minutes">
            <input
              className="cas-input"
              name="driveMinutes"
              inputMode="numeric"
              autoComplete="off"
              placeholder="One way"
              value={drive}
              onChange={(e) => {
                setDrive(e.target.value);
                setTouched(true);
              }}
            />
          </Field>
        </div>
        {/* Wave M: card rooms (California, player-banked, commission) and miles from home. */}
        <div className="cas-pair">
          <FieldGroup label="Kind">
            <Choice
              label="Kind"
              value={draft.kind ?? 'casino'}
              options={[
                { value: 'casino', label: 'Casino' },
                { value: 'cardroom', label: 'Card room' },
              ]}
              onChange={(v) => update({ kind: v })}
            />
          </FieldGroup>
          <Field label="Miles, one way">
            <input
              className="cas-input"
              name="miles"
              inputMode="decimal"
              autoComplete="off"
              placeholder="From home"
              value={milesText}
              onChange={(e) => {
                setMilesText(e.target.value);
                setTouched(true);
              }}
            />
          </Field>
        </div>
        <div className="cas-field cas-spot" data-testid="casino-spot">
          <span className="cas-field-label">Location</span>
          {draft.location ? (
            <span className="cas-inline cas-spot-row">
              <span className="cas-spot-text" data-testid="spot-saved">
                Spot saved ({draft.location.lat.toFixed(4)}, {draft.location.lon.toFixed(4)})
              </span>
              <button
                type="button"
                className="u-btn"
                onClick={() => {
                  update({ location: null });
                  setLocMsg(null);
                }}
              >
                Clear
              </button>
            </span>
          ) : (
            <button type="button" className="u-btn cas-wide" onClick={saveSpot} data-testid="save-spot">
              Save this spot (I&rsquo;m here)
            </button>
          )}
          <span className="cas-field-hint">{locMsg ?? 'Only when you tap. Stays on this phone, for distances in the ranking.'}</span>
        </div>
      </div>

      {existing && <NotesEditor log={log} casinoId={existing.id} commit={commit} />}

      <section className="cas-section" aria-labelledby="cas-game-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-game-title">
            {draft.games.length === 1 ? 'Game' : `Games (${draft.games.length})`}
          </h2>
          <button type="button" className="cas-head-btn" onClick={addGame} data-testid="add-game">
            + Add game
          </button>
        </div>
        <div className="cas-pad-x cas-stack">
          {draft.games.map((g, i) => (
            <GameEditor
              key={g.id}
              game={g}
              text={texts[g.id] ?? gameText(g)}
              index={i}
              count={draft.games.length}
              onChange={(patch) => updateGame(g.id, patch)}
              onText={(patch) => updateText(g.id, patch)}
              onRemove={() => removeGame(g.id)}
              onStats={existing && !touched && savedIds.has(g.id) ? () => go({ kind: 'game', casinoId: existing.id, gameId: g.id, from: self }) : undefined}
            />
          ))}
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
          {!existing && (
            <Field label="Notes" hint="Pit names, shift changes, good dealers.">
              <textarea className="cas-input cas-textarea" name="notes" rows={4} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} />
            </Field>
          )}
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
                        onClick={() => go({ kind: 'session', sessionId: s.id, from: self })}
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
