import type { ReactNode } from 'react';
import { casinoById, earlierVersions, gameAtVersion, type Casino, type CasinoGame, type CasinoLog } from '../../../store/casinoLog';
import {
  burnedText,
  distanceOf,
  hoursText,
  kindBadge,
  gameSummary,
  labelledSummary,
  lastVisitText,
  sessionHours,
  sessionNet,
  sessionsAt,
  shortDate,
  signedMoney,
  standing,
  totals,
  warnBadges,
  worstHeat,
} from '../../casinoFigures';
import { buildRanking, type RankRow } from '../../casinoRanking';
import { ruleLines, sideBetText } from '../../casinoDirectory';
import { figureLine } from '../../casinoFigureLine';
import { FigureBadges } from './FigureBadges';
import { HeatBadge } from './fields';
import { NotesEditor } from './NotesEditor';
import { CurrentVersionLine, EarlierVersions } from './EarlierVersions';
import { useActiveProfile, useGameCache, useHere, useRunner } from './useGameStats';
import type { CasinoView } from './Casino';
import './casinoDirectory.css';

/**
 * Wave W: ONE CASINO'S PAGE, to read. Where it is and how it has gone, its
 * notes (edited in place, as on the form), and every game with its full rule
 * set -- what is not logged said so, a rule the owner marked "?" marked --
 * its side bets, its notes and its figures. Edit opens the form; a game's
 * Figures opens its stats card; both come back here.
 */
