import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  casinoById,
  exportFileName,
  hasCasinoData,
  keepUnreadable,
  loadCasinoLog,
  markExported,
  mergeImport,
  quarantinedCasinoLog,
  runningSession,
  serializeExport,
  setStartingBankroll,
  type Casino,
  type CasinoLog,
  type CasinoSession,
  type GeoPoint,
} from '../../../store/casinoLog';
import {
  agoText,
  bankrollNow,
  burnedText,
  hoursText,
  lastVisitText,
  money,
  parseMoney,
  sessionHours,
  sessionNet,
  sessionsAt,
  shortDate,
  signedMoney,
  sortCasinos,
  standing,
  totals,
  casinoWarnBadges,
  distanceOf,
  kindBadge,
  labelledSummary,
  notesFirstLine,
  worstHeat,
  daysBetween,
  localDateKey,
  exportIsDue,
  type Standing,
} from '../../casinoFigures';
import { HeatBadge, MoneyInput } from './fields';
import { moneyText } from './casinoInputs';
import { LiveCard } from './LiveCard';
import { GamesRanked } from './GamesRanked';
import { buildRanking, bestGameOf } from '../../casinoRanking';
import { useActiveProfile, useGameCache, useHere } from './useGameStats';
import type { CasinoView } from './Casino';

interface Props {
  log: CasinoLog;
  commit: (next: CasinoLog) => boolean;
  go: (view: CasinoView) => void;
}

const GROUP_TITLE: Record<Standing, string> = { playable: 'Playable', avoid: 'Avoid', burned: 'Burned' };

export function CasinoHome({ log, commit, go }: Props) {
  const now = Date.now();
  const here = useHere();
  const live = runningSession(log);
  const hasData = hasCasinoData(log);
  const t = totals(log.sessions);
  const bankroll = bankrollNow(log);
  const empty = log.casinos.length === 0 && log.sessions.length === 0;

  return (
    <div className="cas-home">
      {/* Mid-session the live card is what is used at the table, so the
          backup nudge waits below it; otherwise it leads. */}
      {!live && exportIsDue(log, now, hasData) && <ExportNudge log={log} commit={commit} now={now} />}
      {quarantinedCasinoLog() !== null && (
        <p className="cas-note cas-pad">
          An earlier copy of this log could not be read. It is kept aside and goes into every export, so nothing is lost.
        </p>
      )}

      {live ? (
        <>
          <LiveCard key={live.id} log={log} session={live} commit={commit} go={go} />
          {exportIsDue(log, now, hasData) && <ExportNudge log={log} commit={commit} now={now} />}
        </>
      ) : (
        <div className="cas-pad">
          <button type="button" className="u-btn u-btn-primary cas-wide cas-start" onClick={() => go({ kind: 'start' })}>
            Start session
          </button>
        </div>
      )}

      {empty ? (
        <section className="cas-empty cas-pad" aria-label="Getting started">
          <h2 className="cas-empty-title">Your real-play notebook</h2>
          <p className="cas-empty-text">
            Keep the casinos you play &mdash; the game, the heat, when a cool-off ends &mdash; and every real session&rsquo;s
            buy-ins and cash-out. It stays on this phone and is never sent anywhere.
          </p>
          <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'casino', id: null })}>
            Add a casino
          </button>
        </section>
      ) : (
        <>
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

          <GamesRanked log={log} go={go} here={here} />
          <CasinoList log={log} go={go} now={now} here={here.state.here} />
          <SessionHistory log={log} go={go} now={now} live={live} />
        </>
      )}

      <BankrollAndBackup log={log} commit={commit} />
    </div>
  );
}

