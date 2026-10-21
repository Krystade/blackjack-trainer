import { casinoById, type CasinoGame, type CasinoLog } from '../../../store/casinoLog';
import { simRules, type GameResult } from '../../../store/casinoGameStats';
import { describeMethod, methodBadge } from '../../../engine/betMethods';
import { gameSummary, kindBadge, labelledSummary, money, shortDate, warnBadges } from '../../casinoFigures';
import { buildRanking, evTargetMet, exitMinutesOf, gameFigures, roundsPerHourOf, type GameFigures, type RankRow } from '../../casinoRanking';
import { ASSUMED_TEXT, ciText, edgeText, evHourText, n0Text, roundsText, rorText, sdHourText } from '../../casinoStatsText';
import { enqueue, cancelAll } from './simRunner';
import { useActiveProfile, useGameResults, useRunner } from './useGameStats';
import type { CasinoView } from './Casino';
import type { RunProgress } from '../../../engine/casinoRun';

/**
 * Wave K: ONE GAME'S STATS CARD. Every betting method side by side, the house
 * edge, what was assumed, the profile the numbers used, and the run's state:
 * not computed, running (with its live figures and a Cancel), stale (the game
 * or the profile changed since), or current.
 */

const STATUS_NOTE: Record<GameResult['status'], string> = {
  running: '',
  done: 'Both targets met (house edge ±0.05%, best EV/hour ±10%).',
  time: 'Stopped at the one-minute cap; the intervals say how close it got.',
  budget: 'Stopped at the test round budget.',
  cancelled: 'Stopped early (Cancel); the intervals say how close it got.',
};

