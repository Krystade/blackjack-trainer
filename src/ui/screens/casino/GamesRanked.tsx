import { useState } from 'react';
import type { CasinoLog } from '../../../store/casinoLog';
import { methodBadge } from '../../../engine/betMethods';
import { labelledSummary } from '../../casinoFigures';
import { useSideRuns } from './sideRunner';
import { buildRanking, needsCompute, rankedEvHour, type RankRow, type RankSort } from '../../casinoRanking';
import { ciText, evHourText, n0Text, pctText, roundsText } from '../../casinoStatsText';
import { Choice } from './fields';
import { cancelAll, enqueue } from './simRunner';
import { useActiveProfile, useGameResults, useRunner, type useHere } from './useGameStats';
import type { CasinoView } from './Casino';

/**
 * Wave K: "GAMES RANKED" -- every logged game across the casinos, by what it
 * returns an hour at its best betting method (or by distance, or by EV per
 * trip hour), each row opening its stats card.
 */

const SORT_KEY = 'bjtrainer.casinoRankSort.v1';

function readSort(): RankSort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    return v === 'distance' || v === 'trip' ? v : 'ev';
  } catch {
    return 'ev';
  }
}

/** `here` is the casino screen's one "Use my location" state, shared with the casino list. */
export function GamesRanked({ log, go, here: where }: { log: CasinoLog; go: (v: CasinoView) => void; here: ReturnType<typeof useHere> }) {
  const profile = useActiveProfile();
  const results = useGameResults(log);
  const runner = useRunner();
  // Wave L: a side-bet run finishing can reorder the list.
  useSideRuns();
  const { state: here, toggle: toggleHere } = where;
  const [sort, setSort] = useState<RankSort>(readSort);
  const rows = buildRanking(log, profile, results, Date.now(), here.here, sort);
  if (rows.length === 0) return null;
  // Review S3: a partial run (cancelled, cut off by the time cap) is run again too.
  const todo = rows.filter(needsCompute);
  const busy = runner.running !== null;
  const changeSort = (v: RankSort) => {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* per-device convenience */
    }
  };
  const computeAll = () => enqueue(todo.map((r) => ({ gameId: r.game.id, input: r.input, profileName: profile.name, exitRounds: r.exitRounds })));

  return (
    <section className="cas-section cas-rank" aria-labelledby="cas-rank-title" data-testid="games-ranked">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="cas-rank-title">
          Games ranked
        </h2>
        <button type="button" className="cas-head-btn" onClick={() => go({ kind: 'settings' })}>
          Settings
        </button>
      </div>
      <div className="cas-pad-x cas-rank-controls">
        <Choice
          label="Sort games by"
          value={sort}
          options={[
            { value: 'ev', label: 'EV/hour' },
            { value: 'distance', label: 'Distance' },
            { value: 'trip', label: 'EV/trip h' },
          ]}
          onChange={changeSort}
        />
        <label className="cas-check cas-rank-here">
          <input type="checkbox" checked={here.on} onChange={toggleHere} data-testid="use-location" />
          <span>
            Use my location
            {here.on && here.status === 'locating' ? ' (finding you…)' : ''}
            {here.on && here.status === 'denied' ? ' (blocked in the browser)' : ''}
            {here.on && here.status === 'unavailable' ? ' (not available)' : ''}
          </span>
        </label>
        <p className="cas-note" data-testid="use-location-hint">
          While this is on, your position is read each time you open Casino, for the miles to each saved spot. It is never stored.
        </p>
        <p className="cas-note">
          With {profile.name}&rsquo;s counting setup, 1 unit = each game&rsquo;s min bet.
          {sort === 'trip' ? ' EV per trip hour counts the drive both ways.' : ''}
        </p>
        {busy ? (
          <div className="cas-rank-busy" data-testid="rank-busy">
            <span>
              Computing {runner.queue.length > 0 ? `(${runner.queue.length} more queued)` : ''}
              {runner.running?.progress ? ` · ${roundsText(runner.running.progress.basicRounds + runner.running.progress.countRounds)} rounds` : ''}
            </span>
            <button type="button" className="u-btn" onClick={cancelAll}>
              Cancel
            </button>
          </div>
        ) : (
          todo.length > 0 && (
            <button type="button" className="u-btn cas-wide" onClick={computeAll} data-testid="compute-all">
              <span className="cas-rank-compute-part">
                {todo.every((r) => r.state.kind === 'none') && todo.length === rows.length ? 'Compute all' : `Compute ${todo.length} not done`} &middot;
              </span>{' '}
              <span className="cas-rank-compute-part">about {todo.length} min</span>
            </button>
          )
        )}
      </div>
      <ol className="cas-list cas-rank-list">
        {rows.map((r, i) => (
          <RankItem key={r.game.id} row={r} place={i + 1} sort={sort} running={runner.running?.gameId === r.game.id} onOpen={() => go({ kind: 'game', casinoId: r.casino.id, gameId: r.game.id })} />
        ))}
      </ol>
    </section>
  );
}

