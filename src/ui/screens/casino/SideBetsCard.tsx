import { useEffect } from 'react';
import './casinoSideBets.css';
import type { CasinoGame } from '../../../store/casinoLog';
import { sideRowSpec } from '../../../store/casinoSideRows';
import { BET_NAMES, payTableOf } from '../../../engine/sideBets/payTables';
import { bestSideEvHour, gameSideFigures } from '../../casinoSideFigures';
import { evHourText } from '../../casinoStatsText';
import { money } from '../../casinoFigures';
import { pct } from '../../sideBetSummary';
import { triggerText } from '../../sideBetFeedback';
import { requestSideRow, sideRunState, useSideRuns } from './sideRunner';

/**
 * Wave L: the stats card's side bets -- one row per side bet the game
 * offers: its exact house edge, the count that beats it and from where, and
 * what counting it earns per hour at its stake; then the game's best EV per
 * hour with the best side bet added, when one is worth making.
 */
export function SideBetsCard({ game, roundsPerHour, mainEvHour }: { game: CasinoGame; roundsPerHour: number; mainEvHour: number | null }) {
  useSideRuns();
  const figs = gameSideFigures(game, roundsPerHour);
  // A game cut off the standard cut is simulated at its own, on opening the card.
  useEffect(() => {
    for (const f of figs) if (!f.row) requestSideRow(sideRowSpec(game, f.sb));
  });
  if (figs.length === 0) return null;
  const best = bestSideEvHour(figs);
  return (
    <section className="cas-section" aria-labelledby="gs-side-title" data-testid="gs-side-bets">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="gs-side-title">
          Side bets
        </h2>
      </div>
      <ul className="cas-list cas-sb-list">
        {figs.map((f) => {
          const table = payTableOf(f.sb.bet, f.sb.payTable);
          const state = f.row ? 'done' : sideRunState(sideRowSpec(game, f.sb));
          const plan = { always: f.always, count: null, trigger: f.trigger, betBelow: f.betBelow };
          return (
            <li key={f.sb.bet} className="cas-sb-item" data-testid="gs-side-row" data-bet={f.sb.bet} data-best={best.fig === f ? 'true' : undefined}>
              <div className="cas-gs-method-top">
                <span className="cas-gs-method-name">
                  {BET_NAMES[f.sb.bet]} <span className="cas-sb-table">{table?.name}</span>
                </span>
                {best.fig === f && (
                  <span className="cas-badge" data-tone="good">
                    Best side
                  </span>
                )}
              </div>
              {f.row ? (
                <dl className="cas-gs-grid">
                  <div className="cas-gs-fig">
                    <dt>House edge</dt>
                    <dd data-testid="gs-side-edge">{pct(f.edge!)}</dd>
                  </div>
                  <div className="cas-gs-fig">
                    <dt>Bet it</dt>
                    <dd>
                      {triggerText(plan)}
                      {f.countName && <span className="cas-gs-fig-sub">{f.countName}</span>}
                    </dd>
                  </div>
                  <div className="cas-gs-fig">
                    <dt>Counted EV</dt>
                    <dd data-sign={Math.sign(Math.round(f.evHour ?? 0))} data-testid="gs-side-ev">
                      {evHourText(f.evHour ?? 0)}
                      <span className="cas-gs-fig-sub">at {money(f.stake)}</span>
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="cas-note" data-testid="gs-side-pending">
                  {state === 'failed' ? 'Could not simulate this side bet here.' : `Simulating at this game's cut…`}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {mainEvHour !== null && (
        <p className="cas-pad-x cas-sb-combined" data-testid="gs-side-combined">
          <strong>Best with a side bet:</strong>{' '}
          {best.fig
            ? `${evHourText(mainEvHour + best.evHour)} (${evHourText(mainEvHour)} + ${BET_NAMES[best.fig.sb.bet]} ${evHourText(best.evHour)})`
            : `${evHourText(mainEvHour)} — no side bet here is worth making`}
        </p>
      )}
      <p className="cas-pad-x cas-note">
        Counted EV: the side bet made only at its trigger, flat at its stake (the logged side minimum, else $25), simulated at this game&rsquo;s cut;
        the side count is kept beside Hi-Lo.
      </p>
    </section>
  );
}
