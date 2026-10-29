import { currentVersionId, earlierVersions, gameAtVersion, versionsOf, type Casino, type CasinoGame, type CasinoLog } from '../../../store/casinoLog';
import { gameSummary, hoursText, sessionHours, sessionNet, shortDate, signedMoney, totals } from '../../casinoFigures';
import type { RankRow } from '../../casinoRanking';
import { figureLine } from '../../casinoFigureLine';
import { dateText, ruleChanges, sessionsAtVersion, versionSpan } from '../../casinoVersions';
import { FigureBadges } from './FigureBadges';
import './casinoVersions.css';

/**
 * Wave W (review S2): a game's earlier versions on its casino's page, newest
 * first -- when each set of rules held, what changed after it, its own
 * figures (kept in the cache for it) and the sessions played at it.
 */

function sessionsLine(log: CasinoLog, casino: Casino, game: CasinoGame, versionId: string): string {
  const list = sessionsAtVersion(log, casino.id, game.id, versionId);
  if (list.length === 0) return 'No sessions at these rules.';
  const t = totals(list);
  return `${t.sessions} session${t.sessions === 1 ? '' : 's'} · ${signedMoney(t.net)} over ${hoursText(t.hours)}${list.length > t.sessions ? ` · ${list.length - t.sessions} open` : ''}`;
}

/** "Since 20 Oct 2026 · 2 sessions …" under the current rules, once there are earlier ones. */
export function CurrentVersionLine({ log, casino, game }: { log: CasinoLog; casino: Casino; game: CasinoGame }) {
  if (earlierVersions(game).length === 0) return null;
  const cur = versionsOf(game).find((v) => v.versionId === currentVersionId(game))!;
  return (
    <p className="cas-ver-since" data-testid="current-version">
      These rules since {dateText(cur.createdAt)} · {sessionsLine(log, casino, game, cur.versionId)}
    </p>
  );
}

export function EarlierVersions({
  log,
  casino,
  game,
  rows,
  now,
  onSession,
}: {
  log: CasinoLog;
  casino: Casino;
  game: CasinoGame;
  /** Each earlier version's ranking row, by version id. */
  rows: ReadonlyMap<string, RankRow>;
  now: number;
  onSession: (id: string) => void;
}) {
  const earlier = earlierVersions(game);
  if (earlier.length === 0) return null;
  const all = versionsOf(game);
  return (
    <div className="cas-dir-sub" data-testid="earlier-versions">
      <h4 className="cas-dir-sub-title">Earlier versions</h4>
      <ul className="cas-ver-list">
        {earlier.map((v) => {
          const span = versionSpan(game, v);
          const asGame = gameAtVersion(game, v);
          const next = all[all.findIndex((x) => x.versionId === v.versionId) + 1];
          const changes = next ? ruleChanges(asGame, gameAtVersion(game, next)) : [];
          const row = rows.get(v.versionId);
          const line = row && row.state.kind !== 'none' ? figureLine(row) : null;
          const sessions = sessionsAtVersion(log, casino.id, game.id, v.versionId).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
          return (
            <li key={v.versionId} className="cas-ver-item" data-testid="earlier-version" data-version={v.versionId}>
              <p className="cas-ver-dates">
                {dateText(span.from)} – {span.until ? dateText(span.until) : 'now'}
              </p>
              <p className="cas-ver-summary">{gameSummary(asGame) || 'No rules logged'}</p>
              {changes.length > 0 && span.until && (
                <p className="cas-ver-diff" data-testid="earlier-version-changes">
                  Changed {dateText(span.until)}: {changes.join('; ')}.
                </p>
              )}
              <p className="cas-ver-figure" data-testid="earlier-version-figures" data-sign={line?.sign ?? 0}>
                {game.variant !== undefined ? (
                  <span className="cas-ver-figure-text">Not modelled: the simulator does not deal this game</span>
                ) : line ? (
                  <>
                    <span className="cas-ver-figure-text">{line.text}</span>
                    <FigureBadges line={line} />
                  </>
                ) : (
                  <span className="cas-ver-figure-text">No figures kept for these rules</span>
                )}
              </p>
              <p className="cas-ver-sessions" data-testid="earlier-version-sessions">
                {sessionsLine(log, casino, game, v.versionId)}
              </p>
              {sessions.length > 0 && (
                <ul className="cas-list cas-ver-session-list">
                  {sessions.map((s) => {
                    const net = sessionNet(s);
                    return (
                      <li key={s.id}>
                        <button type="button" className="cas-hist" data-testid="earlier-version-session" disabled={s.end === null} onClick={() => onSession(s.id)}>
                          <span className="cas-hist-main">
                            <span className="cas-hist-date">{shortDate(s.start, now)}</span>
                            <span className="cas-hist-casino">{s.end === null ? 'In progress' : hoursText(sessionHours(s, now))}</span>
                          </span>
                          <span className="cas-hist-side">
                            <span className="cas-hist-net" data-sign={net === null ? 0 : Math.sign(net)}>
                              {net === null ? 'open' : signedMoney(net)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
