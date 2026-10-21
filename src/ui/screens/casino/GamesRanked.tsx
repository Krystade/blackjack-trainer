import { useState } from 'react';
import type { CasinoLog } from '../../../store/casinoLog';
import { methodBadge } from '../../../engine/betMethods';
import { gameLogged, kindBadge, labelledSummary } from '../../casinoFigures';
import { useSideRuns } from './sideRunner';
import { buildRanking, rankedEvHour, type RankRow, type RankSort } from '../../casinoRanking';
import { assumedLabel, assumedRulesBadge, ciText, evHourText, materialAssumedRules, n0Text, pctText, roundsText } from '../../casinoStatsText';
import { Choice } from './fields';
import type { RunnerState } from './simRunner';
import { useActiveProfile, useGameCache, useRunner, type useHere } from './useGameStats';
import type { CasinoView } from './Casino';
import './casinoAuto.css';

/**
 * Wave K: "GAMES RANKED" -- every logged game across the casinos, by what it
 * returns an hour at its best betting method (or by distance, or by EV per
 * trip hour), each row opening its stats card.
 *
 * Wave Q: no Compute button. Every game's figures are worked out on their own
 * (AutoSim.tsx, simRunner.ts): a row with none yet says "estimating...", an
 * estimate is marked as one with its interval, and a row whose game or
 * profile changed keeps its old figures marked "Updating" until the new ones
 * land.
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
  const { results, archive } = useGameCache(log);
  const runner = useRunner();
  // Wave L: a side-bet run finishing can reorder the list.
  useSideRuns();
  const { state: here, toggle: toggleHere } = where;
  const [sort, setSort] = useState<RankSort>(readSort);
  const rows = buildRanking(log, profile, results, Date.now(), here.here, sort, archive);
  if (rows.length === 0) return null;
  const changeSort = (v: RankSort) => {
    setSort(v);
    try {
      localStorage.setItem(SORT_KEY, v);
    } catch {
      /* per-device convenience */
    }
  };

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
        <AutoStatus runner={runner} rows={rows} />
      </div>
      <ol className="cas-list cas-rank-list">
        {rows.map((r, i) => (
          <RankItem
            key={r.game.id}
            row={r}
            place={i + 1}
            sort={sort}
            running={runner.running !== null && runner.running.key === r.input.key}
            failed={runner.failed[r.input.key]}
            onOpen={() => go({ kind: 'game', casinoId: r.casino.id, gameId: r.game.id })}
          />
        ))}
      </ol>
    </section>
  );
}

/**
 * Wave Q: what the automatic runs are doing, in one line under the controls:
 * how many games still lack a first estimate, then how many are being firmed
 * up, then only the standing note once every figure is as good as it gets on
 * its own.
 */
function AutoStatus({ runner, rows }: { runner: RunnerState; rows: readonly RankRow[] }) {
  const { first, refine } = runner.todo;
  const r = runner.running;
  const name = r ? rows.find((x) => x.input.key === r.key)?.casino.name : undefined;
  // The round count never wraps apart (at 320 it would leave "rounds" alone on a line).
  const rounds = r?.progress ? (
    <>
      {' · '}
      <span className="cas-auto-rounds">{roundsText(r.progress.basicRounds + r.progress.countRounds)} rounds</span>
    </>
  ) : null;
  const nFailed = rows.filter((x) => runner.failed[x.input.key] !== undefined).length;
  const phase = first > 0 ? 'estimating' : refine > 0 ? (runner.holdRefines ? 'held' : 'refining') : nFailed > 0 ? 'error' : 'idle';
  return (
    <div className="cas-auto" data-testid="rank-auto" data-phase={phase}>
      {phase === 'estimating' && (
        <p className="cas-auto-line" role="status">
          <span className="cas-auto-dot" aria-hidden="true" />
          <span>
            Estimating {first} game{first === 1 ? '' : 's'}
            {rounds}
          </span>
        </p>
      )}
      {phase === 'refining' && (
        <p className="cas-auto-line" role="status">
          <span className="cas-auto-dot" aria-hidden="true" />
          <span>
            Firming up {refine} estimate{refine === 1 ? '' : 's'}
            {name ? ` · ${name}` : ''}
            {rounds}
          </span>
        </p>
      )}
      {phase === 'held' && (
        <p className="cas-auto-line" role="status" data-testid="rank-held">
          <span>
            {refine} estimate{refine === 1 ? '' : 's'} firm{refine === 1 ? 's' : ''} up after this session
          </span>
        </p>
      )}
      {/* Review S2: said whenever a game failed, whatever else is still running. */}
      {nFailed > 0 && (
        <p className="cas-field-error" role="alert" data-testid="rank-failed-line">
          The simulator failed on {nFailed} game{nFailed === 1 ? '' : 's'}: {runner.error}
        </p>
      )}
      {/* Review B1: the figures show this session, but are not kept; nothing more is worked out for them. */}
      {runner.storageFull && (
        <p className="cas-field-error" role="alert" data-testid="rank-storage-full">
          Couldn&rsquo;t save figures &mdash; storage full
        </p>
      )}
      <p className="cas-note">Figures follow each game&rsquo;s rules and your profile: worked out on this phone, on their own, while Casino is open.</p>
    </div>
  );
}

