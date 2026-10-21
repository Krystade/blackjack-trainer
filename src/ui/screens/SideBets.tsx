import './sideBets.css';
import type { Profile } from '../../store/types';
import type { Screen } from '../App';
import { BET_NAMES, BET_RULES, OUTCOMES, SIDE_BET_IDS, payTablesFor } from '../../engine/sideBets/payTables';
import type { Outcome, PayTable, SideBetId } from '../../engine/sideBets/payTables';
import { OUTCOME_LABELS } from '../../engine/sideBets/settle';
import { sidePlan } from '../../engine/sideBets/plan';
import { PUBLISHED_COUNTS } from '../../engine/sideBets/counts';
import { profileSideBet, DEFAULT_SIDE_STAKE } from '../sideBetConfig';
import { pct, sideSummary } from '../sideBetSummary';

/**
 * Wave L: the side bets, for reference. Every bet, every preset pay table
 * with its source, and -- at the active profile's soft-17 rule -- the exact
 * house edge by deck count, the count that beats it (or that none does), the
 * trigger, and what counting earns per 100 rounds at a $25 side bet. Every
 * figure is read from the engine's generated table; a published figure sits
 * beside the computed one, and a disagreement is shown, not hidden.
 */

const DECKS = [1, 2, 6, 8] as const;

function PaysList({ table }: { table: PayTable }) {
  const lines = (OUTCOMES[table.bet] as readonly Outcome[]).filter((o) => table.pays[o] !== undefined);
  return (
    <ul className="side-ref-pays">
      {lines.map((o) => (
        <li key={o}>
          <span>{OUTCOME_LABELS[o]}</span>
          <span className="side-ref-num">{table.pays[o]} to 1</span>
        </li>
      ))}
    </ul>
  );
}

function TableRows({ table, s17 }: { table: PayTable; s17: boolean }) {
  return (
    <div className="side-ref-grid" role="table" aria-label={`${table.name} by decks`}>
      <div className="side-ref-grid-head" role="row">
        <span role="columnheader">Decks</span>
        <span role="columnheader">Edge</span>
        <span role="columnheader">Bet it</span>
        <span role="columnheader">$/100</span>
      </div>
      {DECKS.map((d) => {
        const plan = sidePlan(table.bet, table.id, d, s17);
        if (!plan) return null;
        const sum = sideSummary(plan, DEFAULT_SIDE_STAKE);
        const match = (p: { decks: number; s17?: boolean }) => p.decks === d && (p.s17 === undefined || p.s17 === s17);
        const pub = table.published.find(match);
        const off = table.disagree?.find(match);
        const counted = plan.always || plan.candidate !== null;
        // Review N4: Buster's simulated rounds are priced by the linear estimate.
        const approx = counted && !plan.always && plan.row.linear;
        return (
          <div key={d} className="side-ref-grid-row" role="row" data-decks={d}>
            <span role="cell">{d}</span>
            <span role="cell" className="side-ref-num">
              {pct(plan.row.edge)}
              {pub && <span className="side-ref-pub">pub. {pct(pub.edge)}</span>}
              {off && (
                <span className="side-ref-off" title={off.reason}>
                  pub. {pct(off.edge)} ≠
                </span>
              )}
            </span>
            <span role="cell">
              {plan.always ? 'every hand' : plan.candidate ? `${sum.trigger} · ${plan.candidate.name}` : 'never'}
            </span>
            <span role="cell" className="side-ref-num" data-approx={approx ? 'true' : undefined}>
              {counted ? `${approx ? '≈ ' : ''}${sum.per100.replace(' per 100 rounds', '')}` : '—'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function BetSection({ bet, s17, mine }: { bet: SideBetId; s17: boolean; mine: string | null }) {
  const counts = PUBLISHED_COUNTS[bet] ?? [];
  return (
    <section className="side-ref-bet" data-testid={`side-ref-${bet}`}>
      <h2 className="side-ref-title">{BET_NAMES[bet]}</h2>
      <p className="side-ref-rule">{BET_RULES[bet]}</p>
      {counts.length > 0 && (
        <p className="stats-detail">
          Published count{counts.length > 1 ? 's' : ''}:{' '}
          {counts.map((c, i) => (
            <span key={c.id}>
              {i > 0 && '; '}
              {c.sourceUrl ? (
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {c.name}
                </a>
              ) : (
                c.name
              )}
            </span>
          ))}
        </p>
      )}
      {payTablesFor(bet).map((t) => (
        <details key={t.id} className="side-ref-table" open={t.id === mine}>
          <summary>
            {t.name}
            {t.weak && <span className="side-ref-weak">· weak source</span>}
          </summary>
          <PaysList table={t} />
          <TableRows table={t} s17={s17} />
          {t.note && <p className="stats-detail">{t.note}</p>}
          <p className="stats-detail side-ref-source">
            Source:{' '}
            <a href={t.sourceUrl} target="_blank" rel="noreferrer">
              {t.sourceName}
            </a>
          </p>
        </details>
      ))}
    </section>
  );
}

export function SideBets({ activeProfile, onNavigate }: { activeProfile: Profile; onNavigate: (s: Screen) => void }) {
  const own = profileSideBet(activeProfile);
  const s17 = activeProfile.rules.s17;
  return (
    <div className="settings-screen side-ref" data-testid="side-bets-reference">
      <div className="settings-topbar">
        <button type="button" className="settings-back-btn" onClick={() => onNavigate('profiles')}>
          Back
        </button>
        <div className="settings-heading">Side bets</div>
      </div>
      <p className="stats-detail side-ref-intro">
        House edges are exact for a full shoe. &ldquo;Bet it&rdquo; is the true count from which the bet is in your favour
        (simulated to the usual cut; the side count&rsquo;s true count is always floored, whatever this profile rounds
        Hi-Lo by), and $/100 is what counting earns per 100 rounds dealt at a ${DEFAULT_SIDE_STAKE} side
        bet. Buster at {s17 ? 'S17' : 'H17'}, as this profile; its &ldquo;≈&rdquo; figures price each simulated round by
        the linear estimate from the effects of removal, so a trigger can be a count off.
      </p>
      {SIDE_BET_IDS.map((bet) => (
        <BetSection key={bet} bet={bet} s17={s17} mine={own?.bet === bet ? own.payTable : null} />
      ))}
    </div>
  );
}