function ExportNudge({ log, commit, now }: { log: CasinoLog; commit: Props['commit']; now: number }) {
  const when = log.lastExportAt
    ? `Last export ${agoText(daysBetween(localDateKey(Date.parse(log.lastExportAt)), localDateKey(now)))}.`
    : 'Never exported.';
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

function CasinoList({ log, go, now, here }: { log: CasinoLog; go: Props['go']; now: number; here: GeoPoint | null }) {
  const sorted = sortCasinos(log, now);
  // Each row's game line is the casino's best game by EV per hour, burned
  // casinos included (the ranking itself leaves them out).
  const profile = useActiveProfile();
  const { results, archive } = useGameCache(log);
  const unburned = { ...log, casinos: log.casinos.map((c) => ({ ...c, status: 'ok' as const })) };
  const ranked = buildRanking(unburned, profile, results, now, null, 'ev', archive);
  const groups: Standing[] = ['playable', 'avoid', 'burned'];
  return (
    <section className="cas-section" aria-labelledby="cas-casinos-title">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-casinos-title">
          Casinos
        </h2>
        <button type="button" className="cas-head-btn" onClick={() => go({ kind: 'casino', id: null })}>
          + Add casino
        </button>
      </div>
      {log.casinos.length === 0 && <p className="cas-note cas-pad-x">No casinos yet.</p>}
      {groups.map((g) => {
        const rows = sorted.filter((c) => standing(c, now).group === g);
        if (rows.length === 0) return null;
        return (
          <div key={g} className="cas-group" data-group={g}>
            <h3 className="cas-group-title">{GROUP_TITLE[g]}</h3>
            <ul className="cas-list">
              {rows.map((c) => (
                <CasinoRow
                  key={c.id}
                  casino={c}
                  log={log}
                  now={now}
                  best={labelledSummary(bestGameOf(c, ranked))}
                  here={here}
                  onOpen={() => go({ kind: 'casino', id: c.id })}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function CasinoRow({
  casino,
  log,
  now,
  best,
  here,
  onOpen,
}: {
  casino: Casino;
  log: CasinoLog;
  now: number;
  best: string;
  here: GeoPoint | null;
  onOpen: () => void;
}) {
  const sessions = sessionsAt(log, casino.id);
  const t = totals(sessions);
  const { group, coolOffOver } = standing(casino, now);
  const heat = worstHeat(sessions);
  const warns = casinoWarnBadges(casino);
  const more = casino.games.length - 1;
  const distance = distanceOf(casino, here);
  const noteLine = notesFirstLine(casino.notes);
  return (
    <li>
      <button type="button" className="cas-row" onClick={onOpen} data-testid="casino-row" data-casino={casino.name}>
        <span className="cas-row-top">
          <span className="cas-row-name">{casino.name}</span>
          {t.sessions > 0 && (
            <span className="cas-row-net" data-sign={Math.sign(t.net)}>
              {signedMoney(t.net)}
            </span>
          )}
        </span>
        <span className="cas-row-meta">
          {[casino.area, distance?.text, lastVisitText(sessions, now), t.sessions > 0 ? hoursText(t.hours) : null].filter(Boolean).join(' · ')}
        </span>
        <span className="cas-row-game" data-testid="casino-row-game">
          {best}
          {more > 0 && <span className="cas-row-more"> +{more} more</span>}
        </span>
        {noteLine && (
          <span className="cas-row-note" data-testid="casino-row-note">
            {noteLine}
          </span>
        )}
        {(group === 'burned' || coolOffOver || heat !== 'none' || warns.length > 0 || kindBadge(casino)) && (
          <span className="cas-row-badges">
            {kindBadge(casino) && (
              <span className="cas-badge" data-tone="info" data-testid="kind-badge">
                {kindBadge(casino)}
              </span>
            )}
            {group === 'burned' && (
              <span className="cas-badge" data-tone="bad" data-testid="burned-badge">
                Burned {burnedText(casino)}
              </span>
            )}
            {coolOffOver && (
              <span className="cas-badge" data-tone="good" data-testid="cooloff-badge">
                Cool-off over
              </span>
            )}
            <HeatBadge heat={heat} prefix="Worst: " />
            {warns.map((w) => (
              <span key={w} className="cas-badge" data-tone="warn" data-testid="warn-badge">
                {w}
              </span>
            ))}
          </span>
        )}
      </button>
    </li>
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

type ExportResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Hand the export file over, and remember when -- but only once it really
 * was handed over (review S3).
 *
 * Where the browser can share a file (iOS: the share sheet, with Save to
 * Files) that is the path, and the log counts as exported only when the share
 * completes: a dismissed sheet saved nothing, and marking it would hide the
 * backup nudge for 30 days with no backup. Elsewhere it is a download, which
 * a desktop browser completes without asking.
 */
async function exportLog(log: CasinoLog, commit: Props['commit']): Promise<ExportResult> {
  const now = Date.now();
  const name = exportFileName(now);
  const text = serializeExport(log, now);
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  let file: File | null = null;
  try {
    file = new File([text], name, { type: 'application/json' });
  } catch {
    file = null;
  }
  if (file && typeof nav.canShare === 'function' && typeof nav.share === 'function' && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
    } catch {
      return 'cancelled';
    }
    // Re-read: the sheet was up for a while, and this must not save a stale copy.
    commit(markExported(loadCasinoLog(), now));
    return 'shared';
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on a later turn: Safari can still be reading the URL when a
  // synchronous revoke runs, and saves an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  commit(markExported(log, now));
  return 'downloaded';
}

function BankrollAndBackup({ log, commit }: { log: CasinoLog; commit: Props['commit'] }) {
  const [start, setStart] = useState(() => moneyText(log.settings.startingBankroll));
  // Another tab (or an import) changed it: show the stored value, not the old text.
  const storedStart = log.settings.startingBankroll;
  const storedAt = log.settings.updatedAt;
  useEffect(() => {
    setStart(moneyText(storedStart));
  }, [storedStart, storedAt]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = mergeImport(log, String(reader.result ?? ''));
      if (!r.ok) {
        setMessage(`Import failed: ${r.error}`);
        return;
      }
      if (!commit(r.log)) {
        // The red save-failed banner says why; claiming "Imported" beside it would contradict it.
        setMessage('Import not saved: storage is full or unavailable.');
        return;
      }
      // Bytes the file carried from a corrupt blob: kept aside here too, not dropped.
      if (r.unreadable !== null) keepUnreadable(r.unreadable);
      setStart(moneyText(r.log.settings.startingBankroll));
      const p = r.report;
      const parts = [
        `${p.casinosAdded} casino${p.casinosAdded === 1 ? '' : 's'} added`,
        `${p.casinosUpdated} updated`,
        `${p.sessionsAdded} session${p.sessionsAdded === 1 ? '' : 's'} added`,
        `${p.sessionsUpdated} updated`,
      ];
      if (p.kept > 0) parts.push(`${p.kept} already up to date`);
      if (p.skipped > 0) parts.push(`${p.skipped} unreadable skipped`);
      const extra =
        p.extraRunning > 0
          ? ` ${p.extraRunning} running session${p.extraRunning === 1 ? '' : 's'} from the file left open: end ${p.extraRunning === 1 ? 'it' : 'them'} from history.`
          : '';
      setMessage(`Imported: ${parts.join(', ')}.${extra}`);
    };
    reader.onerror = () => setMessage('Import failed: the file could not be read.');
    reader.readAsText(file);
  };

  return (
    <section className="cas-section cas-backup" aria-labelledby="cas-backup-title">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-backup-title">
          Bankroll and backup
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
        <div className="cas-btn-row">
          <button
            type="button"
            className="u-btn"
            onClick={() =>
              void exportLog(log, commit).then((r) => {
                if (r === 'cancelled') setMessage('Export cancelled: nothing was saved.');
              })
            }
          >
            Export JSON
          </button>
          <button type="button" className="u-btn" onClick={() => fileRef.current?.click()}>
            Import JSON
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="cas-file"
          data-testid="casino-import-file"
          onChange={onFile}
        />
        {message && (
          <p className="cas-message" role="status">
            {message}
          </p>
        )}
        <p className="cas-note">
          {log.lastExportAt
            ? `Last exported ${agoText(daysBetween(localDateKey(Date.parse(log.lastExportAt)), localDateKey(Date.now())))}. `
            : ''}
          The casino log stays on this phone. It is not in the Stats backup and is never sent anywhere. Import merges a file
          into what is here: the newer copy of each casino or session wins.
        </p>
      </div>
    </section>
  );
}
