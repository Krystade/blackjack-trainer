import { useState } from 'react';
import type { Casino, CasinoGame, CasinoLog, GeoPoint } from '../../../store/casinoLog';
import {
  burnedText,
  casinoWarnBadges,
  distanceOf,
  hoursText,
  kindBadge,
  labelledSummary,
  lastVisitText,
  notesFirstLine,
  sessionsAt,
  signedMoney,
  standing,
  totals,
  worstHeat,
  type Standing,
} from '../../casinoFigures';
import { bestGameOf, buildRanking, rankScore, rankedEvHour, type RankRow } from '../../casinoRanking';
import { gameExtras, matchesQuery, readDirectorySort, sortDirectory, writeDirectorySort, type DirectorySort } from '../../casinoDirectory';
import { FigureBadges } from './FigureBadges';
import { figureLine } from '../../casinoFigureLine';
import { Choice, HeatBadge } from './fields';
import { useActiveProfile, useGameCache, useRunner } from './useGameStats';
import type { CasinoView } from './Casino';
import './casinoDirectory.css';

/**
 * Wave W: THE CASINO DIRECTORY. Every casino in the log with every game's
 * rules at a glance, searchable (name, area, notes, rules, side bets) and in
 * four orders. A row opens the casino's page (CasinoDetail); editing is a
 * tap further on, from there.
 */

const GROUP_TITLE: Record<Standing, string> = { playable: 'Playable', avoid: 'Avoid', burned: 'Burned' };
const SORT_OPTIONS: readonly { value: DirectorySort; label: string }[] = [
  { value: 'standing', label: 'Standing' },
  { value: 'name', label: 'A–Z' },
  { value: 'distance', label: 'Distance' },
  { value: 'ev', label: 'EV/h' },
];