function RankItem({ row, place, sort, running, failed, onOpen }: { row: RankRow; place: number; sort: RankSort; running: boolean; failed: string | undefined; onOpen: () => void }) {
  const f = row.figures;
  const status = row.state.kind === 'none' ? null : row.state.result.status;
  const value = !f ? null : sort === 'trip' && row.tripEv !== null ? row.tripEv : rankedEvHour(row);
  // Review S4: the figure rests on guesses for these rules (conservative, or
  // the best case for the split cap and double-on, Wave P); only the ones
  // that can move it by 0.05% of action or more (the card lists all).
  // A variant game is never simulated, so the standard game's guesses are not
  // behind anything on its row. Nor is anything assumed of a game with no
  // rules logged at all ("Game not logged"): every rule is a guess there.
  const assumed = row.notModelled || !gameLogged(row.game) ? [] : materialAssumedRules(row.input.assumed, row.game);
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
        data-status={status ?? undefined}
        data-running={running ? 'true' : undefined}
      >
        <span className="cas-row-top">
          <span className="cas-rank-name">
            <span className="cas-rank-place">{place}</span>
            <span className="cas-row-name">{row.casino.name}</span>
          </span>
          <span className="cas-row-net" data-sign={value === null ? 0 : Math.sign(Math.round(value))} data-testid="rank-ev">
            {row.notModelled
              ? 'not modelled'
              : value === null
                ? failed !== undefined
                  ? 'not worked out'
                  : 'estimating…'
                : `${evHourText(value)}${sort === 'trip' && row.tripEv !== null ? ' trip' : ''}`}
          </span>
        </span>
        <span className="cas-row-game">{labelledSummary(row.game)}</span>
        {f && (
          <span className="cas-row-meta cas-rank-meta">
            {[`edge ${pctText(f.edge)}`, f.best ? `N0 ${n0Text(f.n0Hours)}` : null, row.distance?.text ?? null].filter(Boolean).join(' · ')}
          </span>
        )}
        {!f && row.distance && <span className="cas-row-meta">{row.distance.text}</span>}
        {/* Review S2: why this game has no figures, and will not get them this session. */}
        {failed !== undefined && (
          <span className="cas-row-meta cas-rank-failed" data-testid="rank-failed">
            The simulator failed: {failed}
          </span>
        )}
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
          {/* Wave Q: the game or profile changed; its new figures are on the way. */}
          {row.state.kind === 'stale' && (
            <span className="cas-badge" data-tone="warn" data-testid="stale-badge">
              Updating
            </span>
          )}
          {/* Wave Q: a first estimate, or one paused part way: more to come, on its own. */}
          {f && row.state.kind === 'current' && (status === 'partial' || status === 'cancelled') && (
            <span className="cas-badge" data-tone="info" data-testid="estimate-badge">
              Estimate {ciText(f.evHourCi)}/h
            </span>
          )}
          {f && row.state.kind === 'current' && (status === 'time' || status === 'budget') && (
            <span className="cas-badge" data-tone="warn" data-testid="partial-badge">
              Partial {ciText(f.evHourCi)}/h
            </span>
          )}
          {running && f && row.state.kind === 'current' && (
            <span className="cas-badge" data-tone="info" data-testid="working-badge">
              working…
            </span>
          )}
          {row.greyed && <span className="cas-badge">Avoid</span>}
          {kindBadge(row.casino) && (
            <span className="cas-badge" data-tone="info" data-testid="kind-badge">
              {kindBadge(row.casino)}
            </span>
          )}
          {assumed.length > 0 && (
            <span className="cas-badge" data-tone="warn" data-testid="assumed-badge" title={assumed.map(assumedLabel).join('; ')}>
              {assumedRulesBadge(assumed.length)}
            </span>
          )}
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