function RankItem({ row, place, sort, running, onOpen }: { row: RankRow; place: number; sort: RankSort; running: boolean; onOpen: () => void }) {
  const f = row.figures;
  const value = !f ? null : sort === 'trip' && row.tripEv !== null ? row.tripEv : rankedEvHour(row);
  return (
    <li>
      <button
        type="button"
        className="cas-row cas-rank-row"
        onClick={onOpen}
        data-testid="rank-row"
        data-game={row.game.id}
        data-greyed={row.greyed ? 'true' : undefined}
        data-state={row.state.kind}
      >
        <span className="cas-row-top">
          <span className="cas-rank-name">
            <span className="cas-rank-place">{place}</span>
            <span className="cas-row-name">{row.casino.name}</span>
          </span>
          <span className="cas-row-net" data-sign={value === null ? 0 : Math.sign(Math.round(value))} data-testid="rank-ev">
            {running ? 'running…' : value === null ? 'not computed' : `${evHourText(value)}${sort === 'trip' && row.tripEv !== null ? ' trip' : ''}`}
          </span>
        </span>
        <span className="cas-row-game">{labelledSummary(row.game)}</span>
        {f && (
          <span className="cas-row-meta cas-rank-meta">
            {[`edge ${pctText(f.edge)}`, f.best ? `N0 ${n0Text(f.n0Hours)}` : null, row.distance?.text ?? null].filter(Boolean).join(' · ')}
          </span>
        )}
        {!f && row.distance && <span className="cas-row-meta">{row.distance.text}</span>}
        <span className="cas-row-badges">
          {f?.best && (
            <span className="cas-badge" data-tone="good" data-testid="best-style">
              {/* Review S1: with a side bet, the seated method it rides on. */}
              {methodBadge(row.withSide?.method?.method ?? f.best.method)}
            </span>
          )}
          {/* Wave L: the figure includes the game's best side bet, counted. */}
          {f && row.sideEvHour !== undefined && (
            <span className="cas-badge" data-tone="good" data-testid="side-bet-badge">
              + side bet
            </span>
          )}
          {row.midShoeUnknown && (
            <span className="cas-badge" data-tone="warn" data-testid="midshoe-unknown-badge">
              Mid-shoe ?
            </span>
          )}
          {row.state.kind === 'stale' && (
            <span className="cas-badge" data-tone="warn" data-testid="stale-badge">
              Stale
            </span>
          )}
          {f?.partial && (
            <span className="cas-badge" data-tone="warn" data-testid="partial-badge">
              Partial {ciText(f.evHourCi)}/h
            </span>
          )}
          {row.greyed && <span className="cas-badge">Avoid</span>}
          {sort === 'trip' && f && row.tripEv === null && <span className="cas-badge">No drive time</span>}
          {row.warns.map((w) => (
            <span key={w} className="cas-badge" data-tone="warn" data-testid="warn-badge">
              {w}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}