export function CasinoDirectory({ log, go, now, here }: { log: CasinoLog; go: (v: CasinoView) => void; now: number; here: GeoPoint | null }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DirectorySort>(readDirectorySort);
  // Each casino's games by EV per hour, burned ones included (the ranking leaves them out).
  const profile = useActiveProfile();
  const { results, archive } = useGameCache(log);
  const unburned = { ...log, casinos: log.casinos.map((c) => ({ ...c, status: 'ok' as const })) };
  const ranked = buildRanking(unburned, profile, results, now, null, 'ev', archive);
  const runner = useRunner();
  /** The casino's game with the best figure (the row EV/h ranks and shows); null with none yet. */
  const bestRow = (c: Casino): RankRow | null => {
    let best: RankRow | null = null;
    for (const r of ranked) {
      if (r.casino.id !== c.id) continue;
      // C17: chosen and sorted on the rank score; the row still shows its figure.
      const v = rankScore(r);
      if (v !== null && (best === null || v > rankScore(best)!)) best = r;
    }
    return best;
  };
  const bestEv = (c: Casino): number | null => {
    const r = bestRow(c);
    return r ? rankScore(r) : null;
  };
  const found = log.casinos.filter((c) => matchesQuery(c, query, now));
  const shown = sortDirectory(log, found, sort, now, here, bestEv);
  const changeSort = (v: DirectorySort) => {
    setSort(v);
    writeDirectorySort(v);
  };

  const row = (c: Casino) => (
    <DirectoryRow
      key={c.id}
      casino={c}
      log={log}
      now={now}
      here={here}
      ranked={ranked}
      ev={sort === 'ev' ? bestRow(c) : undefined}
      failed={(k) => runner.failed[k]}
      onOpen={() => go({ kind: 'detail', id: c.id })}
    />
  );

  return (
    <section className="cas-section cas-dir" aria-labelledby="cas-casinos-title" data-testid="casino-directory">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-casinos-title">
          Casinos
        </h2>
        <button type="button" className="cas-head-btn" onClick={() => go({ kind: 'casino', id: null })}>
          + Add casino
        </button>
      </div>
      {log.casinos.length === 0 ? (
        <p className="cas-note cas-pad-x">No casinos yet.</p>
      ) : (
        <>
          <div className="cas-pad-x cas-dir-controls">
            <div className="cas-dir-search">
              <input
                type="search"
                className="cas-input cas-dir-search-input"
                name="casinoSearch"
                aria-label="Search casinos"
                placeholder="Search name, area, rules, side bets"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query !== '' && (
                <button type="button" className="cas-dir-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
                  ×
                </button>
              )}
            </div>
            <Choice label="Sort casinos by" value={sort} options={SORT_OPTIONS} onChange={changeSort} />
            <p className="cas-note" data-testid="casino-dir-count" aria-live="polite">
              {query.trim() === ''
                ? `${log.casinos.length} casino${log.casinos.length === 1 ? '' : 's'}`
                : `${found.length} of ${log.casinos.length} casino${log.casinos.length === 1 ? '' : 's'} match`}
              {sort === 'distance' && !here ? ' · by drive time or logged miles' : ''}
            </p>
          </div>
          {shown.length === 0 && (
            <p className="cas-note cas-pad-x" data-testid="casino-dir-none">
              No casino matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {sort === 'standing' ? (
            (['playable', 'avoid', 'burned'] as const).map((g) => {
              const rows = shown.filter((c) => standing(c, now).group === g);
              if (rows.length === 0) return null;
              return (
                <div key={g} className="cas-group" data-group={g}>
                  <h3 className="cas-group-title">{GROUP_TITLE[g]}</h3>
                  <ul className="cas-list">{rows.map(row)}</ul>
                </div>
              );
            })
          ) : (
            <ul className="cas-list">{shown.map(row)}</ul>
          )}
        </>
      )}
    </section>
  );
}

/** A casino's games with the best (by EV per hour) first, the rest in log order. */
function gamesBestFirst(c: Casino, ranked: readonly RankRow[]): CasinoGame[] {
  const best = bestGameOf(c, ranked);
  return [best, ...c.games.filter((g) => g.id !== best.id)];
}

function DirectoryRow({
  casino,
  log,
  now,
  here,
  ranked,
  ev,
  failed,
  onOpen,
}: {
  casino: Casino;
  log: CasinoLog;
  now: number;
  here: GeoPoint | null;
  ranked: readonly RankRow[];
  /** Under the EV order: the casino's best game (null = no figure yet). */
  ev: RankRow | null | undefined;
  /** Why a run failed, by its input key. */
  failed: (key: string) => string | undefined;
  onOpen: () => void;
}) {
  const sessions = sessionsAt(log, casino.id);
  const t = totals(sessions);
  const { group, coolOffOver } = standing(casino, now);
  const heat = worstHeat(sessions);
  const warns = casinoWarnBadges(casino);
  const distance = distanceOf(casino, here);
  const noteLine = notesFirstLine(casino.notes);
  const kind = kindBadge(casino);
  return (
    <li>
      <button type="button" className="cas-row cas-dir-row" onClick={onOpen} data-testid="casino-row" data-casino={casino.name}>
        <span className="cas-row-top">
          <span className="cas-row-name">{casino.name}</span>
          {ev === undefined && t.sessions > 0 && (
            <span className="cas-row-net" data-sign={Math.sign(t.net)}>
              {signedMoney(t.net)}
            </span>
          )}
        </span>
        {/* Review S1: under EV/h, the best game's figure as Ranked says it -- with its interval, marked when it is an estimate or stale. */}
        {ev !== undefined && <RowFigure row={ev} failed={ev ? failed(ev.input.key) : undefined} />}
        <span className="cas-row-meta">
          {[casino.area, distance?.text, lastVisitText(sessions, now), t.sessions > 0 ? hoursText(t.hours) : null]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="cas-dir-games">
          {gamesBestFirst(casino, ranked).map((g) => {
            const extras = gameExtras(g);
            return (
              <span key={g.id} className="cas-dir-game" data-testid="casino-row-game" data-game={g.id}>
                <span className="cas-row-game">{labelledSummary(g)}</span>
                {extras.length > 0 && <span className="cas-dir-extras">{extras.join(' · ')}</span>}
              </span>
            );
          })}
        </span>
        {noteLine && (
          <span className="cas-row-note" data-testid="casino-row-note">
            {noteLine}
          </span>
        )}
        {(group === 'burned' || coolOffOver || heat !== 'none' || warns.length > 0 || kind) && (
          <span className="cas-row-badges">
            {kind && (
              <span className="cas-badge" data-tone="info" data-testid="kind-badge">
                {kind}
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

function RowFigure({ row, failed }: { row: RankRow | null; failed: string | undefined }) {
  if (!row) {
    return (
      <span className="cas-dir-ev" data-sign={0} data-testid="casino-row-ev">
        —
      </span>
    );
  }
  const line = figureLine(row, failed);
  const ev = rankedEvHour(row);
  return (
    // data-ev: the figure the EV/h order sorts by (review S5), unrounded.
    <span className="cas-dir-ev" data-testid="casino-row-ev" data-sign={line.sign} data-ev={ev ?? undefined}>
      <span className="cas-dir-ev-text">{line.text}</span>
      <FigureBadges line={line} />
    </span>
  );
}