export function GameStats({ log, casinoId, gameId, go }: { log: CasinoLog; casinoId: string; gameId: string; go: (v: CasinoView) => void }) {
  const profile = useActiveProfile();
  const results = useGameResults(log);
  const runner = useRunner();
  const casino = casinoById(log, casinoId);
  const game = casino?.games.find((g) => g.id === gameId);
  if (!casino || !game) {
    return (
      <div className="cas-pad">
        <p className="cas-note">That game is no longer in the log.</p>
        <button type="button" className="u-btn cas-wide" onClick={() => go({ kind: 'home' })}>
          Back to Casino
        </button>
      </div>
    );
  }
  // The row this game would have in the ranking (built for one casino, any standing).
  const row: RankRow | undefined = buildRanking(
    { ...log, casinos: [{ ...casino, status: 'ok' }] },
    profile,
    results,
    Date.now(),
    null,
    'ev',
  ).find((r) => r.game.id === gameId);
  if (!row) return null;
  const rph = roundsPerHourOf(game);
  const bankroll = log.settings.startingBankroll;
  const running = runner.running?.gameId === gameId ? runner.running : null;
  const queued = runner.queue.includes(gameId);
  const live: GameResult | null = running?.progress ? progressResult(running.progress, row.input.spec.unit) : null;
  const shown = live ?? (row.state.kind === 'none' ? null : row.state.result);
  const exitMinutes = exitMinutesOf(log, game);
  const exitWhat = game.midShoeEntry === 'no' ? 'waiting for a fresh shoe, as mid-shoe entry is barred here' : 'finding another table';
  const figures: GameFigures | null = shown ? gameFigures(shown, rph, bankroll, exitMinutes) : null;
  const staleShown = row.state.kind === 'stale' && !live;
  const compute = () => enqueue([{ gameId, input: row.input, profileName: profile.name, exitRounds: row.exitRounds }]);
  const { rules } = simRules(game);

  return (
    <div className="cas-gs" data-testid="game-stats" data-state={running ? 'running' : queued ? 'queued' : row.state.kind}>
      <header className="cas-pad cas-gs-head">
        <p className="cas-gs-casino">
          {casino.name}
          {kindBadge(casino) && (
            <>
              {' '}
              <span className="cas-badge" data-testid="kind-badge">
                {kindBadge(casino)}
              </span>
            </>
          )}
        </p>
        <h2 className="cas-gs-title">{labelledSummary(game)}</h2>
        {warnBadges(game).length > 0 && (
          <span className="cas-row-badges">
            {warnBadges(game).map((w) => (
              <span key={w} className="cas-badge" data-tone="warn">
                {w}
              </span>
            ))}
          </span>
        )}
      </header>

      <section className="cas-gs-status cas-pad-x" aria-live="polite">
        {running ? (
          <>
            <p className="cas-gs-state" data-testid="sim-running">
              Simulating&hellip; {running.progress ? `${roundsText(running.progress.basicRounds + running.progress.countRounds)} rounds` : 'starting'}
            </p>
            <div className="cas-gs-bar" role="progressbar" aria-label="Simulation progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((running.progress?.fraction ?? 0) * 100)}>
              <span style={{ width: `${Math.round((running.progress?.fraction ?? 0) * 100)}%` }} />
            </div>
            <button type="button" className="u-btn cas-wide" onClick={cancelAll}>
              Cancel
            </button>
          </>
        ) : queued ? (
          <>
            <p className="cas-gs-state">Queued behind {runner.running ? 'the game running now' : 'others'}.</p>
            <button type="button" className="u-btn cas-wide" onClick={cancelAll}>
              Cancel
            </button>
          </>
        ) : row.state.kind === 'none' ? (
          <>
            <p className="cas-gs-state">Not computed yet. About a minute on a phone.</p>
            <button type="button" className="u-btn u-btn-primary cas-wide" onClick={compute} data-testid="compute-game">
              Compute
            </button>
          </>
        ) : row.state.kind === 'stale' ? (
          <>
            <p className="cas-gs-state cas-gs-stale" data-testid="stale-note">
              <span className="cas-badge" data-tone="warn">
                Stale
              </span>{' '}
              The game or your Play profile changed since these were computed. Shown as they were.
            </p>
            <button type="button" className="u-btn u-btn-primary cas-wide" onClick={compute} data-testid="rerun-game">
              Re-run
            </button>
          </>
        ) : (
          <>
            <p className="cas-gs-state" data-testid="gs-status">
              {row.state.result.status !== 'done' && (
                <>
                  <span className="cas-badge" data-tone="warn" data-testid="partial-badge">
                    Partial
                  </span>{' '}
                </>
              )}
              Computed {shortDate(row.state.result.computedAt, Date.now())}.{' '}
              {row.state.result.status === 'done' && figures && !evTargetMet(figures) ? (
                <span data-testid="ev-target-missed">
                  House edge target met; at {exitMinutes} min per exit the best EV/hour is {ciText(figures.best!.hours.evHourCi)}, wider than the
                  ±10% target. Re-run to tighten it.
                </span>
              ) : (
                STATUS_NOTE[row.state.result.status]
              )}
            </p>
            <button type="button" className="u-btn cas-wide" onClick={compute} data-testid="rerun-game">
              Re-run
            </button>
          </>
        )}
        {runner.error && <p className="cas-field-error">{runner.error}</p>}
      </section>

      {figures && shown && (
        <>
          <section className="cas-gs-hero cas-pad" data-testid="gs-hero" data-stale={staleShown ? 'true' : undefined}>
            <div className="cas-stat">
              <span className="cas-stat-label">{figures.best ? 'Best EV' : 'EV, flat min bet'}</span>
              <span className="cas-stat-value cas-stat-big" data-sign={Math.sign(Math.round(figures.evHour))} data-testid="gs-best-ev">
                {evHourText(figures.evHour)}
              </span>
              <span className="cas-gs-sub">
                {figures.best ? `${ciText(figures.best.hours.evHourCi)} · ${describeMethod(figures.best.method)}` : 'Continuous shuffler: not countable'}
              </span>
            </div>
            <div className="cas-stat cas-stat-right">
              <span className="cas-stat-label">House edge</span>
              <span className="cas-stat-value" data-testid="gs-edge">
                {edgeText(figures.edge, figures.edgeCi)}
              </span>
              <span className="cas-gs-sub">flat bet, basic strategy</span>
            </div>
          </section>

          {figures.methods && (
            <section className="cas-section cas-gs-methods-section" aria-labelledby="gs-methods-title" data-stale={staleShown ? 'true' : undefined}>
              <div className="cas-section-head">
                <h2 className="u-section-title" id="gs-methods-title">
                  Betting methods
                </h2>
                {staleShown && (
                  <span className="cas-badge" data-tone="warn" data-testid="methods-stale">
                    Stale
                  </span>
                )}
              </div>
              <ul className="cas-list cas-gs-methods">
                {figures.methods.map((m) => {
                  const isBest = figures.best?.method.id === m.method.id;
                  return (
                    <li key={m.method.id} className="cas-gs-method" data-best={isBest ? 'true' : undefined} data-testid="gs-method">
                      <div className="cas-gs-method-top">
                        <span className="cas-gs-method-name">{describeMethod(m.method)}</span>
                        {isBest && (
                          <span className="cas-badge" data-tone="good">
                            Best
                          </span>
                        )}
                      </div>
                      <dl className="cas-gs-grid">
                        <Fig label="EV" value={evHourText(m.hours.evHour)} sub={ciText(m.hours.evHourCi)} sign={Math.sign(Math.round(m.hours.evHour))} />
                        <Fig label="SD" value={sdHourText(m.hours.sdHour)} />
                        <Fig label="N0" value={n0Text(m.hours.n0Hours)} />
                        <Fig label="DI" value={m.hours.di.toFixed(1)} />
                        <Fig label="Avg bet" value={money(Math.round(m.stats.avgBet))} />
                        <Fig label="RoR*" value={rorText(m.hours.ror)} />
                        <Fig label="Rounds played" value={`${Math.round(m.stats.playedShare * 100)}%`} />
                        <Fig label="Exits/h" value={m.method.exitTc === null ? '—' : m.hours.exitsPerHour.toFixed(1)} sub={m.method.exitTc === null ? undefined : `${exitMinutes} min each`} testId="gs-exits" />
                        <Fig label="Per 100" value={`${(m.hours.evPer100 / shown.unit).toFixed(1)} u`} sub={`${money(Math.round(m.hours.evPer100))} · SD ${money(Math.round(m.hours.sdPer100))}`} />
                        <Fig label="Style" value={methodBadge(m.method)} />
                      </dl>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="cas-section" aria-labelledby="gs-assume-title">
        <div className="cas-section-head">
          <h2 className="u-section-title" id="gs-assume-title">
            {row.state.kind === 'stale' && !live ? 'What a re-run will use' : 'What these numbers used'}
          </h2>
        </div>
        <div className="cas-pad-x cas-gs-notes">
          <p>
            <strong>Game:</strong>{' '}
            {gameSummary({
              decks: (row.input.spec.shoeDecks ?? rules.decks) as CasinoGame['decks'],
              s17: rules.s17,
              das: rules.das,
              surrender: rules.ls,
              payout: rules.bj65 ? '6:5' : '3:2',
              cutDecksLeft: row.input.cutUsed,
              rsa: rules.rsa,
              doubleSplitAces: row.input.spec.doubleSplitAces === true,
              doubleOn: row.input.spec.doubleOn ?? 'any2',
              maxSplitHands: row.input.spec.maxSplitHands ?? 4,
            })}
            {rules.rsa ? '' : ', no resplit of aces'}
            {row.input.spec.doubleSplitAces ? ', split aces may double (never hit)' : ''}
            {row.input.spec.doubleOn ? '' : ', double any two'}, min bet {money(row.input.spec.unit)}
            {row.input.spec.maxBet !== null ? `, max ${money(row.input.spec.maxBet)}` : ', no table max'}, {rph} rounds/h.
          </p>
          {row.input.commissionPer100 > 0 && (
            <p data-testid="gs-commission">
              <strong>Commission:</strong> {money(row.input.commissionPer100)} per $100 wagered, taken from every hand dealt to you, win or lose
              ({casino.kind === 'cardroom' ? 'the collection a California card room charges' : 'a collection fee'}). It is inside the house edge and every EV here: {(row.input.commissionPer100).toFixed(2)}% of each bet.
            </p>
          )}
          {(row.input.spec.shoeDecks === 4 || row.input.spec.shoeDecks === 5) && (
            <p>
              A {row.input.spec.shoeDecks}-deck shoe is played with the multi-deck chart and index set, the ones the app uses for every shoe of 4 decks or more.
            </p>
          )}
          {!game.csm && (
            <p data-testid="gs-exit-cost">
              <strong>Leaving:</strong> each exit (a wong-out, or a back-counter leaving at its exit count) costs {exitMinutes} min of table time,{' '}
              {exitWhat} (Casino settings). Leaving on the last round before the cut costs nothing: the shuffle was coming anyway.
            </p>
          )}
          {row.input.assumed.length > 0 && (
            <p data-testid="gs-assumed">
              <strong>Assumed</strong> (not logged, so the conservative choice): {row.input.assumed.map((a) => ASSUMED_TEXT[a]).join('; ')}.
            </p>
          )}
          {game.midShoeEntry === 'unknown' && !game.csm && <p>Mid-shoe entry unknown: back-count methods are shown, marked by their style, but may not be allowed.</p>}
          <p data-testid="gs-profile">
            <strong>Profile:</strong> {shown?.profileName || profile.name} &mdash; Hi-Lo, {row.input.spec.tcRounding} true count,{' '}
            {row.input.spec.indices ? 'its index set and insurance index' : 'basic strategy only (indices off)'}, its ramp with 1 unit = the min bet, capped at the max.
          </p>
          {shown && (
            <p>
              <strong>Simulated:</strong> {roundsText(shown.basicRounds)} rounds for the house edge
              {shown.methods ? `, ${roundsText(shown.countRounds)} counted rounds for the methods` : ''}, in {(shown.ms / 1000).toFixed(1)} s. Intervals are 95%.
            </p>
          )}
          <p className="cas-note">
            Every method is scored on the same simulated rounds, played every round at one seat; a method that sits out would in reality change the
            cards slightly for the rounds after, which this ignores (the standard approximation in counting simulators). After an exit the method
            sits down at a fresh shoe once the {exitMinutes} min are up; "Rounds played" is the share of the rounds dealt that it played. *Risk of ruin is the diffusion approximation exp(&minus;2&middot;EV&middot;B/SD&sup2;) at your starting
            bankroll{bankroll === null ? ' (not set, so not shown)' : ` of ${money(bankroll)}`}. N0 is (SD/EV)&sup2;; DI is 1000&middot;EV/SD per round played.
          </p>
        </div>
      </section>
    </div>
  );
}

function Fig({ label, value, sub, sign, testId }: { label: string; value: string; sub?: string; sign?: number; testId?: string }) {
  return (
    <div className="cas-gs-fig" data-testid={testId}>
      <dt>{label}</dt>
      <dd data-sign={sign}>
        {value}
        {sub && <span className="cas-gs-fig-sub">{sub}</span>}
      </dd>
    </div>
  );
}

/** A live run's figures, shaped like a stored result so the card can show them as they firm up. */
function progressResult(p: RunProgress, unit: number): GameResult {
  return {
    key: '',
    computedAt: new Date().toISOString(),
    profileName: '',
    status: 'running',
    ms: p.ms,
    basicRounds: p.basicRounds,
    countRounds: p.countRounds,
    unit,
    basic: p.basic,
    methods: p.methods,
  };
}
