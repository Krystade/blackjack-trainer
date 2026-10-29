import { useEffect, useState } from 'react';
import {
  casinoById,
  hasCasinoData,
  quarantinedCasinoLog,
  runningSession,
  setStartingBankroll,
  type CasinoLog,
  type CasinoSession,
} from '../../../store/casinoLog';
import {
  agoText,
  bankrollNow,
  hoursText,
  money,
  parseMoney,
  sessionHours,
  sessionNet,
  shortDate,
  signedMoney,
  totals,
  daysBetween,
  localDateKey,
  exportIsDue,
} from '../../casinoFigures';
import { HeatBadge, MoneyInput } from './fields';
import { moneyText } from './casinoInputs';
import { LiveCard } from './LiveCard';
import { GamesRanked } from './GamesRanked';
import { useHere } from './useGameStats';
import { CasinoDirectory } from './CasinoDirectory';
import { DirectoryFile } from './DirectoryFile';
import { exportLog } from './casinoExport';
import type { CasinoView } from './Casino';

export type CasinoSegment = 'casinos' | 'ranked' | 'sessions';
const SEGMENTS: readonly { value: CasinoSegment; label: string }[] = [
  { value: 'casinos', label: 'Casinos' },
  { value: 'ranked', label: 'Ranked' },
  { value: 'sessions', label: 'Sessions' },
];

interface Props {
  log: CasinoLog;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
  segment: CasinoSegment;
  onSegment: (s: CasinoSegment) => void;
}

/**
 * Wave W: the Casino tab's home in three parts. Casinos (the default) is the
 * directory -- every casino, its games and rules, searchable -- with the
 * log's import and export; Ranked is the games by EV; Sessions is the live
 * session, the money and the history. A running session opens on Sessions,
 * and Casinos carries a strip back to it.
 */
