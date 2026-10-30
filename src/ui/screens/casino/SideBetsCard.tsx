import { useEffect, type ReactNode } from 'react';
import './casinoSideBets.css';
import './sideCombinedLine.css';
import type { CasinoGame } from '../../../store/casinoLog';
import { sideRowSpec } from '../../../store/casinoSideRows';
import { BET_NAMES, payTableOf } from '../../../engine/sideBets/payTables';
import { bestSideEvHour, gameSideFigures } from '../../casinoSideFigures';
import { evHourText } from '../../casinoStatsText';
import { money } from '../../casinoFigures';
import { pct } from '../../sideBetSummary';
import { triggerText } from '../../sideBetFeedback';
import { requestSideRow, sideRunState, useSideRuns } from './sideRunner';
import { sideCombinedText, type GameFigures } from '../../casinoRanking';
import { PRESET_LABEL } from '../../../engine/variants/rules';

/**
 * Wave L: the stats card's side bets -- one row per side bet the game
 * offers: its exact house edge, the count that beats it and from where, and
 * what counting it earns per hour at its stake; then the game's best EV per
 * hour with the best side bet added, when one is worth making -- on a method
 * that stays seated (review S1, casinoRanking.withSideBet): a back-counter or
 * a wonger is away for many of the rounds the side figure counts.
 *
 * Wave L merge (review S7): a variant game's side bets are listed as not
 * modelled -- its deck (Spanish 21 has no tens) and its play are not the
 * standard game the side simulation deals -- and add nothing anywhere.
 *
 * A card room's commission is charged per hand DEALT on the main bet, so it
 * is already inside the method figures the side bet is added to; the side
 * wager itself is taken as commission-free (no field logs a side-bet fee),
 * and the card says so.
 */
export function SideBetsCard({
  game,
  roundsPerHour,
  figures,
  cardRoom = false,
}: {
  game: CasinoGame;
  roundsPerHour: number;
  figures: GameFigures | null;
  cardRoom?: boolean;
}) {
  useSideRuns();
  const variant = game.variant;
  const figs = variant ? [] : gameSideFigures(game, roundsPerHour);
  // A game cut off the standard cut is simulated at its own, on opening the card.
  useEffect(() => {
    for (const f of figs) if (!f.row) requestSideRow(sideRowSpec(game, f.sb), { forOpenCard: true });
  });
  if (variant) return <VariantSideBets game={game} variantLabel={PRESET_LABEL[variant]} />;
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
                      {/* Review N4: Buster's rounds are priced by the linear estimate. */}
                      {f.row.linear && !f.always && f.trigger !== null ? '≈ ' : ''}
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
      {figures && (
        <p className="cas-pad-x cas-sb-combined" data-testid="gs-side-combined">
          <strong>Best with a side bet:</strong> {keepFigures(sideCombinedText(figures, best.fig ? BET_NAMES[best.fig.sb.bet] : null, best.evHour))}
        </p>
      )}
      <p className="cas-pad-x cas-note">
        Counted EV: the side bet made only at its trigger, flat at its stake (the logged side minimum, else $25), simulated at this game&rsquo;s cut;
        the side count is kept beside Hi-Lo.
      </p>
      {cardRoom && (
        <p className="cas-pad-x cas-note" data-testid="gs-side-commission">
          Card room: the commission is charged on each hand dealt, on the main bet, so it is already in the figures above. The side bet is taken as
          free of commission; if this room charges one on it, the side figures here are too high.
        </p>
      )}
    </section>
  );
}

/** Review S3: "−$81 ±$10/h" (casinoStatsText.evCiText), kept on one line. */
const FIGURE = /([+−]?\$[\d,]+ ±(?:\$\d+|\?)\/h)/;

function keepFigures(text: string): ReactNode[] {
  return text.split(FIGURE).map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="cas-sb-fig">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Review S7: a variant game's side bets -- named, not priced. */
function VariantSideBets({ game, variantLabel }: { game: CasinoGame; variantLabel: string }) {
  const bets = game.sideBets ?? [];
  if (bets.length === 0) return null;
  return (
    <section className="cas-section" aria-labelledby="gs-side-title" data-testid="gs-side-bets" data-state="not-modelled">
      <div className="cas-section-head">
        <h2 className="u-section-title" id="gs-side-title">
          Side bets
        </h2>
      </div>
      <ul className="cas-list cas-sb-list">
        {bets.map((sb) => (
          <li key={sb.bet} className="cas-sb-item" data-testid="gs-side-row" data-bet={sb.bet}>
            <div className="cas-gs-method-top">
              <span className="cas-gs-method-name">
                {BET_NAMES[sb.bet]} <span className="cas-sb-table">{payTableOf(sb.bet, sb.payTable)?.name}</span>
              </span>
            </div>
            <p className="cas-note" data-testid="gs-side-not-modelled">
              Not modelled for this variant
            </p>
          </li>
        ))}
      </ul>
      <p className="cas-pad-x cas-note">
        The side-bet figures are simulated on a standard shoe and standard play; {variantLabel} changes one or both, so no edge, count or EV is
        shown for its side bets, and none is added to this game&rsquo;s figures or its ranking.
      </p>
    </section>
  );
}

