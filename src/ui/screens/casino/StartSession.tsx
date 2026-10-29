import { useEffect, useState } from 'react';
import { blankCasinoDraft, saveCasino, startSession, type CasinoLog } from '../../../store/casinoLog';
import { burnedText, labelledSummary, sortCasinos, standing } from '../../casinoFigures';
import type { CasinoView } from './Casino';
import './casinoVersions.css';

/**
 * Pick where you are playing and the clock starts. One tap on a known casino;
 * a new one needs only a name (the rest can be filled in later from its page).
 * The buy-in is asked for on the live card, and can wait.
 *
 * Wave W (review S2): a session records the game it is played at, and that
 * game's version, so its result stays with the rules it was played under. A
 * casino of one game needs nothing more; at one of several, the tap asks
 * which -- or "several", which leaves it the casino's.
 */
export function StartSession({
  log,
  commit,
  go,
  onDirty,
}: {
  log: CasinoLog;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const now = Date.now();
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<string | null>(null);
  const casinos = sortCasinos(log, now);

  useEffect(() => onDirty(name.trim() !== '' || area.trim() !== ''), [name, area, onDirty]);

  const startAt = (base: CasinoLog, casinoId: string, gameId?: string | null) => {
    const r = startSession(base, casinoId, Date.now(), null, gameId);
    if (!r) {
      setError('A session is already running. End it first.');
      return;
    }
    commit(r.log);
    go({ kind: 'home' });
  };

  const startNew = () => {
    const added = saveCasino(log, { ...blankCasinoDraft(name), area: area.trim() || undefined }, Date.now());
    if (!added) {
      setError('Give the casino a name.');
      return;
    }
    startAt(added.log, added.casino.id);
  };

  return (
    <div className="cas-form">
      {casinos.length > 0 && (
        <section className="cas-section" aria-labelledby="cas-pick-title">
          <div className="cas-section-head">
            <h2 className="u-section-title" id="cas-pick-title">
              Where are you playing?
            </h2>
          </div>
          <ul className="cas-list">
            {casinos.map((c) => {
              const s = standing(c, now);
              const several = c.games.length > 1;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    className="cas-row cas-pick"
                    data-testid="start-at"
                    aria-expanded={several ? picking === c.id : undefined}
                    onClick={() => (several ? setPicking((p) => (p === c.id ? null : c.id)) : startAt(log, c.id))}
                  >
                    <span className="cas-row-top">
                      <span className="cas-row-name">{c.name}</span>
                      <span className="cas-pick-go" aria-hidden="true">
                        {several ? (picking === c.id ? 'Which game? ▾' : 'Start ›') : 'Start ›'}
                      </span>
                    </span>
                    {(c.area || s.group !== 'playable') && (
                      <span className="cas-row-meta">
                        {[
                          c.area,
                          s.group === 'burned' ? `Burned ${burnedText(c)}` : s.group === 'avoid' ? 'Marked avoid' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </button>
                  {several && picking === c.id && (
                    <div className="cas-pick-games" role="group" aria-label={`Which game at ${c.name}`} data-testid="start-games">
                      {c.games.map((g, i) => (
                        <button key={g.id} type="button" className="u-btn cas-wide cas-pick-game" data-testid="start-game" data-game={g.id} onClick={() => startAt(log, c.id, g.id)}>
                          {g.label?.trim() ? labelledSummary(g) : `Game ${i + 1}: ${labelledSummary(g)}`}
                        </button>
                      ))}
                      <button type="button" className="u-btn cas-wide cas-pick-game" data-testid="start-several" onClick={() => startAt(log, c.id, null)}>
                        Several, or not sure
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="cas-section" aria-labelledby="cas-new-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-new-title">
            {casinos.length > 0 ? 'Somewhere new' : 'Where are you playing?'}
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          <label className="cas-field">
            <span className="cas-field-label">Casino name</span>
            <input
              className="cas-input"
              name="newCasinoName"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="cas-field">
            <span className="cas-field-label">Area (optional)</span>
            <input
              className="cas-input"
              name="newCasinoArea"
              autoComplete="off"
              placeholder="City or region"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            />
          </label>
          {error && (
            <p className="cas-field-error" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="u-btn u-btn-primary cas-wide" onClick={startNew} disabled={name.trim() === ''}>
            Add and start
          </button>
        </div>
      </section>
    </div>
  );
}