export function CasinoHome({ log, commit, go, segment, onSegment }: Props) {
  const now = Date.now();
  const here = useHere();
  const live = runningSession(log);
  const hasData = hasCasinoData(log);
  const t = totals(log.sessions);
  const bankroll = bankrollNow(log);
  const empty = log.casinos.length === 0 && log.sessions.length === 0;
  const due = exportIsDue(log, now, hasData);

  return (
    <div className="cas-home" data-segment={segment}>
      <div className="cas-pad-x cas-seg-wrap">
        <div className="segmented cas-seg" role="tablist" aria-label="Casino">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              id={`cas-seg-${s.value}`}
              aria-selected={segment === s.value}
              aria-controls="cas-seg-panel"
              className={`segmented-btn${segment === s.value ? ' segmented-btn-active' : ''}`}
              data-testid={`casino-seg-${s.value}`}
              onClick={() => onSegment(s.value)}
            >
              {s.label}
              {s.value === 'sessions' && live && (
                <span className="cas-seg-dot">
                  <span aria-hidden="true">●</span>
                  <span className="u-sr-only"> (running)</span>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      <div id="cas-seg-panel" role="tabpanel" aria-labelledby={`cas-seg-${segment}`}>
        {quarantinedCasinoLog() !== null && (
          <p className="cas-note cas-pad">
            An earlier copy of this log could not be read. It is kept aside and goes into every export, so nothing is lost.
          </p>
        )}

        {segment === 'casinos' && (
          <>
            {!live && due && <ExportNudge log={log} commit={commit} now={now} strip />}
            {live && (
              <div className="cas-pad">
                <button type="button" className="cas-live-strip" data-testid="casino-live-strip" onClick={() => onSegment('sessions')}>
                  <span className="cas-live-strip-dot" aria-hidden="true">
                    ●
                  </span>
                  <span className="cas-live-strip-text">
                    Session running at {casinoById(log, live.casinoId)?.name ?? 'a deleted casino'}
                  </span>
                  <span className="cas-live-strip-go">Open ›</span>
                </button>
              </div>
            )}
            {log.casinos.length === 0 ? (
              <section className="cas-empty cas-pad" aria-label="Getting started">
                <h2 className="cas-empty-title">Your casinos and their rules</h2>
                <p className="cas-empty-text">
                  Keep every casino you play &mdash; each game&rsquo;s full rules, side bets, notes and distance &mdash; and,
                  under Sessions, every real session&rsquo;s buy-ins and cash-out. It stays on this phone and is never sent
                  anywhere.
                </p>
                <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'casino', id: null })}>
                  Add a casino
                </button>
              </section>
            ) : (
              <CasinoDirectory log={log} go={go} now={now} here={here.state.here} />
            )}
            <DirectoryFile log={log} commit={commit} />
          </>
        )}

        {segment === 'ranked' &&
          (log.casinos.length === 0 ? (
            <p className="cas-note cas-pad">Add a casino and its games are ranked here by what they are worth an hour.</p>
          ) : (
            <GamesRanked log={log} go={go} here={here} />
          ))}

        {segment === 'sessions' && (
          <>
            {live ? (
              <>
                <LiveCard key={live.id} log={log} session={live} commit={commit} go={go} />
                {due && <ExportNudge log={log} commit={commit} now={now} />}
              </>
            ) : (
              <>
                {due && <ExportNudge log={log} commit={commit} now={now} />}
                <div className="cas-pad">
                  <button type="button" className="u-btn u-btn-primary cas-wide cas-start" onClick={() => go({ kind: 'start' })}>
                    Start session
                  </button>
                </div>
              </>
            )}
            {!empty && (
              <section className="cas-summary cas-pad" aria-label="Summary" data-testid="casino-summary">
                <div className="cas-summary-hero">
                  <div className="cas-stat">
                    <span className="cas-stat-label">Bankroll</span>
                    <span className="cas-stat-value cas-stat-big" data-testid="casino-bankroll">
                      {bankroll === null ? '—' : money(bankroll)}
                    </span>
                  </div>
                  <div className="cas-stat cas-stat-right">
                    <span className="cas-stat-label">All-time net</span>
                    <span className="cas-stat-value cas-stat-big" data-sign={Math.sign(t.net)} data-testid="casino-net">
                      {signedMoney(t.net)}
                    </span>
                  </div>
                </div>
                <div className="cas-summary-row">
                  <div className="cas-stat">
                    <span className="cas-stat-label">Hours</span>
                    <span className="cas-stat-value" data-testid="casino-hours">
                      {t.hours.toFixed(1)}
                    </span>
                  </div>
                  <div className="cas-stat">
                    <span className="cas-stat-label">Per hour</span>
                    <span className="cas-stat-value" data-testid="casino-per-hour">
                      {t.perHour === null ? '—' : signedMoney(Math.round(t.perHour))}
                    </span>
                  </div>
                  <div className="cas-stat">
                    <span className="cas-stat-label">Sessions</span>
                    <span className="cas-stat-value" data-testid="casino-sessions">
                      {t.sessions}
                    </span>
                  </div>
                </div>
                {bankroll === null && <p className="cas-note">Set a starting bankroll below to see the bankroll now.</p>}
              </section>
            )}
            <SessionHistory log={log} go={go} now={now} live={live} />
            <StartingBankroll log={log} commit={commit} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The backup nudge. `strip`: on Casinos, one line above the directory (review
 * S8: at 320x568 the full card, with the segments, search and sort, left no
 * casino on screen); Sessions keeps the card with its reason.
 */
function ExportNudge({ log, commit, now, strip = false }: { log: CasinoLog; commit: Props['commit']; now: number; strip?: boolean }) {
  const when = log.lastExportAt
    ? `Last export ${agoText(daysBetween(localDateKey(Date.parse(log.lastExportAt)), localDateKey(now)))}.`
    : 'Never exported.';
  if (strip) {
    return (
      <section className="cas-pad cas-nudge-strip-wrap" aria-label="Back up" data-testid="casino-export-nudge">
        <div className="cas-nudge-strip">
          <p className="cas-nudge-strip-text">
            <strong>Back up</strong> &middot; {when.replace(/\.$/, '')}
          </p>
          <button type="button" className="u-btn cas-nudge-strip-btn" onClick={() => void exportLog(log, commit)}>
            Export now
          </button>
        </div>
      </section>
    );
  }
  return (
    <section className="cas-nudge cas-pad-x" aria-label="Back up" data-testid="casino-export-nudge">
      <p className="cas-nudge-text">
        <strong>Back up your casino log.</strong> {when} iOS can clear a web app&rsquo;s storage, and this record exists
        nowhere else.
      </p>
      <button type="button" className="u-btn cas-wide" onClick={() => void exportLog(log, commit)}>
        Export now
      </button>
    </section>
  );
}

function SessionHistory({ log, go, now, live }: { log: CasinoLog; go: Props['go']; now: number; live: CasinoSession | null }) {
  const rows = log.sessions
    .filter((s) => s.id !== live?.id)
    .sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
  return (
    <section className="cas-section" aria-labelledby="cas-history-title">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-history-title">
          Sessions
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="cas-note cas-pad-x">No finished sessions yet.</p>
      ) : (
        <ul className="cas-list">
          {rows.map((s) => {
            const net = sessionNet(s);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className="cas-hist"
                  data-testid="history-row"
                  onClick={() => go({ kind: 'session', sessionId: s.id, from: { kind: 'home' } })}
                >
                  <span className="cas-hist-main">
                    <span className="cas-hist-date">{shortDate(s.start, now)}</span>
                    <span className="cas-hist-casino">{casinoById(log, s.casinoId)?.name ?? 'Deleted casino'}</span>
                  </span>
                  <span className="cas-hist-side">
                    <span className="cas-hist-net" data-sign={net === null ? 0 : Math.sign(net)}>
                      {net !== null ? signedMoney(net) : s.end === null ? 'running' : 'no cash-out'}
                    </span>
                    {/* A second running session (from an import) has no end to count to. */}
                    <span className="cas-hist-hours">{s.end === null ? '—' : hoursText(sessionHours(s, now))}</span>
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
      )}
    </section>
  );
}

function StartingBankroll({ log, commit }: { log: CasinoLog; commit: Props['commit'] }) {
  const [start, setStart] = useState(() => moneyText(log.settings.startingBankroll));
  // Another tab (or an import) changed it: show the stored value, not the old text.
  const storedStart = log.settings.startingBankroll;
  const storedAt = log.settings.updatedAt;
  useEffect(() => {
    setStart(moneyText(storedStart));
  }, [storedStart, storedAt]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseMoney(start);
  const changed = (Number.isNaN(parsed) ? 'x' : parsed) !== log.settings.startingBankroll;

  const saveStart = () => {
    if (Number.isNaN(parsed)) {
      setError('Enter an amount in dollars, or leave it empty.');
      return;
    }
    setError(null);
    commit(setStartingBankroll(log, parsed, Date.now()));
    setMessage(parsed === null ? 'Starting bankroll cleared.' : `Starting bankroll set to ${money(parsed)}.`);
  };

  return (
    <section className="cas-section cas-backup" aria-labelledby="cas-bankroll-title">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-bankroll-title">
          Bankroll
        </h2>
      </div>
      <div className="cas-pad-x cas-stack">
        <label className="cas-field">
          <span className="cas-field-label">Starting bankroll</span>
          <span className="cas-inline">
            <MoneyInput name="startingBankroll" value={start} onChange={setStart} placeholder="Not set" />
            <button type="button" className="u-btn" onClick={saveStart} disabled={!changed}>
              Save
            </button>
          </span>
          {error && (
            <span className="cas-field-error" role="alert">
              {error}
            </span>
          )}
        </label>
        {message && (
          <p className="cas-message" role="status">
            {message}
          </p>
        )}
        <p className="cas-note">The whole log, sessions included, is exported and imported under Casinos.</p>
      </div>
    </section>
  );
}
