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
import { bestGameOf, buildRanking, rankedEvHour, type RankRow } from '../../casinoRanking';
import { gameExtras, matchesQuery, readDirectorySort, sortDirectory, writeDirectorySort, type DirectorySort } from '../../casinoDirectory';
import { evHourText } from '../../casinoStatsText';
import { Choice, HeatBadge } from './fields';
import { useActiveProfile, useGameCache } from './useGameStats';
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
  const bestEv = (c: Casino): number | null => {
    let best: number | null = null;
    for (const r of ranked) {
      if (r.casino.id !== c.id) continue;
      const v = rankedEvHour(r);
      if (v !== null && (best === null || v > best)) best = v;
    }
    return best;
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
      ev={sort === 'ev' ? bestEv(c) : undefined}
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
  onOpen,
}: {
  casino: Casino;
  log: CasinoLog;
  now: number;
  here: GeoPoint | null;
  ranked: readonly RankRow[];
  /** Under the EV order: the casino's best figure (null = none yet). */
  ev: number | null | undefined;
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
          {ev !== undefined ? (
            <span className="cas-row-net" data-sign={ev === null ? 0 : Math.sign(Math.round(ev))} data-testid="casino-row-ev">
              {ev === null ? '—' : evHourText(ev)}
            </span>
          ) : (
            t.sessions > 0 && (
              <span className="cas-row-net" data-sign={Math.sign(t.net)}>
                {signedMoney(t.net)}
              </span>
            )
          )}
        </span>
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