export function CasinoDetail({
  log,
  id,
  commit,
  go,
}: {
  log: CasinoLog;
  id: string;
  commit: (next: CasinoLog) => boolean;
  go: (v: CasinoView) => void;
}) {
  const here = useHere().state.here;
  const profile = useActiveProfile();
  const { results, archive } = useGameCache(log);
  const runner = useRunner();
  const casino = casinoById(log, id);
  const now = Date.now();
  if (!casino) {
    return (
      <div className="cas-pad">
        <p className="cas-note">That casino is no longer in the log.</p>
        <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'home' })}>
          Back to Casino
        </button>
      </div>
    );
  }
  const self: CasinoView = { kind: 'detail', id: casino.id };
  // Every game's row, whatever the casino's standing.
  const rows = buildRanking({ ...log, casinos: [{ ...casino, status: 'ok' }] }, profile, results, now, null, 'ev', archive);
  // Review S2: each earlier version's figures, by its own rules (found in the cache by their key, never worked out again).
  const pastGames = casino.games.flatMap((g) => earlierVersions(g).map((v) => gameAtVersion(g, v)));
  const pastRows = new Map(
    (pastGames.length > 0 ? buildRanking({ ...log, casinos: [{ ...casino, status: 'ok', games: pastGames }] }, profile, results, now, null, 'ev', archive) : []).map((r) => [r.game.id, r]),
  );
  const sessions = sessionsAt(log, casino.id);
  const t = totals(sessions);
  const { group, coolOffOver } = standing(casino, now);
  const heat = worstHeat(sessions);
  const distance = distanceOf(casino, here);
  const kind = kindBadge(casino);

  return (
    <div className="cas-detail" data-testid="casino-detail" data-casino={casino.name}>
      <section className="cas-pad cas-stack cas-detail-head" aria-label="About">
        <p className="cas-detail-meta" data-testid="casino-detail-meta">
          {[casino.area, distance?.text, lastVisitText(sessions, now)].filter(Boolean).join(' · ')}
        </p>
        {(kind || group !== 'playable' || coolOffOver || heat !== 'none') && (
          <p className="cas-row-badges">
            {kind && (
              <span className="cas-badge" data-tone="info" data-testid="kind-badge">
                {kind}
              </span>
            )}
            {group === 'avoid' && (
              <span className="cas-badge" data-tone="warn">
                Avoid
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
          </p>
        )}
        <p className="cas-detail-totals" data-testid="casino-detail-totals">
          {t.sessions === 0 ? (
            'Never played here yet.'
          ) : (
            <>
              <span data-sign={Math.sign(t.net)}>{signedMoney(t.net)}</span> over {hoursText(t.hours)} in {t.sessions} session
              {t.sessions === 1 ? '' : 's'}
              {t.perHour !== null ? ` · ${signedMoney(Math.round(t.perHour))}/h` : ''}
            </>
          )}
        </p>
        <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'casino', id: casino.id, from: self })}>
          Edit casino
        </button>
      </section>

      <NotesEditor log={log} casinoId={casino.id} commit={commit} />

      <section className="cas-section" aria-labelledby="cas-detail-games">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-detail-games">
            {casino.games.length === 1 ? 'Game' : `Games (${casino.games.length})`}
          </h2>
        </div>
        <div className="cas-pad-x cas-stack">
          {casino.games.map((g, i) => (
            <GameCard
              key={g.id}
              casino={casino}
              game={g}
              index={i}
              row={rows.find((r) => r.game.id === g.id)}
              failed={(k) => runner.failed[k]}
              onFigures={() => go({ kind: 'game', casinoId: casino.id, gameId: g.id, from: self })}
              onEdit={() => go({ kind: 'casino', id: casino.id, focusGame: g.id, from: self })}
              versions={
                <>
                  <CurrentVersionLine log={log} casino={casino} game={g} />
                  <EarlierVersions log={log} casino={casino} game={g} rows={pastRows} now={now} onSession={(sid) => go({ kind: 'session', sessionId: sid, from: self })} />
                </>
              }
            />
          ))}
        </div>
      </section>

      <section className="cas-section" aria-labelledby="cas-detail-sessions">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="cas-detail-sessions">
            Sessions here
          </h2>
        </div>
        {sessions.length === 0 ? (
          <p className="cas-note cas-pad-x">None yet.</p>
        ) : (
          <ul className="cas-list">
            {sessions.map((s) => {
              const net = sessionNet(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="cas-hist"
                    data-testid="detail-session"
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
        )}
      </section>
    </div>
  );
}

function GameCard({
  casino,
  game,
  index,
  row,
  failed,
  onFigures,
  onEdit,
  versions,
}: {
  casino: Casino;
  game: CasinoGame;
  index: number;
  row: RankRow | undefined;
  failed: (key: string) => string | undefined;
  onFigures: () => void;
  /** Review S2: the form, at this game's rules. */
  onEdit: () => void;
  /** Review S2: since when these rules hold, and the game's earlier versions. */
  versions: ReactNode;
}) {
  // Review S1: the figure as Ranked says it, with its interval and what it is.
  const line = row ? figureLine(row, failed(row.input.key)) : null;
  const lines = ruleLines(game);
  const warns = warnBadges(game);
  const title = game.label?.trim() || (casino.games.length === 1 ? 'The game' : `Game ${index + 1}`);
  return (
    <article className="cas-dir-card" data-testid="detail-game" data-game={game.id} aria-label={title}>
      <h3 className="cas-dir-card-title">{title}</h3>
      <p className="cas-row-game cas-dir-card-summary">{game.label?.trim() ? gameSummary(game) : labelledSummary(game)}</p>
      <div className="cas-dir-figures">
        <div className="cas-dir-figures-main">
          <p className="cas-dir-figures-text" data-testid="detail-figures" data-sign={line?.sign ?? 0}>
            {line ? line.text : 'No figures'}
          </p>
          {line && (line.edge || line.extras.length > 0 || line.badges.length > 0) && (
            <p className="cas-dir-figures-sub" data-testid="detail-figures-sub">
              {[line.edge, ...line.extras].filter(Boolean).join(' · ')}
              {line.badges.length > 0 && ' '}
              <FigureBadges line={line} />
            </p>
          )}
        </div>
        <span className="cas-dir-card-actions">
          <button type="button" className="cas-head-btn" onClick={onEdit} data-testid="edit-rules">
            Edit rules
          </button>
          <button type="button" className="cas-head-btn" onClick={onFigures}>
            Figures
          </button>
        </span>
      </div>
      {warns.length > 0 && (
        <p className="cas-row-badges">
          {warns.map((w) => (
            <span key={w} className="cas-badge" data-tone="warn" data-testid="warn-badge">
              {w}
            </span>
          ))}
        </p>
      )}
      <dl className="cas-rules" data-testid="detail-rules">
        {lines.map((l) => (
          <div key={l.field} className="cas-rule" data-field={l.field} data-unknown={l.value === null ? 'true' : undefined}>
            <dt>{l.label}</dt>
            <dd>
              {l.value ?? 'Not logged'}
              {l.unsure && (
                <span className="cas-rule-unsure" title="You marked this one as not sure">
                  {' '}
                  ?<span className="u-sr-only"> (not sure)</span>
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="cas-dir-sub">
        <h4 className="cas-dir-sub-title">Side bets</h4>
        {game.sideBets && game.sideBets.length > 0 ? (
          <ul className="cas-dir-sides" data-testid="detail-side-bets">
            {game.sideBets.map((s, i) => (
              <li key={`${s.bet}-${i}`}>{sideBetText(s)}</li>
            ))}
          </ul>
        ) : (
          <p className="cas-note">None logged.</p>
        )}
      </div>
      {game.notes?.trim() && (
        <div className="cas-dir-sub">
          <h4 className="cas-dir-sub-title">Game notes</h4>
          <p className="cas-dir-game-notes">{game.notes}</p>
        </div>
      )}
      {versions}
    </article>
  );
}
